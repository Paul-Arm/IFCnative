using IFCnative.NativeWindows.ViewModels;

namespace IFCnative.NativeWindows.Services;

public static class IfcDiagnosticsProjector
{
    public static IReadOnlyList<IfcDiagnosticDetails> Project(IEnumerable<string> messages)
    {
        var projected = messages
            .Select(Parse)
            .OrderBy(item => SeverityRank(item.Severity))
            .ThenBy(item => item.Message, StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (projected.Count == 0)
        {
            projected.Add(new IfcDiagnosticDetails("Info", "No diagnostics were reported.", string.Empty));
        }

        return projected;
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

        return new IfcDiagnosticDetails(severity, message, Suggest(message));
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
