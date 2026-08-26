namespace IFCnative.NativeWindows.ViewModels;

public sealed record IfcSpatialDetails(
    int? RelationshipId,
    string Label,
    string ParentId,
    bool CanEdit)
{
    public static IfcSpatialDetails None { get; } = new(null, "No editable spatial parent relationship indexed for this entity.", string.Empty, false);
}
