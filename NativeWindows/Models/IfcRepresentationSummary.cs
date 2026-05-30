namespace IFCnative.NativeWindows.Models;

public sealed class IfcRepresentationSummary
{
    public required int ProductId { get; init; }

    public required int ProductDefinitionShapeId { get; init; }

    public List<int> ShapeRepresentationIds { get; } = [];

    public List<int> GeometryItemIds { get; } = [];

    public string Label
    {
        get
        {
            var shapes = ShapeRepresentationIds.Count == 0
                ? "no shape representations"
                : string.Join(", ", ShapeRepresentationIds.Select(id => $"#{id}"));
            var items = GeometryItemIds.Count == 0
                ? "no geometry items"
                : string.Join(", ", GeometryItemIds.Select(id => $"#{id}"));
            return $"Product shape #{ProductDefinitionShapeId}: {shapes}; items {items}";
        }
    }
}
