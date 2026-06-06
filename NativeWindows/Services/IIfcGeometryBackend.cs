using IFCnative.NativeWindows.ViewModels;

namespace IFCnative.NativeWindows.Services;

public interface IIfcGeometryBackend
{
    string Name { get; }

    string Status { get; }

    IfcGeometryValidationResult ValidateDocument(IfcDocument document);

    IReadOnlyList<IfcViewportItem> ProjectDocument(IfcDocument document, int limit = 250);

    IReadOnlyList<IfcViewportItem> ProjectSelection(IfcDocument document, int entityId, int limit = 80);

    IReadOnlyList<IfcPreviewMesh> BuildPreviewMeshes(IfcDocument document, IReadOnlyList<IfcViewportItem> items, int limit = 48);
}

public sealed record IfcGeometryValidationResult(string BackendName, IReadOnlyList<string> Errors, IReadOnlyList<string> Warnings)
{
    public bool CanExport => Errors.Count == 0;

    public string Summary => CanExport
        ? $"{BackendName} geometry validation passed"
        : $"{BackendName} geometry validation failed: {Errors.Count:N0} error(s)";
}

public sealed record IfcPreviewVertex(double X, double Y, double Z);

public sealed record IfcPreviewMesh(
    int ProductSourceId,
    int PrimitiveSourceId,
    string Kind,
    string Label,
    IReadOnlyList<IfcPreviewVertex> Vertices,
    IReadOnlyList<int> TriangleIndices)
{
    public bool IsRenderable => Vertices.Count > 0 && TriangleIndices.Count > 0;
}
