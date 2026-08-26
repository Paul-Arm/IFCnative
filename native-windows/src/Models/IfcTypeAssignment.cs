namespace IFCnative.NativeWindows.Models;

public sealed class IfcTypeAssignment
{
    public required int RelationshipId { get; init; }

    public required int TypeId { get; init; }

    public required string TypeClass { get; init; }

    public required string TypeName { get; init; }

    public List<int> ObjectIds { get; } = [];

    public string Label => $"#{RelationshipId} {TypeClass} #{TypeId} {TypeName} → {string.Join(", ", ObjectIds.Select(id => $"#{id}"))}";
}
