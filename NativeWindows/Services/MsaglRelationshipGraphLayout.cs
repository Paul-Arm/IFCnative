using IFCnative.NativeWindows.Models;
using IFCnative.NativeWindows.ViewModels;
using Microsoft.Msagl.Core.Geometry;
using Microsoft.Msagl.Core.Geometry.Curves;
using Microsoft.Msagl.Drawing;
using Microsoft.Msagl.Miscellaneous;

namespace IFCnative.NativeWindows.Services;

public sealed record IfcGraphLayoutNode(
    string Key,
    int? EntityId,
    int? RelationshipId,
    string Label,
    string Kind,
    double X,
    double Y,
    bool IsSelected);

public sealed record IfcGraphLayoutEdge(
    string SourceKey,
    string TargetKey,
    string Label,
    double X1,
    double Y1,
    double X2,
    double Y2);

public sealed record IfcGraphLayout(
    IReadOnlyList<IfcGraphLayoutNode> Nodes,
    IReadOnlyList<IfcGraphLayoutEdge> Edges,
    double Width,
    double Height);

public static class MsaglRelationshipGraphLayout
{
    private const double NodeWidth = 160;
    private const double NodeHeight = 62;
    private const double Margin = 44;

    public static IfcGraphLayout Project(
        IfcDocument document,
        IfcEntity? selectedEntity,
        IReadOnlyList<IfcRelationshipGraphItem> graphItems,
        string direction = "LR")
    {
        if (selectedEntity is null)
        {
            return new IfcGraphLayout([], [], 420, 260);
        }

        var nodeModels = BuildNodeModels(document, selectedEntity, graphItems).ToList();
        var edgeModels = BuildEdgeModels(nodeModels, graphItems).ToList();
        if (nodeModels.Count == 0)
        {
            return new IfcGraphLayout([], [], 420, 260);
        }

        var graph = new Graph();
        graph.Attr.LayerDirection = direction.Equals("TB", StringComparison.OrdinalIgnoreCase)
            ? LayerDirection.TB
            : LayerDirection.LR;
        graph.Attr.NodeSeparation = 36;
        graph.Attr.LayerSeparation = 88;
        graph.Attr.Margin = 18;

        foreach (var node in nodeModels)
        {
            var msaglNode = graph.AddNode(node.Key);
            msaglNode.LabelText = node.Label;
            msaglNode.Attr.Shape = Shape.Box;
            msaglNode.Attr.LabelMargin = 8;
        }

        foreach (var edge in edgeModels)
        {
            graph.AddEdge(edge.SourceKey, edge.Label, edge.TargetKey);
        }

        graph.CreateGeometryGraph();
        foreach (var node in nodeModels)
        {
            graph.FindNode(node.Key).GeometryNode.BoundaryCurve = CurveFactory.CreateRectangle(
                NodeWidth,
                NodeHeight,
                new Microsoft.Msagl.Core.Geometry.Point(0, 0));
        }

        LayoutHelpers.CalculateLayout(graph.GeometryGraph, graph.LayoutAlgorithmSettings, null, null);

        var positions = nodeModels
            .Select(node =>
            {
                var msaglNode = graph.FindNode(node.Key);
                var center = msaglNode.GeometryNode.Center;
                return node with { X = center.X, Y = -center.Y };
            })
            .ToList();

        var minX = positions.Min(node => node.X);
        var minY = positions.Min(node => node.Y);
        var maxX = positions.Max(node => node.X);
        var maxY = positions.Max(node => node.Y);
        var normalized = positions
            .Select(node => node with
            {
                X = node.X - minX + Margin,
                Y = node.Y - minY + Margin,
            })
            .ToList();
        var byKey = normalized.ToDictionary(node => node.Key, StringComparer.OrdinalIgnoreCase);

        var edges = edgeModels
            .Where(edge => byKey.ContainsKey(edge.SourceKey) && byKey.ContainsKey(edge.TargetKey))
            .Select(edge =>
            {
                var source = byKey[edge.SourceKey];
                var target = byKey[edge.TargetKey];
                return new IfcGraphLayoutEdge(edge.SourceKey, edge.TargetKey, edge.Label, source.X, source.Y, target.X, target.Y);
            })
            .ToList();

        return new IfcGraphLayout(
            normalized,
            edges,
            Math.Max(420, maxX - minX + Margin * 2 + NodeWidth),
            Math.Max(260, maxY - minY + Margin * 2 + NodeHeight));
    }

    private static IEnumerable<IfcGraphLayoutNode> BuildNodeModels(
        IfcDocument document,
        IfcEntity selectedEntity,
        IReadOnlyList<IfcRelationshipGraphItem> graphItems)
    {
        yield return new IfcGraphLayoutNode(
            "selection",
            selectedEntity.Id,
            null,
            $"#{selectedEntity.Id} {selectedEntity.TypeName()}",
            "Selection",
            0,
            0,
            true);

        foreach (var relationship in graphItems
            .Where(item => item.RelationshipId is not null && item.EntityId is null)
            .GroupBy(item => item.RelationshipId!.Value)
            .Select(group => group.OrderBy(item => item.Depth).First())
            .OrderBy(item => item.Depth)
            .ThenBy(item => item.RelationshipId))
        {
            yield return new IfcGraphLayoutNode(
                RelationshipKey(relationship.RelationshipId!.Value),
                null,
                relationship.RelationshipId,
                CompactRelationshipLabel(relationship.Label),
                "Relationship",
                0,
                0,
                false);
        }

        foreach (var entityNode in graphItems
            .Where(item => item.EntityId is not null)
            .GroupBy(item => item.EntityId!.Value)
            .Select(group => group.OrderBy(item => item.Depth).First())
            .OrderBy(item => item.Depth)
            .ThenBy(item => item.EntityId))
        {
            var label = document.EntityById.TryGetValue(entityNode.EntityId!.Value, out var entity)
                ? $"#{entity.Id} {entity.TypeName()}"
                : $"#{entityNode.EntityId} missing";
            yield return new IfcGraphLayoutNode(
                EntityKey(entityNode.EntityId!.Value),
                entityNode.EntityId,
                null,
                label,
                "Entity",
                0,
                0,
                false);
        }
    }

    private static IEnumerable<(string SourceKey, string TargetKey, string Label)> BuildEdgeModels(
        IReadOnlyList<IfcGraphLayoutNode> nodeModels,
        IReadOnlyList<IfcRelationshipGraphItem> graphItems)
    {
        var nodeKeys = nodeModels.Select(node => node.Key).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var relationshipNode in graphItems
            .Where(item => item.RelationshipId is not null && item.EntityId is null)
            .GroupBy(item => item.RelationshipId!.Value)
            .Select(group => group.OrderBy(item => item.Depth).First()))
        {
            var relationshipKey = RelationshipKey(relationshipNode.RelationshipId!.Value);
            if (nodeKeys.Contains(relationshipKey))
            {
                yield return ("selection", relationshipKey, CompactRelationshipLabel(relationshipNode.Label));
            }

            foreach (var entityNode in graphItems.Where(item => item.RelationshipId == relationshipNode.RelationshipId && item.EntityId is not null))
            {
                var entityKey = EntityKey(entityNode.EntityId!.Value);
                if (nodeKeys.Contains(entityKey))
                {
                    yield return (relationshipKey, entityKey, CompactRelationshipLabel(relationshipNode.Label));
                }
            }
        }
    }

    private static string EntityKey(int entityId) => $"entity-{entityId}";

    private static string RelationshipKey(int relationshipId) => $"relationship-{relationshipId}";

    private static string CompactRelationshipLabel(string label)
    {
        var compact = label.Trim();
        if (compact.StartsWith('→') || compact.StartsWith('←') || compact.StartsWith('↔'))
        {
            compact = compact[1..].Trim();
        }

        var parts = compact.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        return parts.Length >= 2 ? $"{parts[0]} {parts[1]}" : compact;
    }
}
