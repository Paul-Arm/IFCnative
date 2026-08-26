namespace IFCnative.NativeWindows.ViewModels;

public sealed record IfcRelationshipDetails(
    int? RelationshipId,
    string Label,
    string SourceIds,
    string TargetIds,
    bool CanEdit)
{
    public static IfcRelationshipDetails Empty { get; } = new(null, string.Empty, string.Empty, string.Empty, false);
}
