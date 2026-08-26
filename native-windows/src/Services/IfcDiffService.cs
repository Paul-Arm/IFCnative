using IFCnative.NativeWindows.Models;

namespace IFCnative.NativeWindows.Services;

public static class IfcDiffService
{
    public static List<string> Summarize(IfcDocument before, IfcDocument after, int maxChangedEntities = 100)
    {
        var lines = new List<string>();
        var beforeIds = before.EntityById.Keys.ToHashSet();
        var afterIds = after.EntityById.Keys.ToHashSet();
        var added = afterIds.Except(beforeIds).Order().ToList();
        var removed = beforeIds.Except(afterIds).Order().ToList();
        var changed = beforeIds.Intersect(afterIds)
            .Select(id => new { Id = id, Before = before.EntityById[id], After = after.EntityById[id] })
            .Where(item => item.Before.Type != item.After.Type || !item.Before.Arguments.SequenceEqual(item.After.Arguments))
            .OrderBy(item => item.Id)
            .ToList();

        lines.Add($"Draft summary: {added.Count:N0} added, {removed.Count:N0} removed, {changed.Count:N0} changed entities.");

        foreach (var id in added.Take(maxChangedEntities))
        {
            var entity = after.EntityById[id];
            lines.Add($"+ #{entity.Id} {entity.Type} {entity.DisplayName}");
        }

        foreach (var id in removed.Take(maxChangedEntities))
        {
            var entity = before.EntityById[id];
            lines.Add($"- #{entity.Id} {entity.Type} {entity.DisplayName}");
        }

        foreach (var item in changed.Take(maxChangedEntities))
        {
            lines.Add($"~ #{item.Id} {item.Before.Type} {DescribeEntityChange(item.Before, item.After)}");
        }

        var omitted = added.Count + removed.Count + changed.Count - Math.Min(added.Count, maxChangedEntities) - Math.Min(removed.Count, maxChangedEntities) - Math.Min(changed.Count, maxChangedEntities);
        if (omitted > 0)
        {
            lines.Add($"… {omitted:N0} additional entity changes omitted from preview.");
        }

        if (lines.Count == 1)
        {
            lines.Add("No STEP entity changes detected.");
        }

        return lines;
    }

    private static string DescribeEntityChange(IfcEntity before, IfcEntity after)
    {
        if (before.Type != after.Type)
        {
            return $"type changed {before.Type} → {after.Type}";
        }

        var changes = new List<string>();
        var max = Math.Max(before.Arguments.Count, after.Arguments.Count);
        for (var index = 0; index < max; index++)
        {
            var left = before.Arguments.ElementAtOrDefault(index) ?? "";
            var right = after.Arguments.ElementAtOrDefault(index) ?? "";
            if (left != right)
            {
                changes.Add($"arg {index + 1}: {StepArgumentReader.CompactPreview(left, 50)} → {StepArgumentReader.CompactPreview(right, 50)}");
            }
        }

        return string.Join("; ", changes.Take(4));
    }
}
