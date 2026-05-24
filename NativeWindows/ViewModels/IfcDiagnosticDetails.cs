namespace IFCnative.NativeWindows.ViewModels;

public sealed record IfcDiagnosticDetails(string Severity, string Message, string Suggestion)
{
    public string Label => string.IsNullOrWhiteSpace(Suggestion)
        ? $"{Severity}: {Message}"
        : $"{Severity}: {Message}\n  Suggestion: {Suggestion}";
}
