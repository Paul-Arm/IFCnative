using System.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;
using Xbim.Common;
using Xbim.Common.Configuration;
using Xbim.Common.Geometry;
using Xbim.Common.XbimExtensions;
using Xbim.Ifc;
using Xbim.Ifc4.Interfaces;
using Xbim.IO;
using Xbim.ModelGeometry.Scene;
using Xbim.ModelGeometry.Scene.Extensions;

namespace IFCnative.IfcToGlb;

/// <summary>
/// Converts an IFC file to glTF binary (GLB) using the xBIM/OpenCascade
/// tessellation pipeline — the same one NativeWindows uses for its viewport.
/// Each distinct shape geometry is parsed exactly once and written as a
/// shared glTF mesh; mapped/typed product instances become nodes that
/// reference it with their placement matrix, so repeated geometry costs a
/// node, not a copy of the triangles.
/// </summary>
public static class IfcToGlbConverter
{
    private static readonly Lock ConfigureLock = new();
    private static bool configured;
    private static Microsoft.Extensions.Logging.ILoggerFactory? loggerFactory;

    /// <summary>
    /// Optional: provide a logger factory for xBIM diagnostics. Must be called
    /// before the first <see cref="Convert"/>; defaults to no logging.
    /// </summary>
    public static void ConfigureLogging(Microsoft.Extensions.Logging.ILoggerFactory factory)
    {
        lock (ConfigureLock)
        {
            if (configured)
            {
                throw new InvalidOperationException("ConfigureLogging must be called before the first conversion.");
            }

            loggerFactory = factory;
        }
    }

    public static ConversionResult Convert(
        string inputPath,
        string outputPath,
        ConversionOptions? options = null,
        IProgress<string>? progress = null,
        CancellationToken cancellationToken = default)
    {
        options ??= new ConversionOptions();
        var stopwatch = Stopwatch.StartNew();
        EnsureConfigured();

        progress?.Report($"Opening {Path.GetFileName(inputPath)}...");
        using var store = IfcStore.Open(inputPath, null, null, null, XbimDBAccess.Read);
        cancellationToken.ThrowIfCancellationRequested();

        using var glb = new GlbWriter();
        ConversionResult result;

        // Models whose body geometry is exclusively pre-triangulated (typical
        // IFC4 reference-view exports) are decoded directly in managed code:
        // orders of magnitude faster and the only path available on Linux.
        if (TessellatedPathWriter.IsApplicable(store.Model, out var blocker))
        {
            progress?.Report("Decoding pre-triangulated geometry (no OpenCascade)...");
            result = TessellatedPathWriter.Write(store, glb, options, outputPath, progress, cancellationToken);
        }
        else if (OperatingSystem.IsWindows())
        {
            result = ConvertWithOpenCascade(store, glb, options, outputPath, progress, cancellationToken);
        }
        else
        {
            throw new NotSupportedException(
                $"This model requires the OpenCascade tessellation engine ({blocker} found), "
                + "and Xbim.Geometry ships native engines for Windows only. On this platform only "
                + "pre-triangulated IFC4 models (IfcTriangulatedFaceSet / simple IfcPolygonalFaceSet) are supported.");
        }

        progress?.Report($"Done in {stopwatch.Elapsed.TotalSeconds:0.0}s.");
        return result with { Duration = stopwatch.Elapsed };
    }

    private static ConversionResult ConvertWithOpenCascade(
        IfcStore store,
        GlbWriter glb,
        ConversionOptions options,
        string outputPath,
        IProgress<string>? progress,
        CancellationToken cancellationToken)
    {
        // Viewer-grade tessellation tolerances (same trade-off as NativeWindows):
        // analysis-grade meshing costs minutes on BRep-heavy models for no
        // visible gain at viewer scale.
        var factors = store.Model.ModelFactors;
        factors.DeflectionTolerance = Math.Max(factors.DeflectionTolerance, factors.OneMilliMetre * options.DeflectionMillimetres);
        factors.DeflectionAngle = Math.Max(factors.DeflectionAngle, options.DeflectionAngle);

        progress?.Report("Tessellating with xBIM/OpenCascade...");
        var context = new Xbim3DModelContext(store)
        {
            MaxThreads = Math.Max(1, options.MaxThreads),
        };
        var lastPercent = -1;
        context.CreateContext((percent, _) =>
        {
            if (percent >= 0 && percent != lastPercent)
            {
                lastPercent = percent;
                progress?.Report($"Tessellating with xBIM/OpenCascade... {percent}%");
            }
        });
        cancellationToken.ThrowIfCancellationRequested();

        return WriteScene(store, glb, options, outputPath, progress, cancellationToken);
    }

    private static ConversionResult WriteScene(
        IfcStore store,
        GlbWriter glb,
        ConversionOptions options,
        string outputPath,
        IProgress<string>? progress,
        CancellationToken cancellationToken)
    {
        var model = store.Model;
        using var reader = store.GeometryStore.BeginRead();

        // Geo-referenced models carry offsets far beyond float32 precision.
        // Subtracting the most populated region centre keeps node translations
        // small; the original offset is preserved in the asset extras.
        var region = reader.ContextRegions
            .SelectMany(collection => collection)
            .OrderByDescending(r => r.Population)
            .FirstOrDefault();
        var originShift = region?.Centre ?? new XbimPoint3D(0, 0, 0);

        var instances = reader.ShapeInstances
            .Where(instance => instance.IfcProductLabel > 0
                && instance.RepresentationType == XbimGeometryRepresentationType.OpeningsAndAdditionsIncluded)
            .ToList();

        progress?.Report($"Writing {instances.Count:N0} shape instance(s) to GLB...");

        var productMeta = new Dictionary<int, ProductMeta?>();
        var styleMaterials = new Dictionary<int, int?>();
        var typeMaterials = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var meshLookup = new Dictionary<(int GeometryLabel, int Material), int>();
        var geometryLookup = new Dictionary<int, GlbGeometry?>();
        var nodesByProduct = new Dictionary<int, List<int>>();
        var productOrder = new List<int>();
        var instanceCount = 0;
        var triangleCount = 0;
        var written = 0;

        // Instances are processed grouped by geometry label so each distinct
        // triangulation is parsed once, streamed to the binary chunk, and its
        // vertex arrays are garbage well before the next geometry loads.
        foreach (var group in instances.GroupBy(instance => instance.ShapeGeometryLabel).OrderBy(g => g.Key))
        {
            cancellationToken.ThrowIfCancellationRequested();

            GlbGeometry? geometry = null;
            int geometryTriangles = 0;
            foreach (var instance in group)
            {
                var meta = GetProductMeta(model, instance.IfcProductLabel, productMeta);
                if (meta is null || (meta.IsSpace && !options.IncludeSpaces))
                {
                    continue;
                }

                if (geometry is null)
                {
                    if (!geometryLookup.TryGetValue(group.Key, out geometry))
                    {
                        geometry = WriteGeometry(reader, group.Key, glb, out geometryTriangles);
                        geometryLookup[group.Key] = geometry;
                    }

                    if (geometry is null)
                    {
                        break; // unparseable geometry; skip all instances of it
                    }
                }

                var material = ResolveMaterial(model, glb, instance.StyleLabel, meta, styleMaterials, typeMaterials);
                var meshKey = (group.Key, material);
                if (!meshLookup.TryGetValue(meshKey, out var mesh))
                {
                    mesh = glb.AddMesh(geometry.Value, material);
                    meshLookup[meshKey] = mesh;
                }

                var node = glb.AddNode(
                    name: null,
                    matrix: ToGltfMatrix(instance.Transformation, originShift),
                    mesh: mesh);
                if (!nodesByProduct.TryGetValue(instance.IfcProductLabel, out var productParts))
                {
                    productParts = [];
                    nodesByProduct[instance.IfcProductLabel] = productParts;
                    productOrder.Add(instance.IfcProductLabel);
                }

                productParts.Add(node);
                instanceCount++;
                triangleCount += geometryTriangles;

                if (++written % 2000 == 0)
                {
                    progress?.Report($"Writing shape instances... {written:N0}/{instances.Count:N0}");
                }
            }
        }

        // One named node per product (name = GlobalId) so viewers can map
        // geometry back to IFC elements; instance nodes hang underneath.
        var productNodes = new List<int>(productOrder.Count);
        foreach (var productLabel in productOrder)
        {
            var meta = productMeta[productLabel]!;
            productNodes.Add(glb.AddNode(
                name: meta.GlobalId,
                matrix: null,
                mesh: null,
                children: nodesByProduct[productLabel],
                ifcType: options.IncludeMetadata ? meta.IfcType : null,
                expressId: options.IncludeMetadata ? productLabel : null,
                elementName: options.IncludeMetadata ? meta.Name : null));
        }

        // Root converts model units to metres and IFC Z-up to glTF Y-up.
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
        var bytes = glb.Save(outputPath, root, "IFCnative ifc2glb (xBIM geometry)", originOffsetMetres);

        return new ConversionResult(
            outputPath,
            productNodes.Count,
            instanceCount,
            glb.MeshCount,
            triangleCount,
            bytes,
            TimeSpan.Zero);
    }

    private static GlbGeometry? WriteGeometry(IGeometryStoreReader reader, int geometryLabel, GlbWriter glb, out int triangles)
    {
        triangles = 0;
        IXbimShapeGeometryData data = reader.ShapeGeometry(geometryLabel);
        if (data.Format != (byte)XbimGeometryType.PolyhedronBinary || data.ShapeData.Length == 0)
        {
            return null;
        }

        using var stream = new MemoryStream(data.ShapeData);
        using var binaryReader = new BinaryReader(stream);
        var triangulation = binaryReader.ReadShapeTriangulation();
        triangulation.ToPointsWithNormalsAndIndices(out var points, out var indices);
        if (points.Count == 0 || indices.Count == 0)
        {
            return null;
        }

        var positions = new float[points.Count * 3];
        var normals = new float[points.Count * 3];
        for (var i = 0; i < points.Count; i++)
        {
            var point = points[i];
            var offset = i * 3;
            positions[offset] = (float)point[0];
            positions[offset + 1] = (float)point[1];
            positions[offset + 2] = (float)point[2];
            normals[offset] = (float)point[3];
            normals[offset + 1] = (float)point[4];
            normals[offset + 2] = (float)point[5];
        }

        var indexArray = new int[indices.Count];
        for (var i = 0; i < indices.Count; i++)
        {
            indexArray[i] = indices[i];
        }

        triangles = indexArray.Length / 3;
        return glb.AddGeometry(positions, normals, indexArray);
    }

    private sealed record ProductMeta(string GlobalId, string IfcType, string? Name, bool IsSpace);

    private static ProductMeta? GetProductMeta(IModel model, int productLabel, Dictionary<int, ProductMeta?> cache)
    {
        if (cache.TryGetValue(productLabel, out var cached))
        {
            return cached;
        }

        ProductMeta? meta = null;
        if (model.Instances[productLabel] is IIfcProduct product and not IIfcFeatureElement)
        {
            meta = new ProductMeta(
                product.GlobalId.ToString() ?? $"#{productLabel}",
                product.ExpressType.ExpressName,
                product.Name?.ToString(),
                product is IIfcSpace);
        }

        cache[productLabel] = meta;
        return meta;
    }

    private static int ResolveMaterial(
        IModel model,
        GlbWriter glb,
        int styleLabel,
        ProductMeta meta,
        Dictionary<int, int?> styleMaterials,
        Dictionary<string, int> typeMaterials)
    {
        if (styleLabel > 0)
        {
            if (!styleMaterials.TryGetValue(styleLabel, out var styleMaterial))
            {
                styleMaterial = model.Instances[styleLabel] is IIfcSurfaceStyle surfaceStyle
                    && surfaceStyle.Styles.OfType<IIfcSurfaceStyleShading>().FirstOrDefault() is { SurfaceColour: { } colour } shading
                    ? glb.GetOrAddMaterial(
                        (float)Math.Clamp((double)colour.Red, 0d, 1d),
                        (float)Math.Clamp((double)colour.Green, 0d, 1d),
                        (float)Math.Clamp((double)colour.Blue, 0d, 1d),
                        shading.Transparency.HasValue
                            ? (float)Math.Clamp(1d - (double)shading.Transparency.Value, 0d, 1d)
                            : 1f,
                        surfaceStyle.Name?.ToString())
                    : null;
                styleMaterials[styleLabel] = styleMaterial;
            }

            if (styleMaterial is int resolved)
            {
                return resolved;
            }
        }

        // Fallback: stable per-IFC-type color so unstyled models stay readable.
        if (!typeMaterials.TryGetValue(meta.IfcType, out var typeMaterial))
        {
            var (r, g, b, a) = FallbackColor(meta.IfcType);
            typeMaterial = glb.GetOrAddMaterial(r, g, b, a, meta.IfcType);
            typeMaterials[meta.IfcType] = typeMaterial;
        }

        return typeMaterial;
    }

    internal static (float R, float G, float B, float A) FallbackColor(string ifcType)
    {
        if (ifcType.Equals("IfcWindow", StringComparison.OrdinalIgnoreCase)
            || ifcType.Equals("IfcCurtainWall", StringComparison.OrdinalIgnoreCase)
            || ifcType.Equals("IfcPlate", StringComparison.OrdinalIgnoreCase))
        {
            return (0.56f, 0.78f, 0.88f, 0.4f);
        }

        var seed = 0;
        foreach (var ch in ifcType)
        {
            seed = seed * 31 + char.ToUpperInvariant(ch);
        }

        var hue = Math.Abs(seed * 137.508d) % 360d;
        var chroma = (1d - Math.Abs(2d * 0.6d - 1d)) * 0.3d;
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
        var m = 0.6d - chroma / 2d;
        return ((float)(r + m), (float)(g + m), (float)(b + m), 1f);
    }

    /// <summary>
    /// xBIM matrices use the row-vector convention (translation in OffsetX/Y/Z);
    /// glTF wants a column-major array for the column-vector convention, which
    /// is exactly the row-major flattening of the xBIM matrix.
    /// </summary>
    internal static double[]? ToGltfMatrix(XbimMatrix3D m)
    {
        return ToGltfMatrix(m, new XbimPoint3D(0, 0, 0));
    }

    private static double[]? ToGltfMatrix(XbimMatrix3D m, XbimPoint3D originShift)
    {
        var tx = m.OffsetX - originShift.X;
        var ty = m.OffsetY - originShift.Y;
        var tz = m.OffsetZ - originShift.Z;
        if (m.IsIdentity && tx == 0d && ty == 0d && tz == 0d)
        {
            return null;
        }

        return
        [
            m.M11, m.M12, m.M13, m.M14,
            m.M21, m.M22, m.M23, m.M24,
            m.M31, m.M32, m.M33, m.M34,
            tx, ty, tz, m.M44,
        ];
    }

    private static void EnsureConfigured()
    {
        if (configured)
        {
            return;
        }

        lock (ConfigureLock)
        {
            if (configured)
            {
                return;
            }

            if (!XbimServices.Current.IsConfigured && !XbimServices.Current.IsBuilt)
            {
                var factory = loggerFactory ?? NullLoggerFactory.Instance;
                XbimServices.Current.ConfigureServices(services =>
                    services.AddXbimToolkit(configuration => configuration.AddLoggerFactory(factory)));
            }

            configured = true;
        }
    }
}
