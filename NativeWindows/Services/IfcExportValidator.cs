namespace IFCnative.NativeWindows.Services;

public sealed record IfcExportValidationResult(bool CanExport, int EntityCount, IReadOnlyList<string> Errors, IReadOnlyList<string> Warnings)
{
    public string Summary => CanExport
        ? $"Export validation passed: reparsed {EntityCount:N0} entities"
        : $"Export validation failed: {Errors.Count:N0} error(s)";
}

public static class IfcExportValidator
{
    public static IfcExportValidationResult Validate(IfcDocument document, IIfcGeometryBackend? geometryBackend = null)
    {
        var reparsed = IfcStepParser.Parse(document.ToStepText(), document.FileName);
        var errors = reparsed.Diagnostics.Messages
            .Where(message => message.StartsWith("Error:", StringComparison.OrdinalIgnoreCase))
            .ToList();
        var warnings = reparsed.Diagnostics.Messages
            .Where(message => message.StartsWith("Warning:", StringComparison.OrdinalIgnoreCase))
            .ToList();

        if (reparsed.Entities.Count != document.Entities.Count)
        {
            errors.Add($"Error: Export reparse changed entity count from {document.Entities.Count:N0} to {reparsed.Entities.Count:N0}.");
        }

        if (geometryBackend is not null)
        {
            var geometryValidation = geometryBackend.ValidateDocument(reparsed);
            errors.AddRange(geometryValidation.Errors);
            warnings.AddRange(geometryValidation.Warnings);
        }

        return new IfcExportValidationResult(errors.Count == 0, reparsed.Entities.Count, errors, warnings);
    }
}
