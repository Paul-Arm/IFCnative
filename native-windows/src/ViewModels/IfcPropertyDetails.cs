namespace IFCnative.NativeWindows.ViewModels;

public sealed record IfcPropertyDetails(
    int? EntityId,
    string Label,
    string Value,
    bool CanEdit)
{
    public static IfcPropertyDetails Empty { get; } = new(null, "Select an editable property or quantity value.", string.Empty, false);
}
