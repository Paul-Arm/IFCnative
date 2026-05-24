namespace IFCnative.NativeWindows.ViewModels;

public sealed record IfcDiagnosticDetails(
    string Severity,
    string Message,
    string Suggestion,
    int? EntityId = null,
    bool CanRepairDuplicateGlobalId = false,
    bool CanRepairSpatialContainment = false,
    bool CanRepairMissingReference = false)
{
    public bool CanNavigate => EntityId is not null;

    public bool CanRepair => CanRepairDuplicateGlobalId || CanRepairSpatialContainment || CanRepairMissingReference;

    public string RepairLabel => CanRepairSpatialContainment
        ? "Stage spatial containment repair"
        : CanRepairMissingReference
            ? "Stage missing reference repair"
        : "Stage duplicate GlobalId repair";

    public string Label => string.IsNullOrWhiteSpace(Suggestion)
        ? $"{Severity}: {Message}{NavigationSuffix}"
        : $"{Severity}: {Message}{NavigationSuffix}\n  Suggestion: {Suggestion}";

    private string NavigationSuffix => EntityId is null ? string.Empty : $" [#{EntityId.Value}]";
}
