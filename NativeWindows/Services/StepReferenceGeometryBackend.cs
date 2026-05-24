using IFCnative.NativeWindows;
using IFCnative.NativeWindows.Models;
using IFCnative.NativeWindows.ViewModels;

namespace IFCnative.NativeWindows.Services;

public sealed class StepReferenceGeometryBackend : IIfcGeometryBackend
{
    public string Name => "STEP reference geometry";

    public string Status => "Previewing IFC representation references; mesh/WASM tessellation can plug into this backend contract next.";

    public IfcGeometryValidationResult ValidateDocument(IfcDocument document)
    {
        var errors = new List<string>();
        var warnings = new List<string>();

        foreach (var summary in document.RepresentationsByEntity.Values.OrderBy(summary => summary.ProductId))
        {
            if (!document.EntityById.ContainsKey(summary.ProductId))
            {
                errors.Add($"Error: Geometry backend found representation for missing product #{summary.ProductId}.");
            }

            if (!document.EntityById.TryGetValue(summary.ProductDefinitionShapeId, out var productDefinitionShape))
            {
                errors.Add($"Error: Product #{summary.ProductId} references missing IFCPRODUCTDEFINITIONSHAPE #{summary.ProductDefinitionShapeId}.");
            }
            else if (!productDefinitionShape.Type.Equals("IFCPRODUCTDEFINITIONSHAPE", StringComparison.OrdinalIgnoreCase))
            {
                errors.Add($"Error: Product #{summary.ProductId} representation #{summary.ProductDefinitionShapeId} is {productDefinitionShape.Type}, not IFCPRODUCTDEFINITIONSHAPE.");
            }

            if (summary.ShapeRepresentationIds.Count == 0)
            {
                warnings.Add($"Warning: Product #{summary.ProductId} has no shape representation rows indexed.");
            }

            foreach (var shapeId in summary.ShapeRepresentationIds.Distinct())
            {
                if (!document.EntityById.TryGetValue(shapeId, out var shape))
                {
                    errors.Add($"Error: Product #{summary.ProductId} references missing IFCSHAPEREPRESENTATION #{shapeId}.");
                }
                else if (!shape.Type.Equals("IFCSHAPEREPRESENTATION", StringComparison.OrdinalIgnoreCase))
                {
                    errors.Add($"Error: Product #{summary.ProductId} shape reference #{shapeId} is {shape.Type}, not IFCSHAPEREPRESENTATION.");
                }
            }

            foreach (var geometryItemId in summary.GeometryItemIds.Distinct())
            {
                if (!document.EntityById.ContainsKey(geometryItemId))
                {
                    errors.Add($"Error: Product #{summary.ProductId} references missing geometry item #{geometryItemId}.");
                }
            }
        }

        if (document.RepresentationsByEntity.Count == 0 && document.Entities.Any(entity => IsPhysicalProduct(entity.Type)))
        {
            warnings.Add("Warning: Geometry backend found physical products but no indexed product representations.");
        }

        return new IfcGeometryValidationResult(Name, errors, warnings);
    }

    public IReadOnlyList<IfcViewportItem> ProjectDocument(IfcDocument document, int limit = 250)
    {
        var items = new List<IfcViewportItem>
        {
            new(null, $"{Name}: {document.RepresentationsByEntity.Count:N0} products with indexed shape references."),
            new(null, Status),
        };

        items.AddRange(document.RepresentationsByEntity.Values
            .OrderBy(summary => summary.ProductId)
            .Take(limit)
            .Select(summary => new IfcViewportItem(summary.ProductId, DescribeProduct(document, summary))));

        if (document.RepresentationsByEntity.Count > limit)
        {
            items.Add(new IfcViewportItem(null, $"… {document.RepresentationsByEntity.Count - limit:N0} additional represented products omitted from preview."));
        }

        if (items.Count == 2)
        {
            items.Add(new IfcViewportItem(null, "No IFCPRODUCTDEFINITIONSHAPE references are indexed for this document yet."));
        }

        return items;
    }

    public IReadOnlyList<IfcViewportItem> ProjectSelection(IfcDocument document, int entityId, int limit = 80)
    {
        var items = new List<IfcViewportItem>
        {
            new(null, $"{Name}: selected entity #{entityId}."),
        };

        if (document.RepresentationsByEntity.TryGetValue(entityId, out var representation))
        {
            items.Add(new IfcViewportItem(entityId, DescribeProduct(document, representation)));
            foreach (var geometryItemId in representation.GeometryItemIds.Distinct().Take(limit))
            {
                items.Add(new IfcViewportItem(geometryItemId, $"  • #{geometryItemId} {DescribeGeometry(document, geometryItemId, 0, [])}"));
            }

            if (representation.GeometryItemIds.Count > limit)
            {
                items.Add(new IfcViewportItem(null, $"… {representation.GeometryItemIds.Count - limit:N0} additional geometry items omitted from preview."));
            }

            return items;
        }

        var referencingProducts = document.RepresentationsByEntity.Values
            .Where(summary => summary.ShapeRepresentationIds.Contains(entityId)
                || summary.GeometryItemIds.Contains(entityId)
                || summary.ProductDefinitionShapeId == entityId)
            .OrderBy(summary => summary.ProductId)
            .Take(limit)
            .ToList();

        if (referencingProducts.Count > 0)
        {
            items.Add(new IfcViewportItem(entityId, $"#{entityId} is referenced by represented products:"));
            items.AddRange(referencingProducts.Select(summary => new IfcViewportItem(summary.ProductId, DescribeProduct(document, summary))));
            return items;
        }

        items.Add(new IfcViewportItem(entityId, "No indexed representation references for this selection."));
        return items;
    }

    private static string DescribeProduct(IfcDocument document, IfcRepresentationSummary summary)
    {
        var productLabel = document.EntityById.TryGetValue(summary.ProductId, out var product)
            ? $"#{product.Id} {product.TypeName()} {product.DisplayName}"
            : $"#{summary.ProductId}";
        var placement = document.PlacementsByEntity.TryGetValue(summary.ProductId, out var placementSummary)
            ? $" at ({placementSummary.X:0.###}, {placementSummary.Y:0.###}, {placementSummary.Z:0.###})"
            : string.Empty;
        var geometry = summary.GeometryItemIds.Count == 0
            ? "no geometry items"
            : string.Join("; ", summary.GeometryItemIds.Distinct().Take(3).Select(id => $"#{id} {DescribeGeometry(document, id, 0, [])}"));
        var suffix = summary.GeometryItemIds.Distinct().Count() > 3 ? " …" : string.Empty;
        return $"{productLabel}{placement}: {geometry}{suffix}";
    }

    private static string DescribeGeometry(IfcDocument document, int entityId, int depth, HashSet<int> visited)
    {
        if (!visited.Add(entityId))
        {
            return "cyclic geometry reference";
        }

        if (!document.EntityById.TryGetValue(entityId, out var entity))
        {
            return "missing geometry reference";
        }

        if (depth > 3)
        {
            return entity.Type;
        }

        return entity.Type switch
        {
            "IFCEXTRUDEDAREASOLID" => DescribeExtrudedSolid(document, entity, depth, visited),
            "IFCRECTANGLEPROFILEDEF" => $"rectangle profile {Argument(entity, 3)} × {Argument(entity, 4)}",
            "IFCCIRCLEPROFILEDEF" => $"circle profile radius {Argument(entity, 3)}",
            "IFCBOUNDINGBOX" => $"bounding box {Argument(entity, 3)} × {Argument(entity, 4)} × {Argument(entity, 5)}",
            "IFCSHAPEREPRESENTATION" => DescribeShapeRepresentation(document, entity, depth, visited),
            _ => DescribeFallback(entity),
        };
    }

    private static string DescribeExtrudedSolid(IfcDocument document, IfcEntity entity, int depth, HashSet<int> visited)
    {
        var profileId = StepArgumentReader.ReadReferences(Argument(entity, 0)).FirstOrDefault();
        var profile = profileId == 0 ? "profile ?" : $"#{profileId} {DescribeGeometry(document, profileId, depth + 1, visited)}";
        return $"extruded {profile}, depth {Argument(entity, 3)}";
    }

    private static string DescribeShapeRepresentation(IfcDocument document, IfcEntity entity, int depth, HashSet<int> visited)
    {
        var representationType = Argument(entity, 2);
        var items = StepArgumentReader.ReadReferences(Argument(entity, 3))
            .Take(3)
            .Select(id => $"#{id} {DescribeGeometry(document, id, depth + 1, visited)}");
        return $"shape representation {representationType}: {string.Join("; ", items)}";
    }

    private static string DescribeFallback(IfcEntity entity)
    {
        var refs = entity.Arguments.SelectMany(StepArgumentReader.ReadReferences).Distinct().Take(6).Select(id => $"#{id}");
        var refText = string.Join(" → ", refs);
        return string.IsNullOrWhiteSpace(refText) ? entity.Type : $"{entity.Type} {refText}";
    }

    private static string Argument(IfcEntity entity, int index)
    {
        return StepArgumentReader.CompactPreview(entity.Arguments.ElementAtOrDefault(index) ?? "?", 80);
    }

    private static bool IsPhysicalProduct(string type)
    {
        return type.StartsWith("IFC", StringComparison.OrdinalIgnoreCase)
            && (type.Contains("ELEMENT", StringComparison.OrdinalIgnoreCase)
                || type.Contains("FURNISHING", StringComparison.OrdinalIgnoreCase)
                || type.Contains("PROXY", StringComparison.OrdinalIgnoreCase));
    }
}
