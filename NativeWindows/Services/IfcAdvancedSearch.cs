using IFCnative.NativeWindows.Models;

namespace IFCnative.NativeWindows.Services;

public sealed record IfcAdvancedSearchQuery(
    string? Text = null,
    string? Type = null,
    string? RelationshipKind = null,
    string? DiagnosticSeverity = null,
    bool? HasProperties = null,
    bool? HasResources = null);

public static class IfcAdvancedSearch
{
    public static IReadOnlyList<IfcEntity> Search(IfcDocument document, IfcAdvancedSearchQuery query, int limit = 500)
    {
        var normalizedText = query.Text?.Trim();
        var normalizedType = query.Type?.Trim();
        var normalizedRelationshipKind = query.RelationshipKind?.Trim();
        var diagnosticIds = GetDiagnosticEntityIds(document, query.DiagnosticSeverity);

        return document.Entities
            .Where(entity => MatchesText(document, entity, normalizedText))
            .Where(entity => MatchesType(entity, normalizedType))
            .Where(entity => MatchesRelationship(document, entity, normalizedRelationshipKind))
            .Where(entity => MatchesFlag(document.PropertySetsByEntity.ContainsKey(entity.Id), query.HasProperties))
            .Where(entity => MatchesFlag(document.ResourcesByEntity.ContainsKey(entity.Id), query.HasResources))
            .Where(entity => diagnosticIds is null || diagnosticIds.Contains(entity.Id))
            .OrderBy(entity => entity.Type, StringComparer.OrdinalIgnoreCase)
            .ThenBy(entity => entity.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(entity => entity.Id)
            .Take(Math.Clamp(limit, 1, 10_000))
            .ToList();
    }

    private static bool MatchesText(IfcDocument document, IfcEntity entity, string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return true;
        }

        return entity.Id.ToString(System.Globalization.CultureInfo.InvariantCulture).Contains(text, StringComparison.OrdinalIgnoreCase)
            || entity.Type.Contains(text, StringComparison.OrdinalIgnoreCase)
            || entity.Name.Contains(text, StringComparison.OrdinalIgnoreCase)
            || entity.GlobalId.Contains(text, StringComparison.OrdinalIgnoreCase)
            || (document.SpatialPathByEntity.TryGetValue(entity.Id, out var path) && path.Contains(text, StringComparison.OrdinalIgnoreCase))
            || (document.PropertySetsByEntity.TryGetValue(entity.Id, out var propertySets) && propertySets.Any(propertySet => MatchesPropertySet(propertySet, text)))
            || (document.ResourcesByEntity.TryGetValue(entity.Id, out var resources) && resources.Any(resource => resource.Contains(text, StringComparison.OrdinalIgnoreCase)))
            || (document.RelationshipsByEntity.TryGetValue(entity.Id, out var relationships) && relationships.Any(relationship => relationship.Type.Contains(text, StringComparison.OrdinalIgnoreCase)));
    }

    private static bool MatchesType(IfcEntity entity, string? type)
    {
        return string.IsNullOrWhiteSpace(type)
            || entity.Type.Contains(type, StringComparison.OrdinalIgnoreCase);
    }

    private static bool MatchesRelationship(IfcDocument document, IfcEntity entity, string? relationshipKind)
    {
        return string.IsNullOrWhiteSpace(relationshipKind)
            || document.RelationshipsByEntity.TryGetValue(entity.Id, out var relationships)
                && relationships.Any(relationship => relationship.Type.Contains(relationshipKind, StringComparison.OrdinalIgnoreCase));
    }

    private static bool MatchesPropertySet(IfcPropertySet propertySet, string text)
    {
        return propertySet.Name.Contains(text, StringComparison.OrdinalIgnoreCase)
            || propertySet.Kind.Contains(text, StringComparison.OrdinalIgnoreCase)
            || propertySet.Values.Any(value =>
                value.Name.Contains(text, StringComparison.OrdinalIgnoreCase)
                || value.Type.Contains(text, StringComparison.OrdinalIgnoreCase)
                || value.Value.Contains(text, StringComparison.OrdinalIgnoreCase));
    }

    private static bool MatchesFlag(bool actual, bool? expected)
    {
        return expected is null || actual == expected.Value;
    }

    private static HashSet<int>? GetDiagnosticEntityIds(IfcDocument document, string? severity)
    {
        if (string.IsNullOrWhiteSpace(severity))
        {
            return null;
        }

        var ids = new HashSet<int>();
        foreach (var message in document.Diagnostics.Messages.Where(message => message.StartsWith(severity, StringComparison.OrdinalIgnoreCase)))
        {
            var hashIndex = message.IndexOf('#', StringComparison.Ordinal);
            while (hashIndex >= 0)
            {
                var start = hashIndex + 1;
                var end = start;
                while (end < message.Length && char.IsDigit(message[end]))
                {
                    end++;
                }

                if (end > start && int.TryParse(message[start..end], out var id))
                {
                    ids.Add(id);
                }

                hashIndex = message.IndexOf('#', hashIndex + 1);
            }
        }

        return ids;
    }
}
