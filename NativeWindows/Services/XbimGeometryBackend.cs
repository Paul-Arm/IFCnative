using IFCnative.NativeWindows.Models;
using IFCnative.NativeWindows.ViewModels;
using Xbim.Common.Geometry;
using Xbim.Common.XbimExtensions;
using Xbim.Ifc4.Interfaces;
using Xbim.ModelGeometry.Scene;
using Xbim.ModelGeometry.Scene.Extensions;

namespace IFCnative.NativeWindows.Services;

public sealed class XbimGeometryBackend : IIfcGeometryBackend
{
    private const int AutoGeometryEntityLimit = 5000;
    private const int AutoGeometryRepresentationLimit = 500;
    private static readonly HashSet<string> TransparentProductTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "IFCWINDOW",
        "IFCCURTAINWALL",
    };

    private static readonly TimeSpan UiStoreAccessTimeout = TimeSpan.FromMilliseconds(250);

    public string Name => "xBIM geometry";

    public string Status => "Using xBIM/OpenCascade geometry; the xBIM store is projected into the UI.";

    public IfcGeometryValidationResult ValidateDocument(IfcDocument document)
    {
        try
        {
            if (!XbimIfcDocumentService.TryWithStoreAccess(document, () =>
            {
                var context = TryGetContext(document, allowSmallModelCreate: false);
                if (context is null)
                {
                    return new IfcGeometryValidationResult(
                        Name,
                        [],
                        document.RepresentationsByEntity.Count == 0
                            ? []
                            : [$"Warning: xBIM geometry context is not generated yet; {document.RepresentationsByEntity.Count:N0} product representation(s) are indexed."]);
                }

                var instances = context.ShapeInstances()
                    .Where(ShouldRenderInstance)
                    .ToList();
                var warnings = new List<string>();
                if (instances.Count == 0 && document.RepresentationsByEntity.Count > 0)
                {
                    warnings.Add("Warning: xBIM created no shape instances although IFC product representations are indexed.");
                }

                return new IfcGeometryValidationResult(Name, [], warnings);
            }, UiStoreAccessTimeout, out var validationResult))
            {
                return new IfcGeometryValidationResult(
                    Name,
                    [],
                    ["Warning: the xBIM store is busy (geometry is being generated); validation was skipped."]);
            }

            return validationResult!;
        }
        catch (Exception exception)
        {
            return new IfcGeometryValidationResult(Name, [$"Error: xBIM geometry failed: {exception.Message}"], []);
        }
    }

    public IReadOnlyList<IfcViewportItem> ProjectDocument(IfcDocument document, int limit = 250)
    {
        try
        {
            if (!XbimIfcDocumentService.TryWithStoreAccess(document, () =>
            {
                var context = TryGetContext(document, allowSmallModelCreate: true);
                if (context is null)
                {
                    var previewItems = new List<IfcViewportItem>
                    {
                        new(null, $"{Name}: {document.RepresentationsByEntity.Count:N0} product representation(s) indexed."),
                        new(null, "Geometry context is not generated automatically for this model size."),
                    };
                    previewItems.AddRange(document.RepresentationsByEntity.Values
                        .OrderBy(representation => representation.ProductId)
                        .Take(limit)
                        .Select(representation => new IfcViewportItem(representation.ProductId, DescribeRepresentation(document, representation))));
                    return previewItems;
                }

                var instances = context.ShapeInstances()
                    .Where(ShouldRenderInstance)
                    .ToList();
                var items = new List<IfcViewportItem>
                {
                    new(null, $"{Name}: {instances.Count:N0} xBIM shape instance(s)."),
                    new(null, Status),
                };

                items.AddRange(instances
                    .GroupBy(instance => instance.IfcProductLabel)
                    .OrderBy(group => group.Key)
                    .Take(limit)
                    .Select(group => new IfcViewportItem(group.Key, DescribeProduct(document, group.Key, group.Count()))));

                if (instances.Count > limit)
                {
                    items.Add(new IfcViewportItem(null, $"... {instances.Count - limit:N0} additional xBIM shape instances omitted from preview."));
                }

                if (items.Count == 2)
                {
                    items.Add(new IfcViewportItem(null, "No xBIM shape instances are available for this document."));
                }

                return items;
            }, UiStoreAccessTimeout, out var documentItems))
            {
                return [new IfcViewportItem(null, "xBIM geometry is being generated in the background; the preview list will refresh when it completes.")];
            }

            return documentItems!;
        }
        catch (Exception exception)
        {
            return [new IfcViewportItem(null, $"xBIM geometry failed: {exception.Message}")];
        }
    }

    public IReadOnlyList<IfcViewportItem> ProjectSelection(IfcDocument document, int entityId, int limit = 80)
    {
        try
        {
            if (!XbimIfcDocumentService.TryWithStoreAccess(document, () =>
            {
                var context = TryGetContext(document, allowSmallModelCreate: true);
                if (context is null)
                {
                    var lazyItems = new List<IfcViewportItem>
                    {
                        new(null, $"{Name}: selected entity #{entityId}."),
                        new(entityId, document.RepresentationsByEntity.TryGetValue(entityId, out var representation)
                            ? DescribeRepresentation(document, representation)
                            : "No product representation is indexed for this selection."),
                        new(null, "Mesh preview is lazy; xBIM geometry has not been generated for this model yet."),
                    };
                    return lazyItems;
                }

                var instances = context.ShapeInstances()
                    .Where(instance => instance.IfcProductLabel == entityId)
                    .Where(ShouldRenderInstance)
                    .Take(limit)
                    .ToList();
                var items = new List<IfcViewportItem>
                {
                    new(null, $"{Name}: selected entity #{entityId}."),
                };

                if (instances.Count == 0)
                {
                    items.Add(new IfcViewportItem(entityId, "No xBIM shape instances for this selection."));
                    return items;
                }

                items.Add(new IfcViewportItem(entityId, DescribeProduct(document, entityId, instances.Count)));
                items.AddRange(instances.Select(instance => new IfcViewportItem(
                    entityId,
                    $"  - xBIM shape #{instance.ShapeGeometryLabel}, instance #{instance.InstanceLabel}, {instance.RepresentationType}")));

                return items;
            }, UiStoreAccessTimeout, out var selectionItems))
            {
                return
                [
                    new IfcViewportItem(null, $"{Name}: selected entity #{entityId}."),
                    new IfcViewportItem(entityId, "xBIM geometry is being generated in the background; selection details will refresh when it completes."),
                ];
            }

            return selectionItems!;
        }
        catch (Exception exception)
        {
            return [new IfcViewportItem(null, $"xBIM geometry failed: {exception.Message}")];
        }
    }

    public IReadOnlyList<IfcPreviewMesh> BuildPreviewMeshes(IfcDocument document, IReadOnlyList<IfcViewportItem> items, int limit = 48)
    {
        try
        {
            if (!XbimIfcDocumentService.TryWithStoreAccess<IReadOnlyList<IfcPreviewMesh>>(document, () =>
            {
                var context = TryGetContext(document, allowSmallModelCreate: true);
                if (context is null)
                {
                    return [];
                }

                var productIds = items
                    .Where(item => item.EntityId is not null)
                    .Select(item => item.EntityId!.Value)
                    .ToHashSet();

                var instances = context.ShapeInstances()
                    .Where(instance => productIds.Count == 0 || productIds.Contains(instance.IfcProductLabel))
                    .Where(ShouldRenderInstance)
                    .Take(limit)
                    .ToList();

                var meshes = new List<IfcPreviewMesh>();
                foreach (var instance in instances)
                {
                    var mesh = BuildMesh(context.ShapeGeometry(instance), instance);
                    if (mesh is not null && mesh.IsRenderable)
                    {
                        meshes.Add(mesh);
                    }
                }

                return meshes;
            }, UiStoreAccessTimeout, out var previewMeshes))
            {
                return [];
            }

            return previewMeshes!;
        }
        catch
        {
            return [];
        }
    }

    public Task<IfcRenderScene> BuildRenderSceneAsync(
        IfcDocument document,
        IfcRenderSceneRequest request,
        CancellationToken cancellationToken = default,
        IProgress<string>? progress = null)
    {
        return Task.Run(() => BuildRenderScene(document, request, cancellationToken, progress), cancellationToken);
    }

    private static IfcRenderScene BuildRenderScene(
        IfcDocument document,
        IfcRenderSceneRequest request,
        CancellationToken cancellationToken,
        IProgress<string>? progress)
    {
        return XbimIfcDocumentService.WithStoreAccess(document, () => BuildRenderSceneCore(document, request, cancellationToken, progress), cancellationToken);
    }

    private static IfcRenderScene BuildRenderSceneCore(
        IfcDocument document,
        IfcRenderSceneRequest request,
        CancellationToken cancellationToken,
        IProgress<string>? progress)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var stopwatch = System.Diagnostics.Stopwatch.StartNew();

        // Fast path: models whose geometry is exclusively pre-triangulated
        // (IfcTriangulatedFaceSet) need no OpenCascade tessellation at all.
        // Decoding the triangles directly takes seconds instead of minutes.
        var fastScene = TryBuildTessellatedFastScene(document, request, cancellationToken, progress);
        if (fastScene is not null)
        {
            Views.ViewportPreviewControl.LogViewport($"fast tessellation path done in {stopwatch.Elapsed.TotalSeconds:0.0}s");
            return fastScene;
        }

        progress?.Report("Generating xBIM geometry context...");
        XbimIfcDocumentService.EnsureGeometryContext(
            document,
            percent => progress?.Report($"Generating xBIM geometry... {percent}%"));
        Views.ViewportPreviewControl.LogViewport($"geometry context ready in {stopwatch.Elapsed.TotalSeconds:0.0}s");
        stopwatch.Restart();
        cancellationToken.ThrowIfCancellationRequested();
        var store = XbimIfcDocumentService.EnsureStore(document);
        progress?.Report("Reading xBIM GeometryStore...");

        using var reader = store.GeometryStore.BeginRead();
        cancellationToken.ThrowIfCancellationRequested();
        var instances = request.ProductId is int productId
            ? reader.ShapeInstancesOfEntity(productId).ToList()
            : reader.ShapeInstances.ToList();

        if (request.Limit is int limit && limit > 0)
        {
            instances = instances.Take(limit).ToList();
        }

        var meshes = new List<IfcRenderMesh>();
        var bounds = IfcRenderBounds.Empty;
        var productOrigins = new Dictionary<int, IfcPreviewVertex>();
        var triangleCount = 0;
        var decoded = 0;
        foreach (var instance in instances)
        {
            cancellationToken.ThrowIfCancellationRequested();

            if (!ShouldRenderInstance(instance))
            {
                continue;
            }

            document.EntityById.TryGetValue(instance.IfcProductLabel, out var entity);

            var geometry = reader.ShapeGeometry(instance.ShapeGeometryLabel);
            var mesh = DecodeShapeGeometry(geometry, instance, entity?.Type);
            if (mesh is null || !mesh.IsRenderable)
            {
                continue;
            }

            var isSpace = entity is not null
                && string.Equals(entity.Type, "IFCSPACE", StringComparison.OrdinalIgnoreCase);
            mesh = mesh with { IsSpace = isSpace };

            if (!productOrigins.ContainsKey(instance.IfcProductLabel))
            {
                var transform = instance.Transformation;
                productOrigins[instance.IfcProductLabel] = new IfcPreviewVertex(transform.OffsetX, transform.OffsetY, transform.OffsetZ);
            }

            meshes.Add(mesh);
            decoded++;
            triangleCount += mesh.Indices.Count / 3;
            foreach (var vertex in mesh.Vertices)
            {
                bounds = bounds.Include(vertex.X, vertex.Y, vertex.Z);
            }

            if (decoded % 500 == 0)
            {
                progress?.Report($"Decoded {decoded:N0} xBIM shape instance(s)...");
            }
        }

        if (meshes.Count == 0)
        {
            return IfcRenderScene.Empty("xBIM GeometryStore contains no renderable triangle meshes.");
        }

        Views.ViewportPreviewControl.LogViewport($"scene assembled in {stopwatch.Elapsed.TotalSeconds:0.0}s: meshes={meshes.Count} tris={triangleCount}");

        var label = request.ProductId is int selectedProductId
            ? $"Selection #{selectedProductId}"
            : document.FileName;
        return new IfcRenderScene(
            label,
            meshes,
            bounds,
            instances.Count,
            triangleCount,
            $"xBIM GeometryStore: {meshes.Count:N0} mesh(es), {triangleCount:N0} triangle(s).",
            productOrigins);
    }

    /// <summary>
    /// Builds a render scene directly from IfcTriangulatedFaceSet data when the
    /// model contains no geometry that requires OpenCascade (no solids, booleans,
    /// mapped items or openings). Returns null when the fast path does not apply.
    /// </summary>
    private static IfcRenderScene? TryBuildTessellatedFastScene(
        IfcDocument document,
        IfcRenderSceneRequest request,
        CancellationToken cancellationToken,
        IProgress<string>? progress)
    {
        var store = XbimIfcDocumentService.EnsureStore(document);
        var model = store.Model;

        var faceSetCount = model.Instances.CountOf<IIfcTriangulatedFaceSet>();
        if (faceSetCount == 0)
        {
            return null;
        }

        // Any of these representation kinds needs the full OpenCascade pipeline.
        if (model.Instances.OfType<IIfcSolidModel>().Any()
            || model.Instances.OfType<IIfcBooleanResult>().Any()
            || model.Instances.OfType<IIfcFaceBasedSurfaceModel>().Any()
            || model.Instances.OfType<IIfcShellBasedSurfaceModel>().Any()
            || model.Instances.OfType<IIfcPolygonalFaceSet>().Any()
            || model.Instances.OfType<IIfcMappedItem>().Any()
            || model.Instances.OfType<IIfcRelVoidsElement>().Any())
        {
            return null;
        }

        progress?.Report($"Decoding {faceSetCount:N0} triangulated face set(s)...");

        // Mirror Xbim3DModelContext's adjustWcs: when there is a single root
        // placement (e.g. geo-referenced site offset), drop it so coordinates
        // stay small enough for float-precision rendering.
        var rootPlacements = model.Instances.OfType<IIfcLocalPlacement>()
            .Where(placement => placement.PlacementRelTo is null)
            .Select(placement => placement.EntityLabel)
            .Distinct()
            .ToList();
        var adjustedRootLabel = rootPlacements.Count == 1 ? rootPlacements[0] : (int?)null;
        var placementCache = new Dictionary<int, XbimMatrix3D>();

        var meshes = new List<IfcRenderMesh>();
        var bounds = IfcRenderBounds.Empty;
        var productOrigins = new Dictionary<int, IfcPreviewVertex>();
        var triangleCount = 0;
        var instanceCount = 0;
        var limitReached = false;

        foreach (var product in model.Instances.OfType<IIfcProduct>())
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (limitReached)
            {
                break;
            }

            if (product is IIfcFeatureElement || product.Representation?.Representations is null)
            {
                continue;
            }

            if (request.ProductId is int requestedProductId && product.EntityLabel != requestedProductId)
            {
                continue;
            }

            var transform = GetPlacementMatrix(product.ObjectPlacement, adjustedRootLabel, placementCache);

            document.EntityById.TryGetValue(product.EntityLabel, out var entity);
            var isSpace = entity is not null
                && string.Equals(entity.Type, "IFCSPACE", StringComparison.OrdinalIgnoreCase);

            foreach (var representation in product.Representation.Representations)
            {
                foreach (var faceSet in representation.Items.OfType<IIfcTriangulatedFaceSet>())
                {
                    instanceCount++;
                    var mesh = DecodeTriangulatedFaceSet(faceSet, transform, product.EntityLabel, entity?.Type);
                    if (mesh is null || !mesh.IsRenderable)
                    {
                        continue;
                    }

                    mesh = mesh with { IsSpace = isSpace };

                    if (!productOrigins.ContainsKey(product.EntityLabel))
                    {
                        productOrigins[product.EntityLabel] = new IfcPreviewVertex(transform.OffsetX, transform.OffsetY, transform.OffsetZ);
                    }

                    meshes.Add(mesh);
                    triangleCount += mesh.Indices.Count / 3;
                    foreach (var vertex in mesh.Vertices)
                    {
                        bounds = bounds.Include(vertex.X, vertex.Y, vertex.Z);
                    }

                    if (meshes.Count % 500 == 0)
                    {
                        progress?.Report($"Decoded {meshes.Count:N0} triangulated mesh(es)...");
                    }

                    if (request.Limit is int limit && limit > 0 && meshes.Count >= limit)
                    {
                        limitReached = true;
                        break;
                    }
                }

                if (limitReached)
                {
                    break;
                }
            }
        }

        if (meshes.Count == 0)
        {
            return null;
        }

        document.GeometryBackendStatus = "Direct tessellation fast path: IfcTriangulatedFaceSet decoded without OpenCascade.";
        var label = request.ProductId is int selectedProductId
            ? $"Selection #{selectedProductId}"
            : document.FileName;
        return new IfcRenderScene(
            label,
            meshes,
            bounds,
            instanceCount,
            triangleCount,
            $"Direct tessellation: {meshes.Count:N0} mesh(es), {triangleCount:N0} triangle(s).",
            productOrigins);
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
                ? axisPlacement.ToMatrix3D()
                : XbimMatrix3D.Identity;
        var result = localPlacement.PlacementRelTo is null
            ? local
            : local * GetPlacementMatrix(localPlacement.PlacementRelTo, adjustedRootLabel, cache);
        cache[localPlacement.EntityLabel] = result;
        return result;
    }

    private static IfcRenderMesh? DecodeTriangulatedFaceSet(
        IIfcTriangulatedFaceSet faceSet,
        XbimMatrix3D transform,
        int productLabel,
        string? productType)
    {
        var coordList = faceSet.Coordinates?.CoordList;
        if (coordList is null || coordList.Count == 0 || faceSet.CoordIndex.Count == 0)
        {
            return null;
        }

        var points = new (double X, double Y, double Z)[coordList.Count];
        var index = 0;
        foreach (var coordinate in coordList)
        {
            if (coordinate.Count < 3)
            {
                return null;
            }

            var transformed = transform.Transform(new XbimPoint3D(coordinate[0], coordinate[1], coordinate[2]));
            points[index++] = (transformed.X, transformed.Y, transformed.Z);
        }

        var pnIndex = faceSet.PnIndex is { Count: > 0 }
            ? faceSet.PnIndex.Select(value => (int)(long)value.Value - 1).ToArray()
            : null;

        var indices = new List<int>(faceSet.CoordIndex.Count * 3);
        foreach (var triangle in faceSet.CoordIndex)
        {
            if (triangle.Count < 3)
            {
                continue;
            }

            for (var corner = 0; corner < 3; corner++)
            {
                var pointIndex = (int)(long)triangle[corner].Value - 1;
                if (pnIndex is not null)
                {
                    if (pointIndex < 0 || pointIndex >= pnIndex.Length)
                    {
                        return null;
                    }

                    pointIndex = pnIndex[pointIndex];
                }

                if (pointIndex < 0 || pointIndex >= points.Length)
                {
                    return null;
                }

                indices.Add(pointIndex);
            }
        }

        if (indices.Count == 0)
        {
            return null;
        }

        // Averaged vertex normals from accumulated face normals.
        var normals = new (double X, double Y, double Z)[points.Length];
        for (var i = 0; i < indices.Count; i += 3)
        {
            var a = points[indices[i]];
            var b = points[indices[i + 1]];
            var c = points[indices[i + 2]];
            var abX = b.X - a.X;
            var abY = b.Y - a.Y;
            var abZ = b.Z - a.Z;
            var acX = c.X - a.X;
            var acY = c.Y - a.Y;
            var acZ = c.Z - a.Z;
            var nx = abY * acZ - abZ * acY;
            var ny = abZ * acX - abX * acZ;
            var nz = abX * acY - abY * acX;
            for (var corner = 0; corner < 3; corner++)
            {
                var vertexIndex = indices[i + corner];
                normals[vertexIndex] = (normals[vertexIndex].X + nx, normals[vertexIndex].Y + ny, normals[vertexIndex].Z + nz);
            }
        }

        var vertices = new List<IfcRenderVertex>(points.Length);
        for (var i = 0; i < points.Length; i++)
        {
            var normal = normals[i];
            var length = Math.Sqrt(normal.X * normal.X + normal.Y * normal.Y + normal.Z * normal.Z);
            if (length < 1e-12)
            {
                normal = (0d, 0d, 1d);
                length = 1d;
            }

            vertices.Add(new IfcRenderVertex(
                points[i].X,
                points[i].Y,
                points[i].Z,
                (float)(normal.X / length),
                (float)(normal.Y / length),
                (float)(normal.Z / length)));
        }

        return new IfcRenderMesh(
            productLabel,
            faceSet.EntityLabel,
            0,
            0,
            ColorFor(0, 0, productLabel, productType),
            vertices,
            indices);
    }

    private static IfcRenderMesh? DecodeShapeGeometry(IXbimShapeGeometryData geometry, IXbimShapeInstanceData instance, string? productType)    {
        if (geometry.Format != (byte)XbimGeometryType.PolyhedronBinary || geometry.ShapeData.Length == 0)
        {
            return null;
        }

        using var stream = new MemoryStream(geometry.ShapeData);
        using var reader = new BinaryReader(stream);
        var triangulation = reader.ReadShapeTriangulation()
            .Transform(XbimMatrix3D.FromArray(instance.Transformation));
        triangulation.ToPointsWithNormalsAndIndices(out var points, out var indices);
        if (points.Count == 0 || indices.Count == 0)
        {
            return null;
        }

        var vertices = points
            .Select(point => new IfcRenderVertex(point[0], point[1], point[2], (float)point[3], (float)point[4], (float)point[5]))
            .ToList();

        return new IfcRenderMesh(
            instance.IfcProductLabel,
            instance.ShapeGeometryLabel,
            instance.StyleLabel,
            instance.IfcTypeId,
            ColorFor(instance.StyleLabel, instance.IfcTypeId, instance.IfcProductLabel, productType),
            vertices,
            indices);
    }

    private static bool ShouldRenderInstance(IXbimShapeInstanceData instance)
    {
        return instance.IfcProductLabel > 0
            && instance.RepresentationType == (byte)XbimGeometryRepresentationType.OpeningsAndAdditionsIncluded;
    }

    private static IfcRenderColor ColorFor(int styleLabel, int ifcTypeId, int productId, string? productType)
    {
        if (!string.IsNullOrWhiteSpace(productType) && TransparentProductTypes.Contains(productType))
        {
            return new IfcRenderColor(0.56f, 0.78f, 0.88f, 0.32f);
        }

        var seed = styleLabel > 0 ? styleLabel : ifcTypeId != 0 ? -ifcTypeId : productId;
        var hue = Math.Abs(seed * 137.508d) % 360d;
        var saturation = styleLabel > 0 ? 0.32d : 0.22d;
        var lightness = styleLabel > 0 ? 0.58d : 0.62d;
        return FromHsl(hue, saturation, lightness);
    }

    private static IfcRenderColor FromHsl(double hue, double saturation, double lightness)
    {
        var chroma = (1d - Math.Abs(2d * lightness - 1d)) * saturation;
        var h = hue / 60d;
        var x = chroma * (1d - Math.Abs(h % 2d - 1d));
        var (r, g, b) = h switch
        {
            >= 0 and < 1 => (chroma, x, 0d),
            >= 1 and < 2 => (x, chroma, 0d),
            >= 2 and < 3 => (0d, chroma, x),
            >= 3 and < 4 => (0d, x, chroma),
            >= 4 and < 5 => (x, 0d, chroma),
            _ => (chroma, 0d, x),
        };
        var m = lightness - chroma / 2d;
        return new IfcRenderColor((float)(r + m), (float)(g + m), (float)(b + m), 1f);
    }

    private static IfcPreviewMesh? BuildMesh(XbimShapeGeometry geometry, XbimShapeInstance instance)
    {
        if (!geometry.IsValid || geometry.VertexCount == 0 || geometry.TriangleCount == 0)
        {
            return null;
        }

        var transform = instance.Transformation;
        var vertices = geometry.Vertices
            .Select(vertex => transform.Transform(vertex))
            .Select(vertex => new IfcPreviewVertex(vertex.X, vertex.Y, vertex.Z))
            .ToList();
        var indices = geometry.Faces
            .SelectMany(face => face.Indices)
            .Where(index => index >= 0 && index < vertices.Count)
            .ToList();

        return new IfcPreviewMesh(
            instance.IfcProductLabel,
            instance.ShapeGeometryLabel,
            "xBIM",
            $"xBIM shape #{instance.ShapeGeometryLabel}: {geometry.TriangleCount:N0} triangle(s)",
            vertices,
            indices);
    }

    private static Xbim.ModelGeometry.Scene.Xbim3DModelContext? TryGetContext(IfcDocument document, bool allowSmallModelCreate)
    {
        if (XbimIfcDocumentService.TryGetGeometryContext(document) is { } existing)
        {
            return existing;
        }

        if (!allowSmallModelCreate
            || document.Entities.Count > AutoGeometryEntityLimit
            || document.RepresentationsByEntity.Count > AutoGeometryRepresentationLimit)
        {
            return null;
        }

        return XbimIfcDocumentService.EnsureGeometryContext(document);
    }

    private static string DescribeProduct(IfcDocument document, int productId, int shapeCount)
    {
        if (!document.EntityById.TryGetValue(productId, out var entity))
        {
            return $"#{productId}: {shapeCount:N0} xBIM shape instance(s)";
        }

        return $"#{entity.Id} {entity.TypeName()} {entity.DisplayName}: {shapeCount:N0} xBIM shape instance(s)";
    }

    private static string DescribeRepresentation(IfcDocument document, IfcRepresentationSummary representation)
    {
        var label = document.EntityById.TryGetValue(representation.ProductId, out var entity)
            ? $"#{entity.Id} {entity.TypeName()} {entity.DisplayName}"
            : $"#{representation.ProductId}";
        return $"{label}: Product shape #{representation.ProductDefinitionShapeId} with {representation.GeometryItemIds.Count:N0} item(s).";
    }
}
