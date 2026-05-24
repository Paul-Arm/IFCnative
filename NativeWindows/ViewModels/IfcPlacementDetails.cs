namespace IFCnative.NativeWindows.ViewModels;

public sealed record IfcPlacementDetails(
    bool CanEdit,
    string Label,
    string X,
    string Y,
    string Z)
{
    public static IfcPlacementDetails None { get; } = new(
        false,
        "No IFCLOCALPLACEMENT indexed for this entity.",
        string.Empty,
        string.Empty,
        string.Empty);
}
