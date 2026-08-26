using IFCnative.NativeWindows.Models;

namespace IFCnative.NativeWindows.Services;

public sealed record IfcDiagnosticRunResult(int Errors, int Warnings, int Infos)
{
    public string Summary => $"Diagnostics checked: {Errors:N0} error(s), {Warnings:N0} warning(s).";
}

public static class IfcDocumentDiagnostics
{
    public static IfcDiagnosticRunResult Run(IfcDocument document)
    {
        document.Diagnostics.BeginCheck();

        ValidateRelationships(document);
        ValidateGlobalIds(document);
        ValidatePhysicalProducts(document);
        ValidatePrimarySpatialContainment(document);

        document.Diagnostics.CheckInfo(
            $"Checked {document.Entities.Count:N0} entities, {document.RelationshipById.Count:N0} relationships, {CountPhysicalProducts(document):N0} physical products.");

        return Summarize(document.Diagnostics.CheckMessages);
    }

    private static void ValidateRelationships(IfcDocument document)
    {
        foreach (var relationship in document.RelationshipById.Values)
        {
            foreach (var id in relationship.SourceIds.Concat(relationship.TargetIds).Distinct())
            {
                if (!document.EntityById.ContainsKey(id))
                {
                    document.Diagnostics.CheckWarn($"Relationship #{relationship.Id} {relationship.Type} references missing entity #{id}.");
                }
            }
        }
    }

    private static void ValidateGlobalIds(IfcDocument document)
    {
        var duplicateGlobalIds = document.Entities
            .Where(entity => !string.IsNullOrWhiteSpace(entity.GlobalId))
            .GroupBy(entity => entity.GlobalId, StringComparer.Ordinal)
            .Where(group => group.Count() > 1);

        foreach (var duplicate in duplicateGlobalIds)
        {
            document.Diagnostics.CheckWarn($"Duplicate GlobalId {duplicate.Key}: {string.Join(", ", duplicate.Select(entity => $"#{entity.Id}"))}.");
        }

        foreach (var entity in document.Entities.Where(entity => IsRootedEntity(entity.Type) && string.IsNullOrWhiteSpace(entity.GlobalId)))
        {
            document.Diagnostics.CheckWarn($"#{entity.Id} {entity.Type} has no GlobalId.");
        }
    }

    private static void ValidatePhysicalProducts(IfcDocument document)
    {
        foreach (var product in document.Entities.Where(entity => IsPhysicalProduct(entity.Type)))
        {
            if (!document.PlacementsByEntity.ContainsKey(product.Id))
            {
                var placementId = ReadReferenceArgument(product, 5);
                if (placementId == 0)
                {
                    document.Diagnostics.CheckWarn($"#{product.Id} {product.Type} has no ObjectPlacement.");
                }
                else if (!document.EntityById.TryGetValue(placementId, out var placement) || placement.Type != "IFCLOCALPLACEMENT")
                {
                    document.Diagnostics.CheckWarn($"#{product.Id} {product.Type} ObjectPlacement points to #{placementId}, not IFCLOCALPLACEMENT.");
                }
            }

            if (!document.RepresentationsByEntity.ContainsKey(product.Id))
            {
                var representationId = ReadReferenceArgument(product, 6);
                if (representationId == 0)
                {
                    document.Diagnostics.CheckWarn($"#{product.Id} {product.Type} has no Representation.");
                }
                else if (!document.EntityById.TryGetValue(representationId, out var representation) || representation.Type != "IFCPRODUCTDEFINITIONSHAPE")
                {
                    document.Diagnostics.CheckWarn($"#{product.Id} {product.Type} Representation points to #{representationId}, not IFCPRODUCTDEFINITIONSHAPE.");
                }
            }
        }
    }

    private static void ValidatePrimarySpatialContainment(IfcDocument document)
    {
        var primaryContainersByProduct = document.RelationshipById.Values
            .Where(relationship => relationship.Type == "IFCRELCONTAINEDINSPATIALSTRUCTURE")
            .SelectMany(relationship => relationship.TargetIds.Select(targetId => new { TargetId = targetId, RelationshipId = relationship.Id }))
            .GroupBy(item => item.TargetId)
            .Where(group => group.Count() > 1);

        foreach (var duplicateContainer in primaryContainersByProduct)
        {
            document.Diagnostics.CheckWarn($"Entity #{duplicateContainer.Key} has multiple primary spatial containment relationships: {string.Join(", ", duplicateContainer.Select(item => $"#{item.RelationshipId}"))}.");
        }
    }

    private static int CountPhysicalProducts(IfcDocument document)
    {
        return document.Entities.Count(entity => IsPhysicalProduct(entity.Type));
    }

    private static int ReadReferenceArgument(IfcEntity entity, int argumentIndex)
    {
        return StepArgumentReader.ReadReferences(entity.Arguments.ElementAtOrDefault(argumentIndex) ?? string.Empty).FirstOrDefault();
    }

    private static IfcDiagnosticRunResult Summarize(IEnumerable<string> messages)
    {
        var errors = 0;
        var warnings = 0;
        var infos = 0;

        foreach (var message in messages)
        {
            if (message.StartsWith("Error:", StringComparison.OrdinalIgnoreCase))
            {
                errors++;
            }
            else if (message.StartsWith("Warning:", StringComparison.OrdinalIgnoreCase))
            {
                warnings++;
            }
            else if (message.StartsWith("Info:", StringComparison.OrdinalIgnoreCase))
            {
                infos++;
            }
        }

        return new IfcDiagnosticRunResult(errors, warnings, infos);
    }

    private static bool IsPhysicalProduct(string type)
    {
        return type is "IFCBUILTELEMENT" or "IFCBUILDINGELEMENTPROXY" or "IFCPROXY" or "IFCANNOTATION"
            or "IFCROOF" or "IFCBEAM" or "IFCCOLUMN" or "IFCMEMBER" or "IFCPLATE" or "IFCDOOR"
            or "IFCWINDOW" or "IFCCURTAINWALL" or "IFCSTAIR" or "IFCRAMP" or "IFCRAILING"
            or "IFCFURNISHINGELEMENT" or "IFCFLOWTERMINAL" or "IFCDISTRIBUTIONELEMENT"
            or "IFCOPENINGELEMENT" or "IFCVOIDINGFEATURE" or "IFCPROJECTIONELEMENT" or "IFCELEMENTASSEMBLY"
            or "IFCTRANSPORTELEMENT"
            || type.StartsWith("IFCWALL", StringComparison.OrdinalIgnoreCase)
            || type.StartsWith("IFCSLAB", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsRootedEntity(string type)
    {
        return type is "IFCPROJECT" or "IFCSITE" or "IFCBUILDING" or "IFCBUILDINGSTOREY" or "IFCSPACE"
            or "IFCPROPERTYSET" or "IFCELEMENTQUANTITY" or "IFCTYPEOBJECT" or "IFCBUILDINGELEMENTPROXYTYPE"
            || IsPhysicalProduct(type)
            || type.StartsWith("IFCREL", StringComparison.OrdinalIgnoreCase)
            || type.EndsWith("TYPE", StringComparison.OrdinalIgnoreCase);
    }
}
