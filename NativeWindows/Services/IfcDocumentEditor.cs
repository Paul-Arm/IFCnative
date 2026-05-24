using System.Globalization;

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

        var draft = IfcStepParser.Parse(document.ToStepText(), document.FileName);
        var nextId = IfcStepWriter.NextEntityId(draft);
        var propertySetId = nextId++;
        var referencePropertyId = nextId++;
        var statusPropertyId = nextId++;
        var externalPropertyId = nextId++;
        var relationshipId = nextId++;
        var product = document.EntityById[productId];
        var reference = string.IsNullOrWhiteSpace(referenceText) ? product.DisplayName : referenceText.Trim();
        var status = string.IsNullOrWhiteSpace(statusText) ? "New" : statusText.Trim();

        AddEntity(
            draft,
            propertySetId,
            "IFCPROPERTYSET",
            [MakeGeneratedGlobalId("Pset", propertySetId), "$", StepArgumentReader.Quote("Pset_NativeCommon"), "$", $"(#{referencePropertyId},#{statusPropertyId},#{externalPropertyId})"]);
        AddEntity(draft, referencePropertyId, "IFCPROPERTYSINGLEVALUE", [StepArgumentReader.Quote("Reference"), "$", $"IFCLABEL({StepArgumentReader.Quote(reference)})", "$"]);
        AddEntity(draft, statusPropertyId, "IFCPROPERTYSINGLEVALUE", [StepArgumentReader.Quote("Status"), "$", $"IFCLABEL({StepArgumentReader.Quote(status)})", "$"]);
        AddEntity(draft, externalPropertyId, "IFCPROPERTYSINGLEVALUE", [StepArgumentReader.Quote("IsExternal"), "$", "IFCBOOLEAN(.F.)", "$"]);
        AddEntity(
            draft,
            relationshipId,
            "IFCRELDEFINESBYPROPERTIES",
            [MakeGeneratedGlobalId("PRel", relationshipId), "$", StepArgumentReader.Quote($"{product.DisplayName} common properties"), "$", $"(#{productId})", $"#{propertySetId}"]);

        return IfcStepParser.Parse(draft.ToStepText(), draft.FileName);
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
        var draft = IfcStepParser.Parse(document.ToStepText(), document.FileName);
        var nextId = IfcStepWriter.NextEntityId(draft);
        var quantitySetId = nextId++;
        var lengthQuantityId = nextId++;
        var areaQuantityId = nextId++;
        var volumeQuantityId = nextId++;
        var relationshipId = nextId++;
        var product = document.EntityById[productId];

        AddEntity(
            draft,
            quantitySetId,
            "IFCELEMENTQUANTITY",
            [MakeGeneratedGlobalId("Qto", quantitySetId), "$", StepArgumentReader.Quote("Qto_NativeBaseQuantities"), "$", StepArgumentReader.Quote("Native measured quantities"), $"(#{lengthQuantityId},#{areaQuantityId},#{volumeQuantityId})"]);
        AddEntity(draft, lengthQuantityId, "IFCQUANTITYLENGTH", [StepArgumentReader.Quote("Length"), "$", "$", FormatMeasure(length), "$"]);
        AddEntity(draft, areaQuantityId, "IFCQUANTITYAREA", [StepArgumentReader.Quote("GrossArea"), "$", "$", FormatMeasure(area), "$"]);
        AddEntity(draft, volumeQuantityId, "IFCQUANTITYVOLUME", [StepArgumentReader.Quote("GrossVolume"), "$", "$", FormatMeasure(volume), "$"]);
        AddEntity(
            draft,
            relationshipId,
            "IFCRELDEFINESBYPROPERTIES",
            [MakeGeneratedGlobalId("QRel", relationshipId), "$", StepArgumentReader.Quote($"{product.DisplayName} base quantities"), "$", $"(#{productId})", $"#{quantitySetId}"]);

        return IfcStepParser.Parse(draft.ToStepText(), draft.FileName);
    }

    public static IfcDocument AddSimpleMaterialAssignment(IfcDocument document, int productId, string materialNameText)
    {
        var materialName = string.IsNullOrWhiteSpace(materialNameText) ? "Native material" : materialNameText.Trim();
        return AddSimpleResourceAssignment(
            document,
            productId,
            "IFCMATERIAL",
            "IFCRELASSOCIATESMATERIAL",
            "MatRel",
            "material",
            [StepArgumentReader.Quote(materialName), "$", "$"]);
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
            "ClassRel",
            "classification",
            ["$", StepArgumentReader.Quote(identification), StepArgumentReader.Quote(classificationName), "$", "$"]);
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
            "DocRel",
            "document",
            [StepArgumentReader.Quote(identification), "$", StepArgumentReader.Quote(documentName), "$"]);
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
            "LibRel",
            "library reference",
            ["$", StepArgumentReader.Quote(identification), StepArgumentReader.Quote(libraryName), "$", "$"]);
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

        var draft = IfcStepParser.Parse(document.ToStepText(), document.FileName);
        var existingGlobalIds = draft.Entities
            .Select(entity => entity.GlobalId)
            .Where(globalId => !string.IsNullOrWhiteSpace(globalId))
            .ToHashSet(StringComparer.Ordinal);

        var changed = false;
        foreach (var entityId in duplicateIds.Skip(1))
        {
            if (!draft.EntityById.TryGetValue(entityId, out var entity) || entity.Arguments.Count == 0)
            {
                continue;
            }

            existingGlobalIds.Remove(entity.GlobalId);
            var replacement = MakeUniqueGeneratedGlobalId(entityId, existingGlobalIds);
            entity.Arguments[0] = StepArgumentReader.Quote(replacement);
            existingGlobalIds.Add(replacement);
            changed = true;
        }

        return changed ? IfcStepParser.Parse(draft.ToStepText(), draft.FileName) : document;
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

        var draft = IfcStepParser.Parse(document.ToStepText(), document.FileName);
        var changed = false;
        foreach (var relationshipId in relationshipIds.Skip(1))
        {
            if (!draft.EntityById.TryGetValue(relationshipId, out var draftRelationship)
                || !document.RelationshipById.TryGetValue(relationshipId, out var originalRelationship))
            {
                continue;
            }

            var remainingTargets = originalRelationship.TargetIds.Where(id => id != productId).Distinct().ToList();
            if (remainingTargets.Count == 0)
            {
                draft.Entities.RemoveAll(entity => entity.Id == relationshipId);
                draft.EntityById.Remove(relationshipId);
            }
            else
            {
                SetArgument(draftRelationship, 4, FormatReferenceArgument(remainingTargets, asList: true));
            }

            changed = true;
        }

        return changed ? IfcStepParser.Parse(draft.ToStepText(), draft.FileName) : document;
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

        var draft = IfcStepParser.Parse(document.ToStepText(), document.FileName);
        if (!draft.EntityById.TryGetValue(relationshipId, out var draftRelationship))
        {
            return document;
        }

        if (sourceIds.Count == 0 || targetIds.Count == 0)
        {
            draft.Entities.RemoveAll(entity => entity.Id == relationshipId);
            draft.EntityById.Remove(relationshipId);
        }
        else
        {
            SetArgument(draftRelationship, map.SourceArgumentIndex, FormatReferenceArgument(sourceIds, map.SourceIsList));
            SetArgument(draftRelationship, map.TargetArgumentIndex, FormatReferenceArgument(targetIds, map.TargetIsList));
        }

        return IfcStepParser.Parse(draft.ToStepText(), draft.FileName);
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

        var draft = IfcStepParser.Parse(document.ToStepText(), document.FileName);
        if (!draft.EntityById.TryGetValue(productId, out var draftProduct))
        {
            return document;
        }

        var nextId = IfcStepWriter.NextEntityId(draft);
        var placementId = nextId++;
        var axisPlacementId = nextId++;
        var pointId = nextId++;

        SetArgument(draftProduct, 5, $"#{placementId}");
        AddEntity(draft, placementId, "IFCLOCALPLACEMENT", ["$", $"#{axisPlacementId}"]);
        AddEntity(draft, axisPlacementId, "IFCAXIS2PLACEMENT3D", [$"#{pointId}", "$", "$"]);
        AddEntity(draft, pointId, "IFCCARTESIANPOINT", ["(0.,0.,0.)"]);

        return IfcStepParser.Parse(draft.ToStepText(), draft.FileName);
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
        string relationshipGlobalIdPrefix,
        string relationshipLabel,
        string[] resourceArguments)
    {
        if (!CanAssignResource(document, productId))
        {
            return document;
        }

        var draft = IfcStepParser.Parse(document.ToStepText(), document.FileName);
        var nextId = IfcStepWriter.NextEntityId(draft);
        var resourceId = nextId++;
        var relationshipId = nextId++;
        var product = document.EntityById[productId];

        AddEntity(draft, resourceId, resourceType, resourceArguments);
        AddEntity(
            draft,
            relationshipId,
            relationshipType,
            [MakeGeneratedGlobalId(relationshipGlobalIdPrefix, relationshipId), "$", StepArgumentReader.Quote($"{product.DisplayName} {relationshipLabel}"), "$", $"(#{productId})", $"#{resourceId}"]);

        return IfcStepParser.Parse(draft.ToStepText(), draft.FileName);
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
        var draft = IfcStepParser.Parse(document.ToStepText(), document.FileName);
        var nextId = IfcStepWriter.NextEntityId(draft);
        var openingId = nextId++;
        var placementId = nextId++;
        var axisPlacementId = nextId++;
        var pointId = nextId++;
        var voidRelationshipId = nextId++;
        var hostPlacementId = document.PlacementsByEntity.TryGetValue(hostElementId, out var hostPlacement)
            ? hostPlacement.PlacementId
            : 0;

        AddEntity(
            draft,
            openingId,
            "IFCOPENINGELEMENT",
            [MakeGeneratedGlobalId("Opening", openingId), "$", StepArgumentReader.Quote(name), "$", "$", $"#{placementId}", "$", "$", ".OPENING."]);
        AddEntity(draft, placementId, "IFCLOCALPLACEMENT", [hostPlacementId == 0 ? "$" : $"#{hostPlacementId}", $"#{axisPlacementId}"]);
        AddEntity(draft, axisPlacementId, "IFCAXIS2PLACEMENT3D", [$"#{pointId}", "$", "$"]);
        AddEntity(draft, pointId, "IFCCARTESIANPOINT", ["(0.,0.,0.)"]);
        AddEntity(
            draft,
            voidRelationshipId,
            "IFCRELVOIDSELEMENT",
            [MakeGeneratedGlobalId("Void", voidRelationshipId), "$", StepArgumentReader.Quote($"{host.DisplayName} voids {name}"), "$", $"#{hostElementId}", $"#{openingId}"]);

        var withOpening = IfcStepParser.Parse(draft.ToStepText(), draft.FileName);
        return AssignBodyRepresentation(withOpening, openingId, widthText, depthText, heightText, profileText);
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
        var draft = IfcStepParser.Parse(document.ToStepText(), document.FileName);
        var nextId = IfcStepWriter.NextEntityId(draft);
        var fillingId = nextId++;
        var placementId = nextId++;
        var axisPlacementId = nextId++;
        var pointId = nextId++;
        var fillRelationshipId = nextId++;
        var openingPlacementId = document.PlacementsByEntity.TryGetValue(openingElementId, out var openingPlacement)
            ? openingPlacement.PlacementId
            : 0;

        AddEntity(
            draft,
            fillingId,
            productType,
            [MakeGeneratedGlobalId("Filling", fillingId), "$", StepArgumentReader.Quote(name), "$", "$", $"#{placementId}", "$", "$", "$"]);
        AddEntity(draft, placementId, "IFCLOCALPLACEMENT", [openingPlacementId == 0 ? "$" : $"#{openingPlacementId}", $"#{axisPlacementId}"]);
        AddEntity(draft, axisPlacementId, "IFCAXIS2PLACEMENT3D", [$"#{pointId}", "$", "$"]);
        AddEntity(draft, pointId, "IFCCARTESIANPOINT", ["(0.,0.,0.)"]);
        AddEntity(
            draft,
            fillRelationshipId,
            "IFCRELFILLSELEMENT",
            [MakeGeneratedGlobalId("Fill", fillRelationshipId), "$", StepArgumentReader.Quote($"{opening.DisplayName} filled by {name}"), "$", $"#{openingElementId}", $"#{fillingId}"]);

        var withFilling = IfcStepParser.Parse(draft.ToStepText(), draft.FileName);
        return AssignBodyRepresentation(withFilling, fillingId, widthText, depthText, heightText, profileText);
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
        var draft = IfcStepParser.Parse(document.ToStepText(), document.FileName);
        var nextId = IfcStepWriter.NextEntityId(draft);
        var productId = nextId++;
        var placementId = nextId++;
        var axisPlacementId = nextId++;
        var pointId = nextId++;
        var containmentId = nextId++;
        var parentPlacementId = document.PlacementsByEntity.TryGetValue(parentSpatialId, out var parentPlacement)
            ? parentPlacement.PlacementId
            : 0;

        AddEntity(
            draft,
            productId,
            productType,
            [MakeGeneratedGlobalId("Product", productId), "$", StepArgumentReader.Quote(name), "$", "$", $"#{placementId}", "$", "$", "$"]);
        AddEntity(draft, placementId, "IFCLOCALPLACEMENT", [parentPlacementId == 0 ? "$" : $"#{parentPlacementId}", $"#{axisPlacementId}"]);
        AddEntity(draft, axisPlacementId, "IFCAXIS2PLACEMENT3D", [$"#{pointId}", "$", "$"]);
        AddEntity(draft, pointId, "IFCCARTESIANPOINT", ["(0.,0.,0.)"]);
        AddEntity(
            draft,
            containmentId,
            "IFCRELCONTAINEDINSPATIALSTRUCTURE",
            [MakeGeneratedGlobalId("Contain", containmentId), "$", StepArgumentReader.Quote($"{parent.DisplayName} contains {name}"), "$", $"(#{productId})", $"#{parentSpatialId}"]);

        var withProduct = IfcStepParser.Parse(draft.ToStepText(), draft.FileName);
        return AssignBodyRepresentation(withProduct, productId, widthText, depthText, heightText, profileText);
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

        var width = Math.Max(0.001, ParseCoordinate(widthText, 1));
        var depth = Math.Max(0.001, ParseCoordinate(depthText, width));
        var height = Math.Max(0.001, ParseCoordinate(heightText, 1));
        var isCylinder = string.Equals(profileText.Trim(), "cylinder", StringComparison.OrdinalIgnoreCase);

        var draft = IfcStepParser.Parse(document.ToStepText(), document.FileName);
        if (!draft.EntityById.TryGetValue(productId, out var draftProduct))
        {
            return document;
        }

        var nextId = IfcStepWriter.NextEntityId(draft);
        var contextId = EnsureRepresentationContext(draft, ref nextId);
        var shapeId = nextId++;
        var representationId = nextId++;
        var solidId = nextId++;
        var solidAxisId = nextId++;
        var solidPointId = nextId++;
        var profileId = nextId++;
        var profileAxisId = nextId++;
        var profilePointId = nextId++;
        var extrusionDirectionId = nextId++;
        var profileDirectionId = nextId++;

        SetArgument(draftProduct, 6, $"#{shapeId}");

        AddEntity(draft, shapeId, "IFCPRODUCTDEFINITIONSHAPE", ["$", "$", $"(#{representationId})"]);
        AddEntity(draft, representationId, "IFCSHAPEREPRESENTATION", [$"#{contextId}", StepArgumentReader.Quote("Body"), StepArgumentReader.Quote("SweptSolid"), $"(#{solidId})"]);
        AddEntity(draft, solidId, "IFCEXTRUDEDAREASOLID", [$"#{profileId}", $"#{solidAxisId}", $"#{extrusionDirectionId}", FormatMeasure(height)]);
        AddEntity(draft, solidAxisId, "IFCAXIS2PLACEMENT3D", [$"#{solidPointId}", "$", "$"]);
        AddEntity(draft, solidPointId, "IFCCARTESIANPOINT", ["(0.,0.,0.)"]);
        AddEntity(
            draft,
            profileId,
            isCylinder ? "IFCCIRCLEPROFILEDEF" : "IFCRECTANGLEPROFILEDEF",
            isCylinder
                ? [".AREA.", StepArgumentReader.Quote("Assigned Cylindrical Body"), $"#{profileAxisId}", FormatMeasure(Math.Max(width, depth) / 2)]
                : [".AREA.", StepArgumentReader.Quote("Assigned Rectangular Body"), $"#{profileAxisId}", FormatMeasure(width), FormatMeasure(depth)]);
        AddEntity(draft, profileAxisId, "IFCAXIS2PLACEMENT2D", [$"#{profilePointId}", $"#{profileDirectionId}"]);
        AddEntity(draft, profilePointId, "IFCCARTESIANPOINT", ["(0.,0.)"]);
        AddEntity(draft, extrusionDirectionId, "IFCDIRECTION", ["(0.,0.,1.)"]);
        AddEntity(draft, profileDirectionId, "IFCDIRECTION", ["(1.,0.)"]);

        return IfcStepParser.Parse(draft.ToStepText(), draft.FileName);
    }

    public static IfcDocument UpdateEntity(IfcDocument document, int entityId, string name, string description, string rawArguments)
    {
        var draft = IfcStepParser.Parse(document.ToStepText(), document.FileName);
        if (!draft.EntityById.TryGetValue(entityId, out var draftEntity))
        {
            return document;
        }

        draftEntity.Name = name.Trim();
        draftEntity.Description = description.Trim();

        var normalizedArguments = rawArguments.Trim();
        if (!string.IsNullOrWhiteSpace(normalizedArguments))
        {
            draftEntity.Arguments.Clear();
            draftEntity.Arguments.AddRange(StepArgumentReader.SplitTopLevel(normalizedArguments));
        }

        return IfcStepParser.Parse(draft.ToStepText(), draft.FileName);
    }

    public static IfcDocument UpdatePlacement(IfcDocument document, int productId, string xText, string yText, string zText)
    {
        if (!document.PlacementsByEntity.TryGetValue(productId, out var placement))
        {
            return document;
        }

        var draft = IfcStepParser.Parse(document.ToStepText(), document.FileName);
        if (!draft.EntityById.TryGetValue(placement.PointId, out var point))
        {
            return document;
        }

        var x = ParseCoordinate(xText, placement.X);
        var y = ParseCoordinate(yText, placement.Y);
        var z = ParseCoordinate(zText, placement.Z);

        while (point.Arguments.Count == 0)
        {
            point.Arguments.Add("(0.,0.,0.)");
        }

        point.Arguments[0] = $"({FormatCoordinate(x)},{FormatCoordinate(y)},{FormatCoordinate(z)})";
        return IfcStepParser.Parse(draft.ToStepText(), draft.FileName);
    }

    public static IfcDocument UpdateSpatialParent(IfcDocument document, int childId, string parentIdText)
    {
        var relationship = document.RelationshipsByEntity.TryGetValue(childId, out var relationships)
            ? relationships
                .Where(candidate => candidate.TargetIds.Contains(childId))
                .Where(candidate => candidate.Type is "IFCRELCONTAINEDINSPATIALSTRUCTURE" or "IFCRELAGGREGATES")
                .OrderBy(candidate => candidate.Type == "IFCRELCONTAINEDINSPATIALSTRUCTURE" ? 0 : 1)
                .ThenBy(candidate => candidate.Id)
                .FirstOrDefault()
            : null;

        if (relationship is null)
        {
            return document;
        }

        var parentId = ReadIds(parentIdText).FirstOrDefault();
        if (parentId == 0 || !document.EntityById.TryGetValue(parentId, out var parent) || parentId == childId)
        {
            return document;
        }

        if (!IsSpatialParent(parent.Type) || HasSpatialDescendant(document, childId, parentId))
        {
            return document;
        }

        var draft = IfcStepParser.Parse(document.ToStepText(), document.FileName);
        if (!draft.EntityById.TryGetValue(relationship.Id, out var draftRelationship))
        {
            return document;
        }

        if (relationship.Type == "IFCRELCONTAINEDINSPATIALSTRUCTURE")
        {
            SetArgument(draftRelationship, 5, $"#{parentId}");
        }
        else
        {
            SetArgument(draftRelationship, 4, $"#{parentId}");
        }

        return IfcStepParser.Parse(draft.ToStepText(), draft.FileName);
    }

    public static IfcDocument RemoveFromSpatialParent(IfcDocument document, int childId)
    {
        var relationship = document.RelationshipsByEntity.TryGetValue(childId, out var relationships)
            ? relationships
                .Where(candidate => candidate.TargetIds.Contains(childId))
                .Where(candidate => candidate.Type is "IFCRELCONTAINEDINSPATIALSTRUCTURE" or "IFCRELAGGREGATES")
                .OrderBy(candidate => candidate.Type == "IFCRELCONTAINEDINSPATIALSTRUCTURE" ? 0 : 1)
                .ThenBy(candidate => candidate.Id)
                .FirstOrDefault()
            : null;

        if (relationship is null)
        {
            return document;
        }

        var draft = IfcStepParser.Parse(document.ToStepText(), document.FileName);
        if (!draft.EntityById.TryGetValue(relationship.Id, out var draftRelationship))
        {
            return document;
        }

        var targetArgumentIndex = relationship.Type == "IFCRELCONTAINEDINSPATIALSTRUCTURE" ? 4 : 5;
        var remainingTargets = relationship.TargetIds.Where(id => id != childId).Distinct().ToList();
        if (remainingTargets.Count == 0)
        {
            draft.Entities.RemoveAll(entity => entity.Id == relationship.Id);
            draft.EntityById.Remove(relationship.Id);
        }
        else
        {
            SetArgument(draftRelationship, targetArgumentIndex, FormatReferenceArgument(remainingTargets, asList: true));
        }

        return IfcStepParser.Parse(draft.ToStepText(), draft.FileName);
    }

    private static bool HasSpatialDescendant(IfcDocument document, int rootId, int candidateDescendantId)
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

            foreach (var childId in document.RelationshipById.Values
                .Where(relationship => relationship.Type is "IFCRELAGGREGATES" or "IFCRELCONTAINEDINSPATIALSTRUCTURE")
                .Where(relationship => relationship.SourceIds.Contains(current))
                .SelectMany(relationship => relationship.TargetIds))
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
        var draft = IfcStepParser.Parse(document.ToStepText(), document.FileName);
        if (!draft.EntityById.TryGetValue(propertyValueId, out var propertyValue))
        {
            return document;
        }

        var valueArgumentIndex = propertyValue.Type switch
        {
            "IFCPROPERTYSINGLEVALUE" => 2,
            "IFCQUANTITYLENGTH" or "IFCQUANTITYAREA" or "IFCQUANTITYVOLUME" or "IFCQUANTITYCOUNT" or "IFCQUANTITYWEIGHT" or "IFCQUANTITYTIME" => 3,
            _ => -1,
        };

        if (valueArgumentIndex < 0)
        {
            return document;
        }

        while (propertyValue.Arguments.Count <= valueArgumentIndex)
        {
            propertyValue.Arguments.Add("$");
        }

        propertyValue.Arguments[valueArgumentIndex] = string.IsNullOrWhiteSpace(rawValue) ? "$" : rawValue.Trim();
        return IfcStepParser.Parse(draft.ToStepText(), draft.FileName);
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

        var draft = IfcStepParser.Parse(document.ToStepText(), document.FileName);
        var relationshipId = IfcStepWriter.NextEntityId(draft);
        var name = string.IsNullOrWhiteSpace(nameText) ? $"Native {relationshipType}" : nameText.Trim();
        var arguments = Enumerable.Repeat("$", Math.Max(map.SourceArgumentIndex, map.TargetArgumentIndex) + 1).ToList();
        arguments[0] = MakeGeneratedGlobalId("Rel", relationshipId);
        arguments[2] = StepArgumentReader.Quote(name);
        arguments[map.SourceArgumentIndex] = FormatReferenceArgument(sourceIds, map.SourceIsList);
        arguments[map.TargetArgumentIndex] = FormatReferenceArgument(targetIds, map.TargetIsList);

        AddEntity(draft, relationshipId, relationshipType, arguments);
        return IfcStepParser.Parse(draft.ToStepText(), draft.FileName);
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

        var draft = IfcStepParser.Parse(document.ToStepText(), document.FileName);
        draft.Entities.RemoveAll(entity => relationshipIds.Contains(entity.Id));
        foreach (var relationshipId in relationshipIds)
        {
            draft.EntityById.Remove(relationshipId);
        }

        return IfcStepParser.Parse(draft.ToStepText(), draft.FileName);
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

        var draft = IfcStepParser.Parse(document.ToStepText(), document.FileName);
        if (!draft.EntityById.TryGetValue(relationshipId, out var draftRelationship))
        {
            return document;
        }

        SetArgument(draftRelationship, map.SourceArgumentIndex, FormatReferenceArgument(ReadIds(sourceIdsText), map.SourceIsList));
        SetArgument(draftRelationship, map.TargetArgumentIndex, FormatReferenceArgument(ReadIds(targetIdsText), map.TargetIsList));
        return IfcStepParser.Parse(draft.ToStepText(), draft.FileName);
    }

    public static IfcDocument RemoveRelationship(IfcDocument document, int relationshipId)
    {
        if (!document.RelationshipById.ContainsKey(relationshipId))
        {
            return document;
        }

        var draft = IfcStepParser.Parse(document.ToStepText(), document.FileName);
        var removed = draft.Entities.RemoveAll(entity => entity.Id == relationshipId);
        if (removed == 0)
        {
            return document;
        }

        draft.EntityById.Remove(relationshipId);
        return IfcStepParser.Parse(draft.ToStepText(), draft.FileName);
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
        foreach (var match in System.Text.RegularExpressions.Regex.Matches(text, @"#?(\d+)"))
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

    private static int EnsureRepresentationContext(IfcDocument draft, ref int nextId)
    {
        var existingContext = draft.Entities.FirstOrDefault(entity => entity.Type is "IFCGEOMETRICREPRESENTATIONCONTEXT" or "IFCGEOMETRICREPRESENTATIONSUBCONTEXT");
        if (existingContext is not null)
        {
            return existingContext.Id;
        }

        var contextId = nextId++;
        AddEntity(draft, contextId, "IFCGEOMETRICREPRESENTATIONCONTEXT", [StepArgumentReader.Quote("Body"), StepArgumentReader.Quote("Model"), "3", "1.E-05", "$", "$"]);
        return contextId;
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

    private static string FormatCoordinate(double value)
    {
        return FormatMeasure(value);
    }

    private static string FormatMeasure(double value)
    {
        var formatted = value.ToString("0.########", CultureInfo.InvariantCulture);
        return formatted.Contains('.', StringComparison.Ordinal) ? formatted : $"{formatted}.";
    }
}
