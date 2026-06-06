using System.Globalization;
using IFCnative.NativeWindows.Models;

namespace IFCnative.NativeWindows.Services;

public static class IfcDocumentEditor
{
    private sealed record RelationshipEndpointMap(int SourceArgumentIndex, int TargetArgumentIndex, bool SourceIsList, bool TargetIsList);

    public static IfcDocument AddCommonPropertySet(IfcDocument document, int productId, string referenceText = "Native reference", string statusText = "New")
    {
        if (!CanAttachPropertySet(document, productId))
        {
            return document;
        }

        var nextId = IfcStepWriter.NextEntityId(document);
        var propertySetId = nextId++;
        var referencePropertyId = nextId++;
        var statusPropertyId = nextId++;
        var externalPropertyId = nextId++;
        var relationshipId = nextId++;
        var product = document.EntityById[productId];
        var reference = string.IsNullOrWhiteSpace(referenceText) ? product.DisplayName : referenceText.Trim();
        var status = string.IsNullOrWhiteSpace(statusText) ? "New" : statusText.Trim();
        var updatedModel = IfcMemoryModelEditor.AddPropertySetAssignment(
            document.MemoryModel,
            productId,
            propertySetId,
            "Pset",
            "Pset_NativeCommon",
            [
                new IfcMemoryModelEditor.PropertyValueDraft(referencePropertyId, "IFCPROPERTYSINGLEVALUE", "Reference", new IfcModelValue(IfcPropertyValueKind.String, "IFCLABEL", reference, null, null, reference)),
                new IfcMemoryModelEditor.PropertyValueDraft(statusPropertyId, "IFCPROPERTYSINGLEVALUE", "Status", new IfcModelValue(IfcPropertyValueKind.String, "IFCLABEL", status, null, null, status)),
                new IfcMemoryModelEditor.PropertyValueDraft(externalPropertyId, "IFCPROPERTYSINGLEVALUE", "IsExternal", new IfcModelValue(IfcPropertyValueKind.Boolean, "IFCBOOLEAN", null, null, false, "false")),
            ],
            relationshipId,
            $"{product.DisplayName} common properties");

        return ReferenceEquals(updatedModel, document.MemoryModel)
            ? document
            : IfcMemoryModelExporter.ApplyToDocument(document, updatedModel);
    }

    public static IfcDocument AddBaseQuantitySet(IfcDocument document, int productId, string lengthText, string areaText, string volumeText)
    {
        if (!CanAttachPropertySet(document, productId))
        {
            return document;
        }

        var length = Math.Max(0, ParseCoordinate(lengthText, 1));
        var area = Math.Max(0, ParseCoordinate(areaText, 1));
        var volume = Math.Max(0, ParseCoordinate(volumeText, 1));
        var nextId = IfcStepWriter.NextEntityId(document);
        var quantitySetId = nextId++;
        var lengthQuantityId = nextId++;
        var areaQuantityId = nextId++;
        var volumeQuantityId = nextId++;
        var relationshipId = nextId++;
        var product = document.EntityById[productId];
        var updatedModel = IfcMemoryModelEditor.AddPropertySetAssignment(
            document.MemoryModel,
            productId,
            quantitySetId,
            "Qto",
            "Qto_NativeBaseQuantities",
            [
                new IfcMemoryModelEditor.PropertyValueDraft(lengthQuantityId, "IFCQUANTITYLENGTH", "Length", new IfcModelValue(IfcPropertyValueKind.Number, null, null, length, null, FormatMeasure(length))),
                new IfcMemoryModelEditor.PropertyValueDraft(areaQuantityId, "IFCQUANTITYAREA", "GrossArea", new IfcModelValue(IfcPropertyValueKind.Number, null, null, area, null, FormatMeasure(area))),
                new IfcMemoryModelEditor.PropertyValueDraft(volumeQuantityId, "IFCQUANTITYVOLUME", "GrossVolume", new IfcModelValue(IfcPropertyValueKind.Number, null, null, volume, null, FormatMeasure(volume))),
            ],
            relationshipId,
            $"{product.DisplayName} base quantities");

        return ReferenceEquals(updatedModel, document.MemoryModel)
            ? document
            : IfcMemoryModelExporter.ApplyToDocument(document, updatedModel);
    }

    public static IfcDocument AddSimpleMaterialAssignment(IfcDocument document, int productId, string materialNameText)
    {
        var materialName = string.IsNullOrWhiteSpace(materialNameText) ? "Native material" : materialNameText.Trim();
        return AddSimpleResourceAssignment(
            document,
            productId,
            "IFCMATERIAL",
            "IFCRELASSOCIATESMATERIAL",
            "material",
            materialName,
            string.Empty);
    }

    public static IfcDocument AddSimpleClassificationAssignment(IfcDocument document, int productId, string classificationNameText, string identificationText)
    {
        var classificationName = string.IsNullOrWhiteSpace(classificationNameText) ? "Native classification" : classificationNameText.Trim();
        var identification = string.IsNullOrWhiteSpace(identificationText) ? "NATIVE-CLASS" : identificationText.Trim();
        return AddSimpleResourceAssignment(
            document,
            productId,
            "IFCCLASSIFICATIONREFERENCE",
            "IFCRELASSOCIATESCLASSIFICATION",
            "classification",
            classificationName,
            identification);
    }

    public static IfcDocument AddSimpleDocumentAssignment(IfcDocument document, int productId, string documentNameText, string identificationText)
    {
        var documentName = string.IsNullOrWhiteSpace(documentNameText) ? "Native document" : documentNameText.Trim();
        var identification = string.IsNullOrWhiteSpace(identificationText) ? "NATIVE-DOC" : identificationText.Trim();
        return AddSimpleResourceAssignment(
            document,
            productId,
            "IFCDOCUMENTREFERENCE",
            "IFCRELASSOCIATESDOCUMENT",
            "document",
            documentName,
            identification);
    }

    public static IfcDocument AddSimpleLibraryAssignment(IfcDocument document, int productId, string libraryNameText, string identificationText)
    {
        var libraryName = string.IsNullOrWhiteSpace(libraryNameText) ? "Native library item" : libraryNameText.Trim();
        var identification = string.IsNullOrWhiteSpace(identificationText) ? "NATIVE-LIB" : identificationText.Trim();
        return AddSimpleResourceAssignment(
            document,
            productId,
            "IFCLIBRARYREFERENCE",
            "IFCRELASSOCIATESLIBRARY",
            "library reference",
            libraryName,
            identification);
    }

    public static IfcDocument RegenerateDuplicateGlobalIds(IfcDocument document, string diagnosticMessage)
    {
        var duplicateIds = ReadIds(diagnosticMessage)
            .Where(document.EntityById.ContainsKey)
            .Distinct()
            .ToList();
        if (duplicateIds.Count < 2)
        {
            return document;
        }

        var existingGlobalIds = document.MemoryModel.Objects
            .Select(entity => entity.GlobalId)
            .Where(globalId => !string.IsNullOrWhiteSpace(globalId))
            .ToHashSet(StringComparer.Ordinal);

        var replacements = new Dictionary<int, string>();
        foreach (var entityId in duplicateIds.Skip(1))
        {
            if (!document.MemoryModel.ObjectsBySourceId.TryGetValue(entityId, out var modelObject))
            {
                continue;
            }

            existingGlobalIds.Remove(modelObject.GlobalId);
            var replacement = MakeUniqueGeneratedGlobalId(entityId, existingGlobalIds);
            replacements[entityId] = replacement;
            existingGlobalIds.Add(replacement);
        }

        var updatedModel = IfcMemoryModelEditor.UpdateGlobalIds(document.MemoryModel, replacements);
        return ReferenceEquals(updatedModel, document.MemoryModel)
            ? document
            : IfcMemoryModelExporter.ApplyToDocument(document, updatedModel);
    }

    public static IfcDocument GenerateMissingGlobalIdFromDiagnostic(IfcDocument document, string diagnosticMessage)
    {
        var entityId = ReadIds(diagnosticMessage).FirstOrDefault(document.EntityById.ContainsKey);
        if (entityId == 0 || !document.EntityById.TryGetValue(entityId, out var entity) || !string.IsNullOrWhiteSpace(entity.GlobalId))
        {
            return document;
        }

        var existingGlobalIds = document.MemoryModel.Objects
            .Where(candidate => candidate.SourceId != entityId)
            .Select(candidate => candidate.GlobalId)
            .Where(globalId => !string.IsNullOrWhiteSpace(globalId))
            .ToHashSet(StringComparer.Ordinal);
        var updatedModel = IfcMemoryModelEditor.UpdateGlobalIds(
            document.MemoryModel,
            new Dictionary<int, string> { [entityId] = MakeUniqueGeneratedGlobalId(entityId, existingGlobalIds) });

        return ReferenceEquals(updatedModel, document.MemoryModel)
            ? document
            : IfcMemoryModelExporter.ApplyToDocument(document, updatedModel);
    }

    public static IfcDocument KeepFirstPrimarySpatialContainment(IfcDocument document, string diagnosticMessage)
    {
        var ids = ReadIds(diagnosticMessage).ToList();
        if (ids.Count < 3)
        {
            return document;
        }

        var productId = ids[0];
        var relationshipIds = ids
            .Skip(1)
            .Where(id => document.RelationshipById.TryGetValue(id, out var relationship)
                && relationship.Type == "IFCRELCONTAINEDINSPATIALSTRUCTURE"
                && relationship.TargetIds.Contains(productId))
            .Distinct()
            .OrderBy(id => id)
            .ToList();
        if (relationshipIds.Count < 2)
        {
            return document;
        }

        var updatedModel = document.MemoryModel;
        foreach (var relationshipId in relationshipIds.Skip(1))
        {
            if (!document.RelationshipById.TryGetValue(relationshipId, out var originalRelationship))
            {
                continue;
            }

            var remainingTargets = originalRelationship.TargetIds.Where(id => id != productId).Distinct().ToList();
            if (remainingTargets.Count == 0)
            {
                updatedModel = IfcMemoryModelEditor.RemoveRelation(updatedModel, relationshipId);
            }
            else
            {
                updatedModel = IfcMemoryModelEditor.UpdateRelationEndpoints(updatedModel, relationshipId, originalRelationship.SourceIds, remainingTargets);
            }
        }

        return ReferenceEquals(updatedModel, document.MemoryModel)
            ? document
            : IfcMemoryModelExporter.ApplyToDocument(document, updatedModel);
    }

    public static IfcDocument RemoveMissingRelationshipReferences(IfcDocument document, string diagnosticMessage)
    {
        var ids = ReadIds(diagnosticMessage).ToList();
        if (ids.Count < 2)
        {
            return document;
        }

        var relationshipId = ids[0];
        var missingIds = ids
            .Skip(1)
            .Where(id => !document.EntityById.ContainsKey(id))
            .Distinct()
            .ToHashSet();
        if (missingIds.Count == 0
            || !document.RelationshipById.TryGetValue(relationshipId, out var relationship)
            || GetRelationshipEndpointMap(relationship.Type) is not { } map)
        {
            return document;
        }

        var sourceIds = relationship.SourceIds.Where(id => !missingIds.Contains(id)).Distinct().ToList();
        var targetIds = relationship.TargetIds.Where(id => !missingIds.Contains(id)).Distinct().ToList();
        if (sourceIds.Count == relationship.SourceIds.Distinct().Count()
            && targetIds.Count == relationship.TargetIds.Distinct().Count())
        {
            return document;
        }

        var updatedModel = document.MemoryModel;
        if (sourceIds.Count == 0 || targetIds.Count == 0)
        {
            updatedModel = IfcMemoryModelEditor.RemoveRelation(updatedModel, relationshipId);
        }
        else
        {
            updatedModel = IfcMemoryModelEditor.UpdateRelationEndpoints(updatedModel, relationshipId, sourceIds, targetIds);
        }

        return ReferenceEquals(updatedModel, document.MemoryModel)
            ? document
            : IfcMemoryModelExporter.ApplyToDocument(document, updatedModel);
    }

    public static IfcDocument AssignDefaultPlacementFromDiagnostic(IfcDocument document, string diagnosticMessage)
    {
        var productId = ReadIds(diagnosticMessage).FirstOrDefault(document.EntityById.ContainsKey);
        if (productId == 0 || !document.EntityById.TryGetValue(productId, out var product) || product.Arguments.Count <= 5)
        {
            return document;
        }

        var currentPlacementId = StepArgumentReader.ReadReferences(product.Arguments[5]).FirstOrDefault();
        if (currentPlacementId != 0
            && document.EntityById.TryGetValue(currentPlacementId, out var currentPlacement)
            && currentPlacement.Type == "IFCLOCALPLACEMENT")
        {
            return document;
        }

        var nextId = IfcStepWriter.NextEntityId(document);
        var placementId = nextId++;
        var axisPlacementId = nextId++;
        var pointId = nextId++;
        var updatedModel = IfcMemoryModelEditor.AssignDefaultPlacement(document.MemoryModel, productId, placementId, axisPlacementId, pointId);
        return ReferenceEquals(updatedModel, document.MemoryModel)
            ? document
            : IfcMemoryModelExporter.ApplyToDocument(document, updatedModel);
    }

    public static IfcDocument AssignDefaultRepresentationFromDiagnostic(IfcDocument document, string diagnosticMessage)
    {
        var productId = ReadIds(diagnosticMessage).FirstOrDefault(document.EntityById.ContainsKey);
        if (productId == 0 || !document.EntityById.TryGetValue(productId, out var product) || product.Arguments.Count <= 6)
        {
            return document;
        }

        var currentRepresentationId = StepArgumentReader.ReadReferences(product.Arguments[6]).FirstOrDefault();
        if (currentRepresentationId != 0
            && document.EntityById.TryGetValue(currentRepresentationId, out var currentRepresentation)
            && currentRepresentation.Type == "IFCPRODUCTDEFINITIONSHAPE")
        {
            return document;
        }

        return AssignBodyRepresentation(document, productId, "1", "1", "1", "rectangle");
    }

    private static IfcDocument AddSimpleResourceAssignment(
        IfcDocument document,
        int productId,
        string resourceType,
        string relationshipType,
        string relationshipLabel,
        string resourceName,
        string resourceIdentification)
    {
        if (!CanAssignResource(document, productId))
        {
            return document;
        }

        var nextId = IfcStepWriter.NextEntityId(document);
        var resourceId = nextId++;
        var relationshipId = nextId++;
        var product = document.EntityById[productId];
        var updatedModel = IfcMemoryModelEditor.AddResourceAssignment(
            document.MemoryModel,
            productId,
            new IfcMemoryModelEditor.ResourceDraft(resourceId, resourceType, resourceName, resourceIdentification, string.Empty),
            relationshipId,
            relationshipType,
            $"{product.DisplayName} {relationshipLabel}");

        return ReferenceEquals(updatedModel, document.MemoryModel)
            ? document
            : IfcMemoryModelExporter.ApplyToDocument(document, updatedModel);
    }

    public static IfcDocument AddOpeningVoidWithBodyRepresentation(
        IfcDocument document,
        int hostElementId,
        string nameText,
        string widthText,
        string depthText,
        string heightText,
        string profileText = "rectangle")
    {
        if (!document.EntityById.TryGetValue(hostElementId, out var host) || !CanHostOpening(host))
        {
            return document;
        }

        var name = string.IsNullOrWhiteSpace(nameText) ? "Native opening" : nameText.Trim();
        var nextId = IfcStepWriter.NextEntityId(document);
        var openingId = nextId++;
        var placementId = nextId++;
        var axisPlacementId = nextId++;
        var pointId = nextId++;
        var voidRelationshipId = nextId++;
        var hostPlacementId = document.PlacementsByEntity.TryGetValue(hostElementId, out var hostPlacement)
            ? hostPlacement.PlacementId
            : 0;
        var updatedModel = IfcMemoryModelEditor.AddProductObject(
            document.MemoryModel,
            new IfcMemoryModelEditor.ProductDraft(
                openingId,
                "IFCOPENINGELEMENT",
                MakeGeneratedGlobalIdValue("Opening", openingId),
                name,
                string.Empty,
                ".OPENING.",
                placementId,
                axisPlacementId,
                pointId,
                hostPlacementId == 0 ? null : hostPlacementId));
        updatedModel = IfcMemoryModelEditor.AddRelation(updatedModel, voidRelationshipId, "IFCRELVOIDSELEMENT", $"{host.DisplayName} voids {name}", [hostElementId], [openingId]);
        updatedModel = IfcMemoryModelEditor.AssignBodyRepresentation(updatedModel, openingId, CreateBodyRepresentationDraft(document, ref nextId, widthText, depthText, heightText, profileText));
        return ReferenceEquals(updatedModel, document.MemoryModel)
            ? document
            : IfcMemoryModelExporter.ApplyToDocument(document, updatedModel);
    }

    public static IfcDocument AddFillingElementWithBodyRepresentation(
        IfcDocument document,
        int openingElementId,
        string productTypeText,
        string nameText,
        string widthText,
        string depthText,
        string heightText,
        string profileText = "rectangle")
    {
        if (!document.EntityById.TryGetValue(openingElementId, out var opening) || opening.Type != "IFCOPENINGELEMENT")
        {
            return document;
        }

        var productType = NormalizeProductType(productTypeText);
        var name = string.IsNullOrWhiteSpace(nameText) ? "Native filling element" : nameText.Trim();
        var nextId = IfcStepWriter.NextEntityId(document);
        var fillingId = nextId++;
        var placementId = nextId++;
        var axisPlacementId = nextId++;
        var pointId = nextId++;
        var fillRelationshipId = nextId++;
        var openingPlacementId = document.PlacementsByEntity.TryGetValue(openingElementId, out var openingPlacement)
            ? openingPlacement.PlacementId
            : 0;
        var updatedModel = IfcMemoryModelEditor.AddProductObject(
            document.MemoryModel,
            new IfcMemoryModelEditor.ProductDraft(
                fillingId,
                productType,
                MakeGeneratedGlobalIdValue("Filling", fillingId),
                name,
                string.Empty,
                string.Empty,
                placementId,
                axisPlacementId,
                pointId,
                openingPlacementId == 0 ? null : openingPlacementId));
        updatedModel = IfcMemoryModelEditor.AddRelation(updatedModel, fillRelationshipId, "IFCRELFILLSELEMENT", $"{opening.DisplayName} filled by {name}", [openingElementId], [fillingId]);
        updatedModel = IfcMemoryModelEditor.AssignBodyRepresentation(updatedModel, fillingId, CreateBodyRepresentationDraft(document, ref nextId, widthText, depthText, heightText, profileText));
        return ReferenceEquals(updatedModel, document.MemoryModel)
            ? document
            : IfcMemoryModelExporter.ApplyToDocument(document, updatedModel);
    }

    private static bool CanHostOpening(IFCnative.NativeWindows.Models.IfcEntity entity)
    {
        return entity.Arguments.Count > 6
            && !entity.Type.StartsWith("IFCREL", StringComparison.OrdinalIgnoreCase)
            && !IsSpatialParent(entity.Type)
            && entity.Type != "IFCOPENINGELEMENT";
    }

    private static bool CanAttachPropertySet(IfcDocument document, int productId)
    {
        return document.EntityById.TryGetValue(productId, out var entity)
            && entity.Arguments.Count > 4
            && !entity.Type.StartsWith("IFCREL", StringComparison.OrdinalIgnoreCase)
            && entity.Type is not "IFCPROPERTYSET" and not "IFCELEMENTQUANTITY";
    }

    private static bool CanAssignResource(IfcDocument document, int productId)
    {
        return document.EntityById.TryGetValue(productId, out var entity)
            && entity.Arguments.Count > 4
            && !entity.Type.StartsWith("IFCREL", StringComparison.OrdinalIgnoreCase)
            && entity.Type is not "IFCMATERIAL" and not "IFCCLASSIFICATIONREFERENCE" and not "IFCDOCUMENTREFERENCE" and not "IFCLIBRARYREFERENCE";
    }

    public static IfcDocument AddProductWithBodyRepresentation(
        IfcDocument document,
        int parentSpatialId,
        string productTypeText,
        string nameText,
        string widthText,
        string depthText,
        string heightText,
        string profileText = "rectangle")
    {
        if (!document.EntityById.TryGetValue(parentSpatialId, out var parent) || !IsSpatialParent(parent.Type))
        {
            return document;
        }

        var productType = NormalizeProductType(productTypeText);
        var name = string.IsNullOrWhiteSpace(nameText) ? "New native product" : nameText.Trim();
        var nextId = IfcStepWriter.NextEntityId(document);
        var productId = nextId++;
        var placementId = nextId++;
        var axisPlacementId = nextId++;
        var pointId = nextId++;
        var containmentId = nextId++;
        var parentPlacementId = document.PlacementsByEntity.TryGetValue(parentSpatialId, out var parentPlacement)
            ? parentPlacement.PlacementId
            : 0;
        var updatedModel = IfcMemoryModelEditor.AddProductObject(
            document.MemoryModel,
            new IfcMemoryModelEditor.ProductDraft(
                productId,
                productType,
                MakeGeneratedGlobalIdValue("Product", productId),
                name,
                string.Empty,
                string.Empty,
                placementId,
                axisPlacementId,
                pointId,
                parentPlacementId == 0 ? null : parentPlacementId));
        updatedModel = IfcMemoryModelEditor.AddRelation(updatedModel, containmentId, "IFCRELCONTAINEDINSPATIALSTRUCTURE", $"{parent.DisplayName} contains {name}", [parentSpatialId], [productId]);
        updatedModel = IfcMemoryModelEditor.AssignBodyRepresentation(updatedModel, productId, CreateBodyRepresentationDraft(document, ref nextId, widthText, depthText, heightText, profileText));
        return ReferenceEquals(updatedModel, document.MemoryModel)
            ? document
            : IfcMemoryModelExporter.ApplyToDocument(document, updatedModel);
    }

    public static IfcDocument AssignBodyRepresentation(
        IfcDocument document,
        int productId,
        string widthText,
        string depthText,
        string heightText,
        string profileText = "rectangle")
    {
        if (!document.EntityById.ContainsKey(productId))
        {
            return document;
        }

        var nextId = IfcStepWriter.NextEntityId(document);
        var updatedModel = IfcMemoryModelEditor.AssignBodyRepresentation(
            document.MemoryModel,
            productId,
            CreateBodyRepresentationDraft(document, ref nextId, widthText, depthText, heightText, profileText));

        return ReferenceEquals(updatedModel, document.MemoryModel)
            ? document
            : IfcMemoryModelExporter.ApplyToDocument(document, updatedModel);
    }

    public static IfcDocument UpdateEntity(IfcDocument document, int entityId, string name, string description, string rawArguments)
    {
        if (!document.MemoryModel.ObjectsBySourceId.ContainsKey(entityId))
        {
            return document;
        }

        var normalizedArguments = rawArguments.Trim();
        var rawArgumentValues = string.IsNullOrWhiteSpace(normalizedArguments)
            ? document.EntityById.GetValueOrDefault(entityId)?.Arguments ?? []
            : StepArgumentReader.SplitTopLevel(normalizedArguments);
        var updatedModel = IfcMemoryModelEditor.UpdateRawEntity(document.MemoryModel, entityId, name, description, rawArgumentValues);
        return ReferenceEquals(updatedModel, document.MemoryModel)
            ? document
            : IfcMemoryModelExporter.ApplyToDocument(document, updatedModel);
    }

    public static IfcDocument UpdatePlacement(IfcDocument document, int productId, string xText, string yText, string zText)
    {
        var updatedModel = IfcMemoryModelEditor.UpdatePlacement(document.MemoryModel, productId, xText, yText, zText);
        return ReferenceEquals(updatedModel, document.MemoryModel)
            ? document
            : IfcMemoryModelExporter.ApplyToDocument(document, updatedModel);
    }

    public static IfcDocument UpdateBodyDimensions(IfcDocument document, int productId, string widthText, string depthText, string heightText)
    {
        var updatedModel = IfcMemoryModelEditor.UpdateExtrudedBodyDimensions(document.MemoryModel, productId, widthText, depthText, heightText);
        return ReferenceEquals(updatedModel, document.MemoryModel)
            ? document
            : IfcMemoryModelExporter.ApplyToDocument(document, updatedModel);
    }

    public static IfcDocument UpdateSpatialParent(IfcDocument document, int childId, string parentIdText)
    {
        var relationship = document.MemoryModel.RelationsByObjectId.TryGetValue(childId, out var relationships)
            ? relationships
                .Where(candidate => candidate.TargetObjectIds.Contains(childId))
                .Where(candidate => candidate.IfcClass is "IFCRELCONTAINEDINSPATIALSTRUCTURE" or "IFCRELAGGREGATES")
                .OrderBy(candidate => candidate.IfcClass == "IFCRELCONTAINEDINSPATIALSTRUCTURE" ? 0 : 1)
                .ThenBy(candidate => candidate.SourceId)
                .FirstOrDefault()
            : null;

        if (relationship is null)
        {
            return document;
        }

        var parentId = ReadIds(parentIdText).FirstOrDefault();
        if (parentId == 0 || !document.MemoryModel.ObjectsBySourceId.TryGetValue(parentId, out var parent) || parentId == childId)
        {
            return document;
        }

        if (!IsSpatialParent(parent.IfcClass) || HasSpatialDescendant(document.MemoryModel, childId, parentId))
        {
            return document;
        }

        var updatedModel = IfcMemoryModelEditor.UpdateRelationEndpoints(document.MemoryModel, relationship.SourceId, [parentId], relationship.TargetObjectIds);
        return ReferenceEquals(updatedModel, document.MemoryModel)
            ? document
            : IfcMemoryModelExporter.ApplyToDocument(document, updatedModel);
    }

    public static IfcDocument RemoveFromSpatialParent(IfcDocument document, int childId)
    {
        var relationship = document.MemoryModel.RelationsByObjectId.TryGetValue(childId, out var relationships)
            ? relationships
                .Where(candidate => candidate.TargetObjectIds.Contains(childId))
                .Where(candidate => candidate.IfcClass is "IFCRELCONTAINEDINSPATIALSTRUCTURE" or "IFCRELAGGREGATES")
                .OrderBy(candidate => candidate.IfcClass == "IFCRELCONTAINEDINSPATIALSTRUCTURE" ? 0 : 1)
                .ThenBy(candidate => candidate.SourceId)
                .FirstOrDefault()
            : null;

        if (relationship is null)
        {
            return document;
        }

        var remainingTargets = relationship.TargetObjectIds.Where(id => id != childId).Distinct().ToList();
        var updatedModel = remainingTargets.Count == 0
            ? IfcMemoryModelEditor.RemoveRelation(document.MemoryModel, relationship.SourceId)
            : IfcMemoryModelEditor.UpdateRelationEndpoints(document.MemoryModel, relationship.SourceId, relationship.SourceObjectIds, remainingTargets);
        return ReferenceEquals(updatedModel, document.MemoryModel)
            ? document
            : IfcMemoryModelExporter.ApplyToDocument(document, updatedModel);
    }

    private static bool HasSpatialDescendant(IfcMemoryModel model, int rootId, int candidateDescendantId)
    {
        var visited = new HashSet<int>();
        var pending = new Stack<int>();
        pending.Push(rootId);

        while (pending.Count > 0)
        {
            var current = pending.Pop();
            if (!visited.Add(current))
            {
                continue;
            }

            foreach (var childId in model.Relations
                .Where(relationship => relationship.IfcClass is "IFCRELAGGREGATES" or "IFCRELCONTAINEDINSPATIALSTRUCTURE")
                .Where(relationship => relationship.SourceObjectIds.Contains(current))
                .SelectMany(relationship => relationship.TargetObjectIds))
            {
                if (childId == candidateDescendantId)
                {
                    return true;
                }

                pending.Push(childId);
            }
        }

        return false;
    }

    private static bool IsSpatialParent(string type)
    {
        return type is "IFCPROJECT" or "IFCPROJECTLIBRARY" or "IFCSITE" or "IFCBUILDING" or "IFCBUILDINGSTOREY" or "IFCSPACE"
            or "IFCFACILITY" or "IFCFACILITYPART" or "IFCROAD" or "IFCRAILWAY" or "IFCBRIDGE";
    }

    private static string NormalizeProductType(string productTypeText)
    {
        var normalized = productTypeText.Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(normalized))
        {
            return "IFCBUILDINGELEMENTPROXY";
        }

        if (!normalized.StartsWith("IFC", StringComparison.OrdinalIgnoreCase))
        {
            normalized = $"IFC{normalized}";
        }

        return normalized.All(character => char.IsLetterOrDigit(character) || character == '_')
            ? normalized
            : "IFCBUILDINGELEMENTPROXY";
    }

    private static string MakeGeneratedGlobalId(string prefix, int id)
    {
        var raw = $"IFCnative{prefix}{id:000000000000}";
        return StepArgumentReader.Quote(raw.Length <= 22 ? raw : raw[..22]);
    }

    private static string MakeUniqueGeneratedGlobalId(int entityId, ISet<string> existingGlobalIds)
    {
        for (var attempt = 1; attempt < 10_000; attempt++)
        {
            var candidate = $"IFCnatFix{entityId:000000}{attempt:0000}";
            if (!existingGlobalIds.Contains(candidate))
            {
                return candidate;
            }
        }

        return $"IFCnatFix{Guid.NewGuid():N}"[..22];
    }

    public static IfcDocument UpdatePropertyValue(IfcDocument document, int propertyValueId, string rawValue)
    {
        var updatedModel = IfcMemoryModelEditor.UpdatePropertyValue(document.MemoryModel, propertyValueId, rawValue);
        return ReferenceEquals(updatedModel, document.MemoryModel)
            ? document
            : IfcMemoryModelExporter.ApplyToDocument(document, updatedModel);
    }

    public static bool CanUpdateRelationshipEndpoints(string relationshipType)
    {
        return GetRelationshipEndpointMap(relationshipType) is not null;
    }

    public static IfcDocument AddRelationship(IfcDocument document, string relationshipTypeText, string sourceIdsText, string targetIdsText, string nameText)
    {
        var relationshipType = NormalizeRelationshipType(relationshipTypeText);
        var map = GetRelationshipEndpointMap(relationshipType);
        if (map is null)
        {
            return document;
        }

        var sourceIds = ReadIds(sourceIdsText).Where(document.EntityById.ContainsKey).Distinct().ToList();
        var targetIds = ReadIds(targetIdsText).Where(document.EntityById.ContainsKey).Distinct().ToList();
        if (sourceIds.Count == 0 || targetIds.Count == 0)
        {
            return document;
        }

        var relationshipId = IfcStepWriter.NextEntityId(document);
        var name = string.IsNullOrWhiteSpace(nameText) ? $"Native {relationshipType}" : nameText.Trim();
        var updatedModel = IfcMemoryModelEditor.AddRelation(document.MemoryModel, relationshipId, relationshipType, name, sourceIds, targetIds);
        return ReferenceEquals(updatedModel, document.MemoryModel)
            ? document
            : IfcMemoryModelExporter.ApplyToDocument(document, updatedModel);
    }

    public static IfcDocument AddElementConnection(IfcDocument document, int sourceElementId, string targetElementIdsText, string nameText)
    {
        if (!CanConnectElement(document, sourceElementId))
        {
            return document;
        }

        var targetId = ReadIds(targetElementIdsText).FirstOrDefault(id => id != sourceElementId && CanConnectElement(document, id));
        if (targetId == 0)
        {
            return document;
        }

        var source = document.EntityById[sourceElementId];
        var target = document.EntityById[targetId];
        var name = string.IsNullOrWhiteSpace(nameText)
            ? $"{source.DisplayName} connects {target.DisplayName}"
            : nameText.Trim();

        return AddRelationship(document, "IFCRELCONNECTSELEMENTS", $"#{sourceElementId}", $"#{targetId}", name);
    }

    public static IfcDocument RemoveElementConnections(IfcDocument document, int elementId, string connectedElementIdsText)
    {
        if (!document.RelationshipsByEntity.TryGetValue(elementId, out var relationships))
        {
            return document;
        }

        var connectedIds = ReadIds(connectedElementIdsText).Where(id => id != elementId).ToHashSet();
        var relationshipIds = relationships
            .Where(relationship => relationship.Type == "IFCRELCONNECTSELEMENTS")
            .Where(relationship => connectedIds.Count == 0
                || relationship.SourceIds.Concat(relationship.TargetIds).Any(id => connectedIds.Contains(id)))
            .Select(relationship => relationship.Id)
            .Distinct()
            .ToHashSet();

        if (relationshipIds.Count == 0)
        {
            return document;
        }

        var updatedModel = document.MemoryModel;
        foreach (var relationshipId in relationshipIds)
        {
            updatedModel = IfcMemoryModelEditor.RemoveRelation(updatedModel, relationshipId);
        }

        return ReferenceEquals(updatedModel, document.MemoryModel)
            ? document
            : IfcMemoryModelExporter.ApplyToDocument(document, updatedModel);
    }

    public static IfcDocument UpdateRelationshipEndpoints(IfcDocument document, int relationshipId, string sourceIdsText, string targetIdsText)
    {
        if (!document.RelationshipById.TryGetValue(relationshipId, out var relationship))
        {
            return document;
        }

        var map = GetRelationshipEndpointMap(relationship.Type);
        if (map is null)
        {
            return document;
        }

        var updatedModel = IfcMemoryModelEditor.UpdateRelationEndpoints(document.MemoryModel, relationshipId, ReadIds(sourceIdsText), ReadIds(targetIdsText));
        return ReferenceEquals(updatedModel, document.MemoryModel)
            ? document
            : IfcMemoryModelExporter.ApplyToDocument(document, updatedModel);
    }

    public static IfcDocument RemoveRelationship(IfcDocument document, int relationshipId)
    {
        if (!document.RelationshipById.ContainsKey(relationshipId))
        {
            return document;
        }

        var updatedModel = IfcMemoryModelEditor.RemoveRelation(document.MemoryModel, relationshipId);
        return ReferenceEquals(updatedModel, document.MemoryModel)
            ? document
            : IfcMemoryModelExporter.ApplyToDocument(document, updatedModel);
    }

    private static RelationshipEndpointMap? GetRelationshipEndpointMap(string relationshipType)
    {
        return relationshipType switch
        {
            "IFCRELAGGREGATES" or "IFCRELNESTS" => new RelationshipEndpointMap(4, 5, false, true),
            "IFCRELCONTAINEDINSPATIALSTRUCTURE" or "IFCRELREFERENCEDINSPATIALSTRUCTURE" => new RelationshipEndpointMap(5, 4, false, true),
            "IFCRELDEFINESBYPROPERTIES" or "IFCRELDEFINESBYTYPE" or "IFCRELASSIGNSTOGROUP" or "IFCRELASSIGNSTOPROCESS"
                or "IFCRELASSIGNSTOCONTROL" or "IFCRELASSIGNSTOPRODUCT" or "IFCRELASSOCIATESMATERIAL" or "IFCRELASSOCIATESCLASSIFICATION"
                or "IFCRELASSOCIATESDOCUMENT" or "IFCRELASSOCIATESLIBRARY" => new RelationshipEndpointMap(5, 4, false, true),
            "IFCRELVOIDSELEMENT" or "IFCRELFILLSELEMENT" or "IFCRELCONNECTSPORTS"
                or "IFCRELCONNECTSPORTTOELEMENT" or "IFCRELINTERFERESELEMENTS" or "IFCRELPROJECTSELEMENT" => new RelationshipEndpointMap(4, 5, false, false),
            "IFCRELCONNECTSELEMENTS" => new RelationshipEndpointMap(5, 6, false, false),
            _ => null,
        };
    }

    private static bool CanConnectElement(IfcDocument document, int entityId)
    {
        return document.EntityById.TryGetValue(entityId, out var entity)
            && entity.Arguments.Count > 6
            && !entity.Type.StartsWith("IFCREL", StringComparison.OrdinalIgnoreCase)
            && entity.Type != "IFCOPENINGELEMENT";
    }

    private static string NormalizeRelationshipType(string relationshipTypeText)
    {
        var normalized = relationshipTypeText.Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(normalized))
        {
            return "IFCRELDEFINESBYPROPERTIES";
        }

        if (!normalized.StartsWith("IFC", StringComparison.OrdinalIgnoreCase))
        {
            normalized = $"IFC{normalized}";
        }

        return normalized.All(character => char.IsLetterOrDigit(character) || character == '_')
            ? normalized
            : "IFCRELDEFINESBYPROPERTIES";
    }

    private static IEnumerable<int> ReadIds(string text)
    {
        foreach (System.Text.RegularExpressions.Match match in System.Text.RegularExpressions.Regex.Matches(text, @"#?(\d+)"))
        {
            if (int.TryParse(match.ToString().TrimStart('#'), NumberStyles.Integer, CultureInfo.InvariantCulture, out var id))
            {
                yield return id;
            }
        }
    }

    private static string FormatReferenceArgument(IEnumerable<int> ids, bool asList)
    {
        var references = ids.Distinct().Select(id => $"#{id}").ToList();
        if (references.Count == 0)
        {
            return asList ? "()" : "$";
        }

        return asList ? $"({string.Join(',', references)})" : references[0];
    }

    private static void SetArgument(IFCnative.NativeWindows.Models.IfcEntity entity, int argumentIndex, string value)
    {
        while (entity.Arguments.Count <= argumentIndex)
        {
            entity.Arguments.Add("$");
        }

        entity.Arguments[argumentIndex] = value;
    }

    private static int FindRepresentationContextId(IfcDocument document)
    {
        return document.Entities
            .FirstOrDefault(entity => entity.Type is "IFCGEOMETRICREPRESENTATIONCONTEXT" or "IFCGEOMETRICREPRESENTATIONSUBCONTEXT")
            ?.Id ?? 0;
    }

    private static IfcMemoryModelEditor.BodyRepresentationDraft CreateBodyRepresentationDraft(
        IfcDocument document,
        ref int nextId,
        string widthText,
        string depthText,
        string heightText,
        string profileText)
    {
        var width = Math.Max(0.001, ParseCoordinate(widthText, 1));
        var depth = Math.Max(0.001, ParseCoordinate(depthText, width));
        var height = Math.Max(0.001, ParseCoordinate(heightText, 1));
        var isCylinder = string.Equals(profileText.Trim(), "cylinder", StringComparison.OrdinalIgnoreCase);
        var contextId = FindRepresentationContextId(document);
        if (contextId == 0)
        {
            contextId = nextId++;
        }

        return new IfcMemoryModelEditor.BodyRepresentationDraft(
            contextId,
            nextId++,
            nextId++,
            nextId++,
            nextId++,
            nextId++,
            nextId++,
            nextId++,
            nextId++,
            nextId++,
            nextId++,
            width,
            depth,
            height,
            isCylinder);
    }

    private static void AddEntity(IfcDocument document, int id, string type, IEnumerable<string> arguments)
    {
        var entity = new IFCnative.NativeWindows.Models.IfcEntity { Id = id, Type = type };
        entity.Arguments.AddRange(arguments);
        document.Entities.Add(entity);
        document.EntityById[id] = entity;
    }

    private static double ParseCoordinate(string value, double fallback)
    {
        return double.TryParse(value.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out var number)
            ? number
            : fallback;
    }

    private static string FormatMeasure(double value)
    {
        var formatted = value.ToString("0.########", CultureInfo.InvariantCulture);
        return formatted.Contains('.', StringComparison.Ordinal) ? formatted : $"{formatted}.";
    }

    private static string MakeGeneratedGlobalIdValue(string prefix, int id)
    {
        var raw = $"IFCnative{prefix}{id:000000000000}";
        return raw.Length <= 22 ? raw : raw[..22];
    }
}
