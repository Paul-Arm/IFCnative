using IFCnative.NativeWindows.Models;
using IFCnative.NativeWindows.ViewModels;
using Xbim.Common.Geometry;

namespace IFCnative.NativeWindows.Services;

public sealed class XbimGeometryBackend : IIfcGeometryBackend
{
    public string Name => "xBIM geometry";

    public string Status => "Using xBIM/OpenCascade geometry; STEP is projected into the UI after xBIM import.";

    public IfcGeometryValidationResult ValidateDocument(IfcDocument document)
    {
        try
        {
            var context = XbimIfcDocumentService.EnsureGeometryContext(document);
            var instances = context.ShapeInstances().ToList();
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
            var context = XbimIfcDocumentService.EnsureGeometryContext(document);
            var instances = context.ShapeInstances().ToList();
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
            var context = XbimIfcDocumentService.EnsureGeometryContext(document);
            var instances = context.ShapeInstances()
                .Where(instance => instance.IfcProductLabel == entityId)
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
            var context = XbimIfcDocumentService.EnsureGeometryContext(document);
            var productIds = items
                .Where(item => item.EntityId is not null)
                .Select(item => item.EntityId!.Value)
                .ToHashSet();

            var instances = context.ShapeInstances()
                .Where(instance => productIds.Count == 0 || productIds.Contains(instance.IfcProductLabel))
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

    private static string DescribeProduct(IfcDocument document, int productId, int shapeCount)
    {
        if (!document.EntityById.TryGetValue(productId, out var entity))
        {
            return $"#{productId}: {shapeCount:N0} xBIM shape instance(s)";
        }

        return $"#{entity.Id} {entity.TypeName()} {entity.DisplayName}: {shapeCount:N0} xBIM shape instance(s)";
    }
}
