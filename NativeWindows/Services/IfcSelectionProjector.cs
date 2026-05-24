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
            GetRelationshipGraph(document, entity).ToList(),
            GetSpatial(document, entity),
            GetPlacement(document, entity),
            GetRepresentations(document, entity).ToList(),
            GetPropertySets(document, entity).ToList(),
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
                IfcDocumentEditor.CanUpdateRelationshipEndpoints(relationship.Type));
        }
    }

    private static IEnumerable<IfcRelationshipGraphItem> GetRelationshipGraph(IfcDocument document, IfcEntity entity)
    {
        if (!document.RelationshipsByEntity.TryGetValue(entity.Id, out var relationships))
        {
            yield return new IfcRelationshipGraphItem(null, null, "No relationship graph neighbors indexed for this entity.", 0, false);
            yield break;
        }

        var emittedEntities = new HashSet<int> { entity.Id };

        foreach (var relationship in relationships.OrderBy(relationship => relationship.Type).ThenBy(relationship => relationship.Id))
        {
            var isSource = relationship.SourceIds.Contains(entity.Id);
            var isTarget = relationship.TargetIds.Contains(entity.Id);
            var direction = isSource && isTarget ? "↔" : isSource ? "→" : "←";
            var neighborIds = isSource
                ? relationship.TargetIds
                : relationship.SourceIds.Count > 0
                    ? relationship.SourceIds
                    : relationship.TargetIds.Where(id => id != entity.Id).ToList();

            yield return new IfcRelationshipGraphItem(
                relationship.Id,
                null,
                $"{direction} #{relationship.Id} {relationship.Type}",
                0,
                false);

            foreach (var neighborId in neighborIds.Where(id => id != entity.Id).Distinct().OrderBy(id => id))
            {
                if (!document.EntityById.TryGetValue(neighborId, out var neighbor))
                {
                    yield return new IfcRelationshipGraphItem(
                        relationship.Id,
                        neighborId,
                        $"  • missing #{neighborId}",
                        1,
                        false);
                    continue;
                }

                var repeated = !emittedEntities.Add(neighborId);
                var suffix = repeated ? " (also linked above)" : string.Empty;
                yield return new IfcRelationshipGraphItem(
                    relationship.Id,
                    neighborId,
                    $"  • #{neighbor.Id} {neighbor.TypeName()} {neighbor.DisplayName}{suffix}",
                    1,
                    true);
            }
        }
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
