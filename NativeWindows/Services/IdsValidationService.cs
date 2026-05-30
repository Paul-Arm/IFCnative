using System.IO;
using System.Xml.Linq;
using IFCnative.NativeWindows.Models;

namespace IFCnative.NativeWindows.Services;

public sealed record IdsValidationIssue(
    string Severity,
    int? EntityId,
    string Message,
    string Suggestion)
{
    public string Label => EntityId is null
        ? $"{Severity}: {Message}"
        : $"{Severity}: #{EntityId} {Message}";
}

public sealed record IdsValidationResult(IReadOnlyList<IdsValidationIssue> Issues)
{
    public bool IsValid => Issues.All(issue => !issue.Severity.Equals("Error", StringComparison.OrdinalIgnoreCase));

    public string Summary => IsValid
        ? $"IDS validation passed with {Issues.Count(issue => issue.Severity.Equals("Warning", StringComparison.OrdinalIgnoreCase)):N0} warning(s)."
        : $"IDS validation failed with {Issues.Count(issue => issue.Severity.Equals("Error", StringComparison.OrdinalIgnoreCase)):N0} error(s).";
}

public static class IdsValidationService
{
    public static async Task<IdsValidationResult> ValidateFileAsync(
        IfcDocument document,
        string idsPath,
        CancellationToken cancellationToken = default)
    {
        var xml = await File.ReadAllTextAsync(idsPath, cancellationToken);
        return Validate(document, xml);
    }

    public static IdsValidationResult Validate(IfcDocument document, string idsXml)
    {
        var issues = new List<IdsValidationIssue>();

        XDocument idsDocument;
        try
        {
            idsDocument = XDocument.Parse(idsXml);
        }
        catch (Exception exception) when (exception is not OutOfMemoryException)
        {
            return new IdsValidationResult(
            [
                new("Error", null, $"IDS XML could not be parsed: {exception.Message}", "Open a valid .ids XML file.")
            ]);
        }

        if (idsDocument.Root?.Name.LocalName.Equals("ids", StringComparison.OrdinalIgnoreCase) != true)
        {
            issues.Add(new IdsValidationIssue("Warning", null, "IDS root element is not named ids.", "Verify the selected file is a buildingSMART IDS document."));
        }

        var requiredEntityTypes = ExtractRequiredEntityTypes(idsDocument)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (requiredEntityTypes.Count == 0)
        {
            issues.Add(new IdsValidationIssue("Warning", null, "IDS file does not contain entity requirements that IFCnative can evaluate yet.", "Use IDS entity requirements or validate the file with the xBIM IDS bridge."));
            return new IdsValidationResult(issues);
        }

        foreach (var requiredType in requiredEntityTypes.OrderBy(type => type, StringComparer.OrdinalIgnoreCase))
        {
            if (document.EntitiesByType.TryGetValue(requiredType, out var matchingEntities) && matchingEntities.Count > 0)
            {
                issues.Add(new IdsValidationIssue("Info", matchingEntities[0].Id, $"IDS entity requirement {requiredType} matched {matchingEntities.Count:N0} entity/entities.", string.Empty));
                continue;
            }

            issues.Add(new IdsValidationIssue("Error", null, $"IDS entity requirement {requiredType} did not match the current IFC model.", "Add or reclassify a matching entity before export/review."));
        }

        return new IdsValidationResult(issues);
    }

    public static void AppendDiagnostics(IfcDocument document, IdsValidationResult result)
    {
        foreach (var issue in result.Issues)
        {
            switch (issue.Severity)
            {
                case "Error":
                    document.Diagnostics.Error(issue.EntityId is null ? issue.Message : $"#{issue.EntityId} {issue.Message}");
                    break;
                case "Warning":
                    document.Diagnostics.Warn(issue.EntityId is null ? issue.Message : $"#{issue.EntityId} {issue.Message}");
                    break;
                default:
                    document.Diagnostics.Info(issue.EntityId is null ? issue.Message : $"#{issue.EntityId} {issue.Message}");
                    break;
            }
        }
    }

    private static IEnumerable<string> ExtractRequiredEntityTypes(XDocument idsDocument)
    {
        foreach (var entityElement in idsDocument.Descendants().Where(element => element.Name.LocalName.Equals("entity", StringComparison.OrdinalIgnoreCase)))
        {
            foreach (var candidate in ExtractEntityNames(entityElement))
            {
                var normalized = NormalizeEntityType(candidate);
                if (!string.IsNullOrWhiteSpace(normalized))
                {
                    yield return normalized;
                }
            }
        }
    }

    private static IEnumerable<string> ExtractEntityNames(XElement entityElement)
    {
        foreach (var attributeName in new[] { "name", "type", "simpleValue" })
        {
            var value = entityElement.Attribute(attributeName)?.Value;
            if (!string.IsNullOrWhiteSpace(value))
            {
                yield return value;
            }
        }

        foreach (var child in entityElement.Descendants())
        {
            if (!child.Name.LocalName.Equals("name", StringComparison.OrdinalIgnoreCase)
                && !child.Name.LocalName.Equals("simpleValue", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            foreach (var attributeName in new[] { "simpleValue", "value" })
            {
                var value = child.Attribute(attributeName)?.Value;
                if (!string.IsNullOrWhiteSpace(value))
                {
                    yield return value;
                }
            }

            if (!string.IsNullOrWhiteSpace(child.Value))
            {
                yield return child.Value;
            }
        }
    }

    private static string NormalizeEntityType(string candidate)
    {
        var normalized = candidate.Trim().Trim('\'', '"').ToUpperInvariant();
        return normalized.StartsWith("IFC", StringComparison.OrdinalIgnoreCase)
            ? normalized
            : string.Empty;
    }
}
