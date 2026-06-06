using IFCnative.NativeWindows.Models;
using IFCnative.NativeWindows.ViewModels;

namespace IFCnative.NativeWindows.Services;

public sealed class NativeMemoryGeometryBackend : IIfcGeometryBackend
{
    public string Name => "Native memory geometry";

    public string Status => "Using the in-memory IFC model; STEP is only the import/export boundary.";

    public IfcGeometryValidationResult ValidateDocument(IfcDocument document)
    {
        var errors = new List<string>();
        var warnings = new List<string>();
        var model = document.MemoryModel;

        if (model.Objects.Count == 0 && document.Entities.Count > 0)
        {
            warnings.Add("Warning: Native in-memory model is empty although STEP entities were parsed.");
        }

        foreach (var geometry in model.ProductGeometryByProductId.Values.OrderBy(geometry => geometry.ProductSourceId))
        {
            if (!model.ObjectsBySourceId.ContainsKey(geometry.ProductSourceId))
            {
                errors.Add($"Error: Native model found geometry for missing product #{geometry.ProductSourceId}.");
            }

            if (geometry.Primitives.Count == 0)
            {
                warnings.Add($"Warning: Product #{geometry.ProductSourceId} has no native geometry primitives.");
            }

            foreach (var primitive in geometry.Primitives)
            {
                if (primitive.IsMissingReference)
                {
                    errors.Add($"Error: Product #{geometry.ProductSourceId} references missing geometry item #{primitive.SourceId}.");
                }
                else if (primitive.Kind == "ExtrudedAreaSolid" && (!primitive.SizeZ.HasValue || primitive.SizeZ.Value <= 0))
                {
                    warnings.Add($"Warning: Product #{geometry.ProductSourceId} has extruded solid #{primitive.SourceId} without a positive depth.");
                }
            }
        }

        if (model.ProductGeometryByProductId.Count == 0 && model.Objects.Any(modelObject => modelObject.IsPhysicalProduct))
        {
            warnings.Add("Warning: Native model found physical products but no product geometry.");
        }

        return new IfcGeometryValidationResult(Name, errors, warnings);
    }

    public IReadOnlyList<IfcViewportItem> ProjectDocument(IfcDocument document, int limit = 250)
    {
        var model = document.MemoryModel;
        var items = new List<IfcViewportItem>
        {
            new(null, $"{Name}: {model.ProductGeometryByProductId.Count:N0} product geometry object(s), {model.GeometryPrimitiveCount:N0} primitive(s)."),
            new(null, Status),
        };

        items.AddRange(model.ProductGeometryByProductId.Values
            .OrderBy(geometry => geometry.ProductSourceId)
            .Take(limit)
            .Select(geometry => new IfcViewportItem(geometry.ProductSourceId, DescribeProduct(model, geometry))));

        if (model.ProductGeometryByProductId.Count > limit)
        {
            items.Add(new IfcViewportItem(null, $"... {model.ProductGeometryByProductId.Count - limit:N0} additional represented products omitted from preview."));
        }

        if (items.Count == 2)
        {
            items.Add(new IfcViewportItem(null, "No native product geometry is available for this document yet."));
        }

        return items;
    }

    public IReadOnlyList<IfcViewportItem> ProjectSelection(IfcDocument document, int entityId, int limit = 80)
    {
        var model = document.MemoryModel;
        var items = new List<IfcViewportItem>
        {
            new(null, $"{Name}: selected entity #{entityId}."),
        };

        if (model.ProductGeometryByProductId.TryGetValue(entityId, out var selectedProductGeometry))
        {
            items.Add(new IfcViewportItem(entityId, DescribeProduct(model, selectedProductGeometry)));
            items.AddRange(selectedProductGeometry.Primitives
                .Take(limit)
                .Select(primitive => new IfcViewportItem(primitive.SourceId, $"  - {primitive.Label}")));

            if (selectedProductGeometry.Primitives.Count > limit)
            {
                items.Add(new IfcViewportItem(null, $"... {selectedProductGeometry.Primitives.Count - limit:N0} additional geometry primitives omitted from preview."));
            }

            return items;
        }

        var referencingProducts = model.ProductGeometryByProductId.Values
            .Where(geometry => geometry.ProductDefinitionShapeSourceId == entityId
                || geometry.ShapeRepresentations.Any(shape => shape.SourceId == entityId || shape.GeometryItemSourceIds.Contains(entityId))
                || geometry.Primitives.Any(primitive => primitive.SourceId == entityId
                    || primitive.MappedGeometrySourceId == entityId
                    || primitive.ReferencedSourceIds.Contains(entityId)))
            .OrderBy(geometry => geometry.ProductSourceId)
            .Take(limit)
            .ToList();

        if (referencingProducts.Count > 0)
        {
            items.Add(new IfcViewportItem(entityId, $"#{entityId} belongs to native product geometry:"));
            items.AddRange(referencingProducts.Select(geometry => new IfcViewportItem(geometry.ProductSourceId, DescribeProduct(model, geometry))));
            return items;
        }

        items.Add(new IfcViewportItem(entityId, "No native geometry references for this selection."));
        return items;
    }

    public IReadOnlyList<IfcPreviewMesh> BuildPreviewMeshes(IfcDocument document, IReadOnlyList<IfcViewportItem> items, int limit = 48)
    {
        var model = document.MemoryModel;
        var primitives = ResolvePreviewPrimitives(model, items)
            .Take(limit)
            .ToList();
        if (primitives.Count == 0)
        {
            return [];
        }

        var columns = Math.Max(1, (int)Math.Ceiling(Math.Sqrt(primitives.Count)));
        var meshes = new List<IfcPreviewMesh>();
        for (var index = 0; index < primitives.Count; index++)
        {
            var primitive = primitives[index].Primitive;
            var transform = NativeGeometryTransformService.ResolvePrimitiveTransform(model, primitives[index].Product, primitive, index, columns);
            var mesh = BuildPrimitiveMesh(primitives[index].Product.SourceId, primitive, transform);
            if (mesh is not null && mesh.IsRenderable)
            {
                meshes.Add(mesh);
            }
        }

        return meshes;
    }

    private static IReadOnlyList<PreviewPrimitive> ResolvePreviewPrimitives(IfcMemoryModel model, IReadOnlyList<IfcViewportItem> items)
    {
        var ids = items
            .Where(item => item.EntityId is not null)
            .Select(item => item.EntityId!.Value)
            .ToHashSet();
        var result = new List<PreviewPrimitive>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        foreach (var product in model.Objects.Where(modelObject => modelObject.Geometry is not null))
        {
            var geometry = product.Geometry!;
            if (ids.Count == 0 || ids.Contains(product.SourceId))
            {
                foreach (var primitive in geometry.Primitives.Where(primitive => !primitive.IsMissingReference))
                {
                    AddPreviewPrimitive(result, seen, product, primitive);
                }

                continue;
            }

            foreach (var primitive in geometry.Primitives.Where(primitive => !primitive.IsMissingReference && ids.Contains(primitive.SourceId)))
            {
                AddPreviewPrimitive(result, seen, product, primitive);
            }
        }

        return result;
    }

    private static void AddPreviewPrimitive(List<PreviewPrimitive> result, HashSet<string> seen, IfcModelObject product, IfcGeometryPrimitive primitive)
    {
        var key = $"{product.SourceId}:{primitive.SourceId}:{primitive.MappedGeometrySourceId}";
        if (seen.Add(key))
        {
            result.Add(new PreviewPrimitive(product, primitive));
        }
    }

    private static IfcPreviewMesh? BuildPrimitiveMesh(int productSourceId, IfcGeometryPrimitive primitive, NativeGeometryTransform transform)
    {
        return primitive.Kind switch
        {
            "BoundingBox" => BuildRectangularMesh(productSourceId, primitive, transform, IfcModelVector.UnitZ),
            "ExtrudedAreaSolid" when primitive.Profile?.Kind == "Circle" => BuildCylinderMesh(productSourceId, primitive, transform),
            "ExtrudedAreaSolid" => BuildRectangularMesh(productSourceId, primitive, transform, primitive.Direction),
            _ => null,
        };
    }

    private static IfcPreviewMesh BuildRectangularMesh(int productSourceId, IfcGeometryPrimitive primitive, NativeGeometryTransform transform, IfcModelVector direction)
    {
        var width = PositiveOrDefault(primitive.SizeX, 1);
        var depth = PositiveOrDefault(primitive.SizeY, 1);
        var height = PositiveOrDefault(primitive.SizeZ, 1);
        var x = width / 2;
        var y = depth / 2;
        var extrusion = NormalizeAndScaleLocal(direction, height);
        var bottomLocal = new List<IfcPreviewVertex>
        {
            NativeGeometryTransformService.ResolveProfilePoint(primitive.Profile, -x, -y, 0),
            NativeGeometryTransformService.ResolveProfilePoint(primitive.Profile, x, -y, 0),
            NativeGeometryTransformService.ResolveProfilePoint(primitive.Profile, x, y, 0),
            NativeGeometryTransformService.ResolveProfilePoint(primitive.Profile, -x, y, 0),
        };
        var vertices = bottomLocal
            .Concat(bottomLocal.Select(vertex => Add(vertex, extrusion)))
            .Select(transform.TransformPoint)
            .ToList();
        var indices = new List<int>
        {
            0, 2, 1,
            0, 3, 2,
            4, 5, 6,
            4, 6, 7,
            0, 1, 5,
            0, 5, 4,
            1, 2, 6,
            1, 6, 5,
            2, 3, 7,
            2, 7, 6,
            3, 0, 4,
            3, 4, 7,
        };

        return new IfcPreviewMesh(productSourceId, primitive.SourceId, primitive.Kind, primitive.Label, vertices, indices);
    }

    private static IfcPreviewMesh BuildCylinderMesh(int productSourceId, IfcGeometryPrimitive primitive, NativeGeometryTransform transform)
    {
        const int segments = 32;
        var radius = PositiveOrDefault(primitive.Profile?.Radius, PositiveOrDefault(primitive.SizeX, 1) / 2);
        var height = PositiveOrDefault(primitive.SizeZ, 1);
        var extrusion = NormalizeAndScaleLocal(primitive.Direction, height);
        var bottomLocal = new List<IfcPreviewVertex>(segments);
        for (var index = 0; index < segments; index++)
        {
            var angle = index * Math.Tau / segments;
            bottomLocal.Add(NativeGeometryTransformService.ResolveProfilePoint(
                primitive.Profile,
                Math.Cos(angle) * radius,
                Math.Sin(angle) * radius,
                0));
        }

        var vertices = new List<IfcPreviewVertex>(segments * 2 + 2);
        for (var index = 0; index < segments; index++)
        {
            vertices.Add(transform.TransformPoint(bottomLocal[index]));
        }

        for (var index = 0; index < segments; index++)
        {
            vertices.Add(transform.TransformPoint(Add(bottomLocal[index], extrusion)));
        }

        var bottomCenterIndex = vertices.Count;
        var localOrigin = NativeGeometryTransformService.ResolveProfilePoint(primitive.Profile, 0, 0, 0);
        vertices.Add(transform.TransformPoint(localOrigin));
        var topCenterIndex = vertices.Count;
        vertices.Add(transform.TransformPoint(Add(localOrigin, extrusion)));

        var indices = new List<int>(segments * 12);
        for (var index = 0; index < segments; index++)
        {
            var next = (index + 1) % segments;
            var top = index + segments;
            var nextTop = next + segments;
            indices.AddRange([index, next, nextTop, index, nextTop, top]);
            indices.AddRange([bottomCenterIndex, next, index]);
            indices.AddRange([topCenterIndex, top, nextTop]);
        }

        return new IfcPreviewMesh(productSourceId, primitive.SourceId, primitive.Kind, primitive.Label, vertices, indices);
    }

    private static double PositiveOrDefault(double? value, double fallback)
    {
        return value is > 0 && !double.IsNaN(value.Value) && !double.IsInfinity(value.Value)
            ? value.Value
            : fallback;
    }

    private static IfcPreviewVertex NormalizeAndScaleLocal(IfcModelVector vector, double length)
    {
        var vectorLength = Math.Sqrt(vector.X * vector.X + vector.Y * vector.Y + vector.Z * vector.Z);
        if (vectorLength <= 0 || double.IsNaN(vectorLength) || double.IsInfinity(vectorLength))
        {
            return new IfcPreviewVertex(0, 0, length);
        }

        return new IfcPreviewVertex(vector.X / vectorLength * length, vector.Y / vectorLength * length, vector.Z / vectorLength * length);
    }

    private static IfcPreviewVertex Add(IfcPreviewVertex left, IfcPreviewVertex right)
    {
        return new IfcPreviewVertex(left.X + right.X, left.Y + right.Y, left.Z + right.Z);
    }

    private static string DescribeProduct(IfcMemoryModel model, IfcProductGeometry geometry)
    {
        var productLabel = model.ObjectsBySourceId.TryGetValue(geometry.ProductSourceId, out var product)
            ? product.Label
            : $"#{geometry.ProductSourceId}";
        var placement = model.ObjectsBySourceId.TryGetValue(geometry.ProductSourceId, out var placedProduct) && placedProduct.Placement is not null
            ? $" at ({placedProduct.Placement.X:0.###}, {placedProduct.Placement.Y:0.###}, {placedProduct.Placement.Z:0.###})"
            : string.Empty;
        var primitives = geometry.Primitives.Count == 0
            ? "no native primitives"
            : string.Join("; ", geometry.Primitives.Take(3).Select(primitive => primitive.Label));
        var suffix = geometry.Primitives.Count > 3 ? " ..." : string.Empty;
        return $"{productLabel}{placement}: {primitives}{suffix}";
    }

    private sealed record PreviewPrimitive(IfcModelObject Product, IfcGeometryPrimitive Primitive);
}
