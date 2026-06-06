using IFCnative.NativeWindows.Models;
using IFCnative.NativeWindows.ViewModels;
using Xbim.Common.Geometry;
using Xbim.Common.XbimExtensions;
using Xbim.ModelGeometry.Scene;

namespace IFCnative.NativeWindows.Services;

public sealed class XbimGeometryBackend : IIfcGeometryBackend
{
    private const int AutoGeometryEntityLimit = 5000;
    private const int AutoGeometryRepresentationLimit = 500;

    public string Name => "xBIM geometry";

    public string Status => "Using xBIM/OpenCascade geometry; the xBIM store is projected into the UI.";

    public IfcGeometryValidationResult ValidateDocument(IfcDocument document)
    {
        try
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
        progress?.Report("Generating xBIM geometry context...");
        XbimIfcDocumentService.EnsureGeometryContext(document);
        var store = XbimIfcDocumentService.EnsureStore(document);
        progress?.Report("Reading xBIM GeometryStore...");

        using var reader = store.GeometryStore.BeginRead();
        var instances = request.ProductId is int productId
            ? reader.ShapeInstancesOfEntity(productId).ToList()
            : reader.ShapeInstances.ToList();

        if (request.Limit is int limit && limit > 0)
        {
            instances = instances.Take(limit).ToList();
        }

        var meshes = new List<IfcRenderMesh>();
        var bounds = IfcRenderBounds.Empty;
        var triangleCount = 0;
        var decoded = 0;
        foreach (var instance in instances)
        {
            cancellationToken.ThrowIfCancellationRequested();

            if (!ShouldRenderInstance(instance))
            {
                continue;
            }

            var geometry = reader.ShapeGeometry(instance.ShapeGeometryLabel);
            var mesh = DecodeShapeGeometry(geometry, instance);
            if (mesh is null || !mesh.IsRenderable)
            {
                continue;
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

        var label = request.ProductId is int selectedProductId
            ? $"Selection #{selectedProductId}"
            : document.FileName;
        return new IfcRenderScene(
            label,
            meshes,
            bounds,
            instances.Count,
            triangleCount,
            $"xBIM GeometryStore: {meshes.Count:N0} mesh(es), {triangleCount:N0} triangle(s).");
    }

    private static IfcRenderMesh? DecodeShapeGeometry(IXbimShapeGeometryData geometry, IXbimShapeInstanceData instance)
    {
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
            .Select(point => new IfcRenderVertex(point[0], point[1], point[2], point[3], point[4], point[5]))
            .ToList();

        return new IfcRenderMesh(
            instance.IfcProductLabel,
            instance.ShapeGeometryLabel,
            instance.StyleLabel,
            instance.IfcTypeId,
            ColorFor(instance.StyleLabel, instance.IfcTypeId, instance.IfcProductLabel),
            vertices,
            indices);
    }

    private static bool ShouldRenderInstance(IXbimShapeInstanceData instance)
    {
        return instance.IfcProductLabel > 0
            && instance.RepresentationType == (byte)XbimGeometryRepresentationType.OpeningsAndAdditionsIncluded;
    }

    private static IfcRenderColor ColorFor(int styleLabel, int ifcTypeId, int productId)
    {
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
