using IFCnative.NativeWindows.Models;
using IFCnative.NativeWindows.ViewModels;

namespace IFCnative.NativeWindows.Services;

public static class IfcNavigationProjector
{
    public static IReadOnlyList<IfcTypeCount> GetTypeCounts(IfcDocument document)
    {
        return document.EntitiesByType
            .OrderByDescending(pair => pair.Value.Count)
            .ThenBy(pair => pair.Key)
            .Select(pair => new IfcTypeCount(pair.Key, pair.Value.Count))
            .ToList();
    }

    public static IReadOnlyList<IfcTreeNode> GetBookmarks(IfcDocument document, IEnumerable<int> bookmarkedEntityIds)
    {
        return bookmarkedEntityIds
            .Where(document.EntityById.ContainsKey)
            .OrderBy(id => id)
            .Select(id => new IfcTreeNode(document.EntityById[id], "pinned"))
            .ToList();
    }

    public static IReadOnlyList<IfcTreeNode> Search(IfcDocument document, string search, int limit = 500)
    {
        if (string.IsNullOrWhiteSpace(search))
        {
            return document.SpatialRoots;
        }

        var normalizedSearch = search.Trim();
        return document.Entities
            .Where(entity => Matches(document, entity, normalizedSearch))
            .Take(limit)
            .Select(entity => new IfcTreeNode(entity, "match"))
            .ToList();
    }

    public static string GetDocumentViewportSummary(IfcDocument document)
    {
        return $"{document.FileName}: {document.SpatialRoots.Count:N0} root nodes, {document.EntitiesByType.Count:N0} entity types.";
    }

    public static string GetTypeViewportSummary(IfcTypeCount typeCount)
    {
        return $"{typeCount.Type}: {typeCount.Count:N0} indexed entities. Geometry streaming is the next web-ifc bridge task.";
    }

    private static bool Matches(IfcDocument document, IfcEntity entity, string search)
    {
        return entity.Id.ToString().Contains(search, StringComparison.OrdinalIgnoreCase)
            || entity.Type.Contains(search, StringComparison.OrdinalIgnoreCase)
            || entity.Name.Contains(search, StringComparison.OrdinalIgnoreCase)
            || entity.GlobalId.Contains(search, StringComparison.OrdinalIgnoreCase)
            || (document.SpatialPathByEntity.TryGetValue(entity.Id, out var path)
                && path.Contains(search, StringComparison.OrdinalIgnoreCase));
    }
}
