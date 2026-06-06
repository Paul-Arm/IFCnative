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
        try
        {
            var preflightErrors = ValidateDocumentShape(document);
            if (preflightErrors.Count > 0)
            {
                return new IfcExportValidationResult(false, document.Entities.Count, preflightErrors, []);
            }

            var geometryErrors = new List<string>();
            var geometryWarnings = new List<string>();
            if (geometryBackend is not null)
            {
                var originalGeometryValidation = geometryBackend.ValidateDocument(document);
                geometryErrors.AddRange(originalGeometryValidation.Errors);
                geometryWarnings.AddRange(originalGeometryValidation.Warnings);
            }

            var normalizedStep = XbimIfcDocumentService.NormalizeForExport(document);
            var reparsed = XbimIfcDocumentService.OpenText(normalizedStep, document.FileName);
            var errors = reparsed.Diagnostics.Messages
                .Where(message => message.StartsWith("Error:", StringComparison.OrdinalIgnoreCase))
                .ToList();
            var warnings = reparsed.Diagnostics.Messages
                .Where(message => message.StartsWith("Warning:", StringComparison.OrdinalIgnoreCase))
                .ToList();
            errors.AddRange(geometryErrors);
            warnings.AddRange(geometryWarnings);

            if (reparsed.Entities.Count != document.Entities.Count)
            {
                warnings.Add($"Warning: xBIM export normalization changed entity count from {document.Entities.Count:N0} to {reparsed.Entities.Count:N0}.");
            }

            if (geometryBackend is not null && geometryErrors.Count == 0)
            {
                var geometryValidation = geometryBackend.ValidateDocument(reparsed);
                errors.AddRange(geometryValidation.Errors);
                warnings.AddRange(geometryValidation.Warnings);
            }

            return new IfcExportValidationResult(errors.Count == 0, reparsed.Entities.Count, errors, warnings);
        }
        catch (Exception exception)
        {
            return new IfcExportValidationResult(
                false,
                document.Entities.Count,
                [$"Error: xBIM export validation failed: {exception.Message}"],
                []);
        }
    }

    private static List<string> ValidateDocumentShape(IfcDocument document)
    {
        var errors = new List<string>();

        if (document.XbimStore is null && string.IsNullOrWhiteSpace(document.HeaderText))
        {
            errors.Add("Error: HEADER section is missing.");
        }

        if (document.Entities.Count == 0)
        {
            errors.Add("Error: DATA section has no STEP entities.");
        }

        return errors;
    }
}
