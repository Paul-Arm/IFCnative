using Xbim.Common;
using Xbim.Common.Geometry;
using Xbim.Ifc;
using Xbim.Ifc4.Interfaces;
using Xbim.ModelGeometry.Scene.Extensions;

namespace IFCnative.IfcToGlb;

/// <summary>
/// Pure managed conversion path for models whose body geometry is exclusively
/// pre-triangulated (IfcTriangulatedFaceSet / simple IfcPolygonalFaceSet, the
/// usual shape of IFC4 reference-view exports). Needs no OpenCascade engine,
/// so it is the only path available on Linux — Xbim.Geometry ships native
/// engines for Windows only — and it is also dramatically faster and lighter
/// than running already-triangulated data through the full pipeline.
/// </summary>
internal static class TessellatedPathWriter
{
    /// <summary>
    /// Mirrors the applicability conditions of the NativeWindows fast path:
    /// any representation kind below needs the full OpenCascade pipeline.
    /// </summary>
    public static bool IsApplicable(IModel model, out string blocker)
    {
        if (!model.Instances.OfType<IIfcTriangulatedFaceSet>().Any()
            && !model.Instances.OfType<IIfcPolygonalFaceSet>().Any())
        {
            blocker = "no tessellated face sets";
            return false;
        }

        blocker = model switch
        {
            _ when model.Instances.OfType<IIfcSolidModel>().Any() => "IfcSolidModel",
            _ when model.Instances.OfType<IIfcBooleanResult>().Any() => "IfcBooleanResult",
            _ when model.Instances.OfType<IIfcFaceBasedSurfaceModel>().Any() => "IfcFaceBasedSurfaceModel",
            _ when model.Instances.OfType<IIfcShellBasedSurfaceModel>().Any() => "IfcShellBasedSurfaceModel",
            _ when model.Instances.OfType<IIfcMappedItem>().Any() => "IfcMappedItem",
            _ when model.Instances.OfType<IIfcRelVoidsElement>().Any() => "IfcRelVoidsElement (openings)",
            _ when model.Instances.OfType<IIfcIndexedPolygonalFaceWithVoids>().Any() => "IfcIndexedPolygonalFaceWithVoids",
            _ => string.Empty,
        };
        return blocker.Length == 0;
    }

    public static ConversionResult Write(
        IfcStore store,
        GlbWriter glb,
        ConversionOptions options,
        string outputPath,
        IProgress<string>? progress,
        CancellationToken cancellationToken)
    {
        var model = store.Model;

        // Mirror Xbim3DModelContext's adjustWcs: a single root placement
        // (e.g. a geo-referenced site offset) is dropped so coordinates stay
        // within float32 precision; its translation is preserved in the asset
        // extras for consumers that need to georeference the output.
        var rootPlacements = model.Instances.OfType<IIfcLocalPlacement>()
            .Where(placement => placement.PlacementRelTo is null)
            .Select(placement => placement.EntityLabel)
            .Distinct()
            .ToList();
        var adjustedRootLabel = rootPlacements.Count == 1 ? rootPlacements[0] : (int?)null;
        var originShift = new XbimPoint3D(0, 0, 0);
        if (adjustedRootLabel is int rootLabel
            && model.Instances[rootLabel] is IIfcLocalPlacement rootPlacement
            && rootPlacement.RelativePlacement is IIfcAxis2Placement rootAxis)
        {
            var rootMatrix = Xbim.ModelGeometry.Scene.Extensions.IIfcAxis2PlacementExtensions.ToMatrix3D(rootAxis);
            originShift = new XbimPoint3D(rootMatrix.OffsetX, rootMatrix.OffsetY, rootMatrix.OffsetZ);
        }

        var placementCache = new Dictionary<int, XbimMatrix3D>();
        var styledColors = BuildStyledItemColors(model);
        var geometryCache = new Dictionary<int, (GlbGeometry Geometry, int Triangles)?>();
        var meshLookup = new Dictionary<(int FaceSetLabel, int Material), int>();
        var typeMaterials = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var productNodes = new List<int>();
        var instanceCount = 0;
        var triangleCount = 0;
        var processed = 0;

        foreach (var product in model.Instances.OfType<IIfcProduct>())
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (product is IIfcFeatureElement || product.Representation?.Representations is null)
            {
                continue;
            }

            if (product is IIfcSpace && !options.IncludeSpaces)
            {
                continue;
            }

            var ifcType = product.ExpressType.ExpressName;
            var meshNodes = new List<int>();
            foreach (var representation in product.Representation.Representations)
            {
                foreach (var faceSet in representation.Items.OfType<IIfcTessellatedFaceSet>())
                {
                    if (!geometryCache.TryGetValue(faceSet.EntityLabel, out var cached))
                    {
                        cached = Decode(faceSet, glb);
                        geometryCache[faceSet.EntityLabel] = cached;
                    }

                    if (cached is not { } entry)
                    {
                        continue;
                    }

                    var material = ResolveMaterial(glb, faceSet.EntityLabel, ifcType, styledColors, typeMaterials);
                    var meshKey = (faceSet.EntityLabel, material);
                    if (!meshLookup.TryGetValue(meshKey, out var mesh))
                    {
                        mesh = glb.AddMesh(entry.Geometry, material);
                        meshLookup[meshKey] = mesh;
                    }

                    meshNodes.Add(glb.AddNode(name: null, matrix: null, mesh: mesh));
                    instanceCount++;
                    triangleCount += entry.Triangles;
                }
            }

            if (meshNodes.Count == 0)
            {
                continue;
            }

            var placement = GetPlacementMatrix(product.ObjectPlacement, adjustedRootLabel, placementCache);
            productNodes.Add(glb.AddNode(
                name: product.GlobalId.ToString() ?? $"#{product.EntityLabel}",
                matrix: IfcToGlbConverter.ToGltfMatrix(placement),
                mesh: null,
                children: meshNodes,
                ifcType: options.IncludeMetadata ? ifcType : null,
                expressId: options.IncludeMetadata ? product.EntityLabel : null,
                elementName: options.IncludeMetadata ? product.Name?.ToString() : null));

            if (++processed % 200 == 0)
            {
                progress?.Report($"Decoded {processed:N0} product(s)...");
            }
        }

        var scale = 1d / model.ModelFactors.OneMetre;
        var root = glb.AddNode(
            name: Path.GetFileNameWithoutExtension(outputPath),
            matrix:
            [
                scale, 0, 0, 0,
                0, 0, -scale, 0,
                0, scale, 0, 0,
                0, 0, 0, 1,
            ],
            mesh: null,
            children: productNodes);

        progress?.Report("Assembling GLB container...");
        var originOffsetMetres = new[] { originShift.X * scale, originShift.Y * scale, originShift.Z * scale };
        var bytes = glb.Save(outputPath, root, "IFCnative ifc2glb (direct tessellation)", originOffsetMetres);

        return new ConversionResult(
            outputPath,
            productNodes.Count,
            instanceCount,
            glb.MeshCount,
            triangleCount,
            bytes,
            TimeSpan.Zero);
    }

    /// <summary>
    /// Decodes a tessellated face set into local-space positions and indices.
    /// Normals are intentionally omitted: glTF clients must derive flat face
    /// normals when the NORMAL attribute is absent, which is exactly right for
    /// faceted geometry with shared vertices (averaged normals would smear
    /// hard edges — same reasoning as the NativeWindows fast path).
    /// </summary>
    private static (GlbGeometry Geometry, int Triangles)? Decode(IIfcTessellatedFaceSet faceSet, GlbWriter glb)
    {
        var coordList = faceSet.Coordinates?.CoordList;
        if (coordList is null || coordList.Count == 0)
        {
            return null;
        }

        var vertexCount = coordList.Count;
        var positions = new float[vertexCount * 3];
        var offset = 0;
        foreach (var coordinate in coordList)
        {
            if (coordinate.Count < 3)
            {
                return null;
            }

            positions[offset++] = (float)(double)coordinate[0].Value;
            positions[offset++] = (float)(double)coordinate[1].Value;
            positions[offset++] = (float)(double)coordinate[2].Value;
        }

        var indices = faceSet switch
        {
            IIfcTriangulatedFaceSet triangulated => DecodeTriangulated(triangulated, ToPnIndex(triangulated.PnIndex), vertexCount),
            IIfcPolygonalFaceSet polygonal => DecodePolygonal(polygonal, ToPnIndex(polygonal.PnIndex), vertexCount),
            _ => null,
        };
        if (indices is null || indices.Count == 0)
        {
            return null;
        }

        var indexArray = new int[indices.Count];
        indices.CopyTo(indexArray, 0);
        return (glb.AddGeometry(positions, [], indexArray), indexArray.Length / 3);
    }

    private static int[]? ToPnIndex(IEnumerable<Xbim.Ifc4.MeasureResource.IfcPositiveInteger>? pnIndex)
    {
        var values = pnIndex?.Select(value => (int)(long)value.Value - 1).ToArray();
        return values is { Length: > 0 } ? values : null;
    }

    private static List<int>? DecodeTriangulated(IIfcTriangulatedFaceSet faceSet, int[]? pnIndex, int vertexCount)
    {
        var indices = new List<int>(faceSet.CoordIndex.Count * 3);
        foreach (var triangle in faceSet.CoordIndex)
        {
            if (triangle.Count < 3)
            {
                continue;
            }

            for (var corner = 0; corner < 3; corner++)
            {
                if (!TryResolveIndex((int)(long)triangle[corner].Value, pnIndex, vertexCount, out var pointIndex))
                {
                    return null;
                }

                indices.Add(pointIndex);
            }
        }

        return indices;
    }

    private static List<int>? DecodePolygonal(IIfcPolygonalFaceSet faceSet, int[]? pnIndex, int vertexCount)
    {
        // Fan triangulation; valid for the convex/simple polygons that
        // IfcIndexedPolygonalFace (without voids) typically carries.
        var indices = new List<int>();
        foreach (var face in faceSet.Faces)
        {
            var loop = face.CoordIndex;
            if (loop.Count < 3)
            {
                continue;
            }

            if (!TryResolveIndex((int)(long)loop[0].Value, pnIndex, vertexCount, out var anchor))
            {
                return null;
            }

            for (var corner = 1; corner < loop.Count - 1; corner++)
            {
                if (!TryResolveIndex((int)(long)loop[corner].Value, pnIndex, vertexCount, out var second)
                    || !TryResolveIndex((int)(long)loop[corner + 1].Value, pnIndex, vertexCount, out var third))
                {
                    return null;
                }

                indices.Add(anchor);
                indices.Add(second);
                indices.Add(third);
            }
        }

        return indices;
    }

    private static bool TryResolveIndex(int oneBased, int[]? pnIndex, int vertexCount, out int pointIndex)
    {
        pointIndex = oneBased - 1;
        if (pnIndex is not null)
        {
            if (pointIndex < 0 || pointIndex >= pnIndex.Length)
            {
                return false;
            }

            pointIndex = pnIndex[pointIndex];
        }

        return pointIndex >= 0 && pointIndex < vertexCount;
    }

    private static XbimMatrix3D GetPlacementMatrix(
        IIfcObjectPlacement? placement,
        int? adjustedRootLabel,
        Dictionary<int, XbimMatrix3D> cache)
    {
        if (placement is not IIfcLocalPlacement localPlacement)
        {
            return XbimMatrix3D.Identity;
        }

        if (cache.TryGetValue(localPlacement.EntityLabel, out var cached))
        {
            return cached;
        }

        var local = localPlacement.EntityLabel == adjustedRootLabel
            ? XbimMatrix3D.Identity
            : localPlacement.RelativePlacement is IIfcAxis2Placement axisPlacement
                ? Xbim.ModelGeometry.Scene.Extensions.IIfcAxis2PlacementExtensions.ToMatrix3D(axisPlacement)
                : XbimMatrix3D.Identity;
        var result = localPlacement.PlacementRelTo is null
            ? local
            : local * GetPlacementMatrix(localPlacement.PlacementRelTo, adjustedRootLabel, cache);
        cache[localPlacement.EntityLabel] = result;
        return result;
    }

    /// <summary>Maps representation item labels to authored IfcStyledItem colors.</summary>
    private static Dictionary<int, (float R, float G, float B, float A, string? Name)> BuildStyledItemColors(IModel model)
    {
        var colors = new Dictionary<int, (float, float, float, float, string?)>();
        foreach (var styledItem in model.Instances.OfType<IIfcStyledItem>())
        {
            if (styledItem.Item is null || colors.ContainsKey(styledItem.Item.EntityLabel))
            {
                continue;
            }

            foreach (var style in styledItem.Styles)
            {
                var surfaceStyle = style as IIfcSurfaceStyle
                    ?? (style as IIfcPresentationStyleAssignment)?.Styles.OfType<IIfcSurfaceStyle>().FirstOrDefault();
                if (surfaceStyle?.Styles.OfType<IIfcSurfaceStyleShading>().FirstOrDefault() is not { SurfaceColour: { } colour } shading)
                {
                    continue;
                }

                colors[styledItem.Item.EntityLabel] = (
                    (float)Math.Clamp((double)colour.Red, 0d, 1d),
                    (float)Math.Clamp((double)colour.Green, 0d, 1d),
                    (float)Math.Clamp((double)colour.Blue, 0d, 1d),
                    shading.Transparency.HasValue
                        ? (float)Math.Clamp(1d - (double)shading.Transparency.Value, 0d, 1d)
                        : 1f,
                    surfaceStyle.Name?.ToString());
                break;
            }
        }

        return colors;
    }

    private static int ResolveMaterial(
        GlbWriter glb,
        int faceSetLabel,
        string ifcType,
        Dictionary<int, (float R, float G, float B, float A, string? Name)> styledColors,
        Dictionary<string, int> typeMaterials)
    {
        if (styledColors.TryGetValue(faceSetLabel, out var styled))
        {
            return glb.GetOrAddMaterial(styled.R, styled.G, styled.B, styled.A, styled.Name);
        }

        if (!typeMaterials.TryGetValue(ifcType, out var typeMaterial))
        {
            var (r, g, b, a) = IfcToGlbConverter.FallbackColor(ifcType);
            typeMaterial = glb.GetOrAddMaterial(r, g, b, a, ifcType);
            typeMaterials[ifcType] = typeMaterial;
        }

        return typeMaterial;
    }
}
