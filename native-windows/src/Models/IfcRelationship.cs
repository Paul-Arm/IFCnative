namespace IFCnative.NativeWindows.Models;

public sealed class IfcRelationship
{
    public required int Id { get; init; }

    public required string Type { get; init; }

    public List<int> SourceIds { get; } = [];

    public List<int> TargetIds { get; } = [];

    public string Label
    {
        get
        {
            var source = SourceIds.Count == 0 ? "-" : string.Join(", ", SourceIds.Select(id => $"#{id}"));
            var target = TargetIds.Count == 0 ? "-" : string.Join(", ", TargetIds.Select(id => $"#{id}"));
            return $"#{Id} {Type}: {source} → {target}";
        }
    }
}
