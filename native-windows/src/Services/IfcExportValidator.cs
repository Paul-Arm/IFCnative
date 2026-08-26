namespace IFCnative.NativeWindows.Services;

public sealed record IfcExportValidationResult(bool CanExport, int EntityCount, IReadOnlyList<string> Errors, IReadOnlyList<string> Warnings)
{
    public string Summary => CanExport
        ? $"Export validation passed: reparsed {EntityCount:N0} entities"
        : $"Export validation failed: {Errors.Count:N0} error(s)";
}

public static class IfcExportValidator
{
    /// <summary>
    /// Validates the document for export. <paramref name="reportProgress"/>
    /// receives a stage label and a 0..1 fraction of the validation work; the
    /// full STEP roundtrip below takes seconds on large models, so callers
    /// should run this off the UI thread.
    /// </summary>
    public static IfcExportValidationResult Validate(
        IfcDocument document,
        IIfcGeometryBackend? geometryBackend = null,
        Action<string, double>? reportProgress = null)
    {
        try
        {
            reportProgress?.Invoke("Checking document shape...", 0.02);
            var preflightErrors = ValidateDocumentShape(document);
            if (preflightErrors.Count > 0)
            {
                return new IfcExportValidationResult(false, document.Entities.Count, preflightErrors, []);
            }

            var geometryErrors = new List<string>();
            var geometryWarnings = new List<string>();
            if (geometryBackend is not null)
            {
                reportProgress?.Invoke("Validating geometry...", 0.08);
                var originalGeometryValidation = geometryBackend.ValidateDocument(document);
                geometryErrors.AddRange(originalGeometryValidation.Errors);
                geometryWarnings.AddRange(originalGeometryValidation.Warnings);
            }

            reportProgress?.Invoke("Normalizing STEP output...", 0.30);
            var normalizedStep = XbimIfcDocumentService.NormalizeForExport(document);
            reportProgress?.Invoke("Re-parsing normalized STEP...", 0.55);
            var reparsed = XbimIfcDocumentService.OpenText(normalizedStep, document.FileName);
            reportProgress?.Invoke("Running diagnostics...", 0.75);
            IfcDocumentDiagnostics.Run(reparsed);
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
                reportProgress?.Invoke("Validating normalized geometry...", 0.85);
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
