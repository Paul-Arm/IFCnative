using IFCnative.NativeWindows.ViewModels;

namespace IFCnative.NativeWindows.Services;

public interface IIfcGeometryBackend
{
    string Name { get; }

    string Status { get; }

    IfcGeometryValidationResult ValidateDocument(IfcDocument document);

    IReadOnlyList<IfcViewportItem> ProjectDocument(IfcDocument document, int limit = 250);

    IReadOnlyList<IfcViewportItem> ProjectSelection(IfcDocument document, int entityId, int limit = 80);
}

public sealed record IfcGeometryValidationResult(string BackendName, IReadOnlyList<string> Errors, IReadOnlyList<string> Warnings)
{
    public bool CanExport => Errors.Count == 0;

    public string Summary => CanExport
        ? $"{BackendName} geometry validation passed"
        : $"{BackendName} geometry validation failed: {Errors.Count:N0} error(s)";
}
