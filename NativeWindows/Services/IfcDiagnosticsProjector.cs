using IFCnative.NativeWindows.ViewModels;

namespace IFCnative.NativeWindows.Services;

public static class IfcDiagnosticsProjector
{
    public static IReadOnlyList<IfcDiagnosticDetails> Project(IEnumerable<string> messages, string? filter = null)
    {
        var normalizedFilter = filter?.Trim();
        var projected = messages
            .Select(Parse)
            .Where(item => MatchesFilter(item, normalizedFilter))
            .OrderBy(item => SeverityRank(item.Severity))
            .ThenBy(item => item.Message, StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (projected.Count == 0)
        {
            projected.Add(string.IsNullOrWhiteSpace(normalizedFilter)
                ? new IfcDiagnosticDetails("Info", "No diagnostics were reported.", string.Empty)
                : new IfcDiagnosticDetails("Info", $"No diagnostics match '{normalizedFilter}'.", "Clear the filter or search for a different severity/message."));
        }

        return projected;
    }

    private static bool MatchesFilter(IfcDiagnosticDetails item, string? filter)
    {
        if (string.IsNullOrWhiteSpace(filter))
        {
            return true;
        }

        return item.Severity.Contains(filter, StringComparison.OrdinalIgnoreCase)
            || item.Message.Contains(filter, StringComparison.OrdinalIgnoreCase)
            || item.Suggestion.Contains(filter, StringComparison.OrdinalIgnoreCase);
    }

    private static IfcDiagnosticDetails Parse(string rawMessage)
    {
        var severity = "Info";
        var message = rawMessage.Trim();

        foreach (var candidate in new[] { "Error", "Warning", "Info" })
        {
            var prefix = $"{candidate}:";
            if (!message.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            severity = candidate;
            message = message[prefix.Length..].Trim();
            break;
        }

        var entityIds = ExtractEntityIds(message).ToList();
        var entityId = entityIds.Count == 0 ? (int?)null : entityIds[0];
        var canRepairDuplicateGlobalId = message.Contains("Duplicate GlobalId", StringComparison.OrdinalIgnoreCase) && entityIds.Count > 1;
        var canRepairSpatialContainment = message.Contains("multiple primary spatial containment", StringComparison.OrdinalIgnoreCase) && entityIds.Count > 2;
        var canRepairMissingReference = message.Contains("references missing entity", StringComparison.OrdinalIgnoreCase) && entityIds.Count > 1;
        return new IfcDiagnosticDetails(severity, message, Suggest(message), entityId, canRepairDuplicateGlobalId, canRepairSpatialContainment, canRepairMissingReference);
    }

    private static IEnumerable<int> ExtractEntityIds(string message)
    {
        var hashIndex = message.IndexOf('#', StringComparison.Ordinal);
        while (hashIndex >= 0 && hashIndex + 1 < message.Length)
        {
            var start = hashIndex + 1;
            var end = start;
            while (end < message.Length && char.IsDigit(message[end]))
            {
                end++;
            }

            if (end > start && int.TryParse(message[start..end], out var entityId))
            {
                yield return entityId;
            }

            hashIndex = message.IndexOf('#', hashIndex + 1);
        }
    }

    private static int SeverityRank(string severity)
    {
        return severity switch
        {
            "Error" => 0,
            "Warning" => 1,
            _ => 2,
        };
    }

    private static string Suggest(string message)
    {
        var normalized = message.ToUpperInvariant();

        if (normalized.Contains("ISO-10303-21") || normalized.Contains("HEADER SECTION") || normalized.Contains("DATA SECTION"))
        {
            return "Check the STEP file envelope before editing/exporting.";
        }

        if (normalized.Contains("REFERENCES MISSING ENTITY"))
        {
            return "Open the relationship/entity, replace the dangling STEP id, or recreate the missing target before export.";
        }

        if (normalized.Contains("DUPLICATE GLOBALID"))
        {
            return "Regenerate one of the duplicated GlobalIds so each rooted object remains uniquely identifiable.";
        }

        if (normalized.Contains("MULTIPLE PRIMARY SPATIAL CONTAINMENT"))
        {
            return "Keep only one IFCRELCONTAINEDINSPATIALSTRUCTURE parent for the product.";
        }

        if (normalized.Contains("NO OBJECTPLACEMENT") || normalized.Contains("OBJECTPLACEMENT POINTS"))
        {
            return "Assign a valid IFCLOCALPLACEMENT or exclude this object from geometry-dependent workflows.";
        }

        if (normalized.Contains("NO REPRESENTATION") || normalized.Contains("REPRESENTATION POINTS"))
        {
            return "Assign a valid IFCPRODUCTDEFINITIONSHAPE if this product should render/export with geometry.";
        }

        return string.Empty;
    }
}
