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
            GetRepresentations(document, entity).ToList(),
            GetPropertySets(document, entity).ToList(),
            GetTypeAssignments(document, entity).ToList(),
            GetResources(document, entity).ToList(),
            document.Units.Count > 0 ? document.Units : ["No IFCUNITASSIGNMENT units indexed."]);
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

    private static IEnumerable<string> GetPropertySets(IfcDocument document, IfcEntity entity)
    {
        if (!document.PropertySetsByEntity.TryGetValue(entity.Id, out var propertySets))
        {
            yield return "No property or quantity sets indexed for this entity.";
            yield break;
        }

        foreach (var propertySet in propertySets.OrderBy(set => set.Kind).ThenBy(set => set.Name).ThenBy(set => set.Id))
        {
            yield return propertySet.Label;
            foreach (var value in propertySet.Values)
            {
                yield return $"  • {value.Label}";
            }
        }
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

    private static IEnumerable<string> GetRelationships(IfcDocument document, IfcEntity entity)
    {
        if (!document.RelationshipsByEntity.TryGetValue(entity.Id, out var relationships))
        {
            yield return "No indexed IFC relationships for this entity.";
            yield break;
        }

        foreach (var relationship in relationships.OrderBy(relationship => relationship.Type).ThenBy(relationship => relationship.Id))
        {
            yield return relationship.Label;
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
