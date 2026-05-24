namespace IFCnative.NativeWindows.ViewModels;

public sealed record IfcDiagnosticDetails(string Severity, string Message, string Suggestion, int? EntityId = null, bool CanRepairDuplicateGlobalId = false)
{
    public bool CanNavigate => EntityId is not null;

    public bool CanRepair => CanRepairDuplicateGlobalId;

    public string Label => string.IsNullOrWhiteSpace(Suggestion)
        ? $"{Severity}: {Message}{NavigationSuffix}"
        : $"{Severity}: {Message}{NavigationSuffix}\n  Suggestion: {Suggestion}";

    private string NavigationSuffix => EntityId is null ? string.Empty : $" [#{EntityId.Value}]";
}
