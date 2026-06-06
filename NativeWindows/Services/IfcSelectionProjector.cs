using IFCnative.NativeWindows.Models;
using IFCnative.NativeWindows.ViewModels;

namespace IFCnative.NativeWindows.Services;

public static class IfcSelectionProjector
{
    public static IfcSelectionDetails Project(IfcDocument document, IfcEntity entity)
    {
        return new IfcSelectionDetails(
            entity,
            document.SpatialPathByEntity.TryGetValue(entity.Id, out var path) ? path : "-",
            GetIncomingReferences(document, entity).ToList(),
            GetRelationships(document, entity).ToList(),
            ProjectRelationshipGraph(document, entity).ToList(),
            GetSpatial(document, entity),
            GetPlacement(document, entity),
            GetRepresentations(document, entity).ToList(),
            GetPropertySets(document, entity).ToList(),
            GetPropertySetTables(document, entity).ToList(),
            GetTypeAssignments(document, entity).ToList(),
            GetResources(document, entity).ToList(),
            document.Units.Count > 0 ? document.Units : ["No IFCUNITASSIGNMENT units indexed."]);
    }

    private static IfcSpatialDetails GetSpatial(IfcDocument document, IfcEntity entity)
    {
        if (!document.RelationshipsByEntity.TryGetValue(entity.Id, out var relationships))
        {
            return IfcSpatialDetails.None;
        }

        var spatialRelationship = relationships
            .Where(relationship => relationship.TargetIds.Contains(entity.Id))
            .Where(relationship => relationship.Type is "IFCRELCONTAINEDINSPATIALSTRUCTURE" or "IFCRELAGGREGATES")
            .OrderBy(relationship => relationship.Type == "IFCRELCONTAINEDINSPATIALSTRUCTURE" ? 0 : 1)
            .ThenBy(relationship => relationship.Id)
            .FirstOrDefault();

        if (spatialRelationship is null)
        {
            return IfcSpatialDetails.None;
        }

        var parentId = spatialRelationship.SourceIds.FirstOrDefault();
        var parentLabel = parentId != 0 && document.EntityById.TryGetValue(parentId, out var parent)
            ? $"#{parent.Id} {parent.DisplayName}"
            : "-";

        return new IfcSpatialDetails(
            spatialRelationship.Id,
            $"#{spatialRelationship.Id} {spatialRelationship.Type}: parent {parentLabel}",
            parentId == 0 ? string.Empty : $"#{parentId}",
            true);
    }

    private static IfcPlacementDetails GetPlacement(IfcDocument document, IfcEntity entity)
    {
        return document.PlacementsByEntity.TryGetValue(entity.Id, out var placement)
            ? new IfcPlacementDetails(
                true,
                placement.Label,
                placement.X.ToString("0.########", System.Globalization.CultureInfo.InvariantCulture),
                placement.Y.ToString("0.########", System.Globalization.CultureInfo.InvariantCulture),
                placement.Z.ToString("0.########", System.Globalization.CultureInfo.InvariantCulture))
            : IfcPlacementDetails.None;
    }

    private static IEnumerable<string> GetRepresentations(IfcDocument document, IfcEntity entity)
    {
        if (!document.RepresentationsByEntity.TryGetValue(entity.Id, out var representation))
        {
            yield return "No IFCPRODUCTDEFINITIONSHAPE indexed for this entity.";
            yield break;
        }

        yield return representation.Label;
    }

    private static IEnumerable<IfcPropertyDetails> GetPropertySets(IfcDocument document, IfcEntity entity)
    {
        if (!document.PropertySetsByEntity.TryGetValue(entity.Id, out var propertySets))
        {
            yield return new IfcPropertyDetails(null, "No property or quantity sets indexed for this entity.", string.Empty, false);
            yield break;
        }

        foreach (var propertySet in propertySets.OrderBy(set => set.Kind).ThenBy(set => set.Name).ThenBy(set => set.Id))
        {
            yield return new IfcPropertyDetails(null, propertySet.Label, string.Empty, false);
            foreach (var value in propertySet.Values)
            {
                yield return new IfcPropertyDetails(value.Id, $"  • {value.Label}", value.Value, IsEditablePropertyValue(value.Type));
            }
        }
    }

    private static IEnumerable<IfcPropertySetTableDetails> GetPropertySetTables(IfcDocument document, IfcEntity entity)
    {
        if (!document.PropertySetsByEntity.TryGetValue(entity.Id, out var propertySets))
        {
            yield break;
        }

        foreach (var propertySet in propertySets.OrderBy(set => set.Kind).ThenBy(set => set.Name).ThenBy(set => set.Id))
        {
            yield return new IfcPropertySetTableDetails(
                propertySet.Id,
                propertySet.Kind,
                propertySet.Name,
                propertySet.Values
                    .Select(value => new IfcPropertyTableRowDetails(
                        value.Id,
                        value.Name,
                        value.Type,
                        value.Value,
                        IsEditablePropertyValue(value.Type)))
                    .ToList());
        }
    }

    private static bool IsEditablePropertyValue(string type)
    {
        return type is "IFCPROPERTYSINGLEVALUE" or "IFCQUANTITYLENGTH" or "IFCQUANTITYAREA" or "IFCQUANTITYVOLUME"
            or "IFCQUANTITYCOUNT" or "IFCQUANTITYWEIGHT" or "IFCQUANTITYTIME";
    }

    private static IEnumerable<string> GetTypeAssignments(IfcDocument document, IfcEntity entity)
    {
        if (!document.TypeAssignmentsByEntity.TryGetValue(entity.Id, out var assignments))
        {
            yield return "No IFC type assignments indexed for this entity.";
            yield break;
        }

        foreach (var assignment in assignments.OrderBy(assignment => assignment.TypeClass).ThenBy(assignment => assignment.TypeName).ThenBy(assignment => assignment.RelationshipId))
        {
            yield return assignment.Label;
        }
    }

    private static IEnumerable<string> GetResources(IfcDocument document, IfcEntity entity)
    {
        if (!document.ResourcesByEntity.TryGetValue(entity.Id, out var resources))
        {
            yield return "No material/classification/document/library resources indexed for this entity.";
            yield break;
        }

        foreach (var resource in resources.OrderBy(resource => resource, StringComparer.OrdinalIgnoreCase))
        {
            yield return resource;
        }
    }

    private static IEnumerable<IfcRelationshipDetails> GetRelationships(IfcDocument document, IfcEntity entity)
    {
        if (!document.RelationshipsByEntity.TryGetValue(entity.Id, out var relationships))
        {
            yield return new IfcRelationshipDetails(null, "No indexed IFC relationships for this entity.", string.Empty, string.Empty, false);
            yield break;
        }

        foreach (var relationship in relationships.OrderBy(relationship => relationship.Type).ThenBy(relationship => relationship.Id))
        {
            yield return new IfcRelationshipDetails(
                relationship.Id,
                relationship.Label,
                string.Join(", ", relationship.SourceIds.Select(id => $"#{id}")),
                string.Join(", ", relationship.TargetIds.Select(id => $"#{id}")),
                XbimDocumentEditor.CanUpdateRelationshipEndpoints(relationship.Type));
        }
    }

    public static IReadOnlyList<IfcRelationshipGraphItem> ProjectRelationshipGraph(IfcDocument document, IfcEntity entity, string? filter = null, int maxDepth = 1)
    {
        return GetRelationshipGraph(document, entity, filter, Math.Clamp(maxDepth, 1, 2)).ToList();
    }

    private static IEnumerable<IfcRelationshipGraphItem> GetRelationshipGraph(IfcDocument document, IfcEntity entity, string? filter, int maxDepth)
    {
        if (!document.RelationshipsByEntity.TryGetValue(entity.Id, out var relationships))
        {
            yield return new IfcRelationshipGraphItem(null, null, "No relationship graph neighbors indexed for this entity.", 0, false);
            yield break;
        }

        var emittedEntities = new HashSet<int> { entity.Id };
        var secondHopSeeds = new List<int>();

        foreach (var relationship in relationships.OrderBy(relationship => relationship.Type).ThenBy(relationship => relationship.Id))
        {
            foreach (var item in ProjectRelationshipNeighbors(document, entity.Id, relationship, filter, 0, emittedEntities, secondHopSeeds))
            {
                yield return item;
            }
        }

        if (maxDepth < 2)
        {
            yield break;
        }

        foreach (var seedId in secondHopSeeds.Distinct().OrderBy(id => id))
        {
            if (!document.RelationshipsByEntity.TryGetValue(seedId, out var seedRelationships))
            {
                continue;
            }

            foreach (var relationship in seedRelationships.OrderBy(relationship => relationship.Type).ThenBy(relationship => relationship.Id))
            {
                if (relationship.SourceIds.Contains(entity.Id) || relationship.TargetIds.Contains(entity.Id))
                {
                    continue;
                }

                foreach (var item in ProjectRelationshipNeighbors(document, seedId, relationship, filter, 1, emittedEntities, []))
                {
                    yield return item;
                }
            }
        }
    }

    private static IEnumerable<IfcRelationshipGraphItem> ProjectRelationshipNeighbors(
        IfcDocument document,
        int focusId,
        IfcRelationship relationship,
        string? filter,
        int depth,
        HashSet<int> emittedEntities,
        List<int> nextDepthSeeds)
    {
        var isSource = relationship.SourceIds.Contains(focusId);
        var isTarget = relationship.TargetIds.Contains(focusId);
        var direction = isSource && isTarget ? "↔" : isSource ? "→" : "←";
        var neighborIds = isSource
            ? relationship.TargetIds
            : relationship.SourceIds.Count > 0
                ? relationship.SourceIds
                : relationship.TargetIds.Where(id => id != focusId).ToList();
        var distinctNeighborIds = neighborIds.Where(id => id != focusId).Distinct().OrderBy(id => id).ToList();
        var relationshipLabel = $"{new string(' ', depth * 2)}{direction} #{relationship.Id} {relationship.Type}";
        var matchingNeighbors = distinctNeighborIds
            .Where(id => MatchesGraphFilter(document, id, relationship, filter))
            .ToList();

        if (!MatchesGraphFilter(relationshipLabel, filter) && matchingNeighbors.Count == 0)
        {
            yield break;
        }

        yield return new IfcRelationshipGraphItem(relationship.Id, null, relationshipLabel, depth, false);

        foreach (var neighborId in distinctNeighborIds)
        {
            if (!MatchesGraphFilter(document, neighborId, relationship, filter) && !MatchesGraphFilter(relationshipLabel, filter))
            {
                continue;
            }

            if (!document.EntityById.TryGetValue(neighborId, out var neighbor))
            {
                yield return new IfcRelationshipGraphItem(relationship.Id, neighborId, $"{new string(' ', (depth + 1) * 2)}• missing #{neighborId}", depth + 1, false);
                continue;
            }

            var repeated = !emittedEntities.Add(neighborId);
            var suffix = repeated ? " (also linked above)" : string.Empty;
            nextDepthSeeds.Add(neighborId);
            yield return new IfcRelationshipGraphItem(
                relationship.Id,
                neighborId,
                $"{new string(' ', (depth + 1) * 2)}• #{neighbor.Id} {neighbor.TypeName()} {neighbor.DisplayName}{suffix}",
                depth + 1,
                true);
        }
    }

    private static bool MatchesGraphFilter(IfcDocument document, int entityId, IfcRelationship relationship, string? filter)
    {
        if (string.IsNullOrWhiteSpace(filter))
        {
            return true;
        }

        if (MatchesGraphFilter($"#{relationship.Id} {relationship.Type} {relationship.Label}", filter))
        {
            return true;
        }

        return document.EntityById.TryGetValue(entityId, out var entity)
            ? MatchesGraphFilter($"#{entity.Id} {entity.Type} {entity.TypeName()} {entity.DisplayName} {entity.GlobalId}", filter)
            : MatchesGraphFilter($"#{entityId}", filter);
    }

    private static bool MatchesGraphFilter(string text, string? filter)
    {
        return string.IsNullOrWhiteSpace(filter) || text.Contains(filter.Trim(), StringComparison.OrdinalIgnoreCase);
    }

    private static IEnumerable<string> GetIncomingReferences(IfcDocument document, IfcEntity entity)
    {
        if (!document.IncomingReferences.TryGetValue(entity.Id, out var incoming))
        {
            yield return "No incoming references indexed.";
            yield break;
        }

        foreach (var reference in incoming.OrderBy(reference => reference.Type).ThenBy(reference => reference.Id))
        {
            yield return $"#{reference.Id} {reference.Type}: {StepArgumentReader.CompactPreview(string.Join(",", reference.Arguments))}";
        }
    }
}
