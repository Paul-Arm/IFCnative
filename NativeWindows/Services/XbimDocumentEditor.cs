using System.Collections;
using System.Globalization;
using System.Reflection;
using IFCnative.NativeWindows.Models;
using Xbim.Common;
using Xbim.Ifc;
using Xbim.IO.Step21;

namespace IFCnative.NativeWindows.Services;

public static class XbimDocumentEditor
{
    private sealed record RelationshipEndpointProperties(
        string? SourceProperty,
        string? SourceCollection,
        string? TargetProperty,
        string? TargetCollection);

    public static bool CanUpdateRelationshipEndpoints(string relationshipType)
    {
        return relationshipType is "IFCRELAGGREGATES" or "IFCRELNESTS"
            or "IFCRELCONTAINEDINSPATIALSTRUCTURE" or "IFCRELREFERENCEDINSPATIALSTRUCTURE"
            or "IFCRELDEFINESBYPROPERTIES" or "IFCRELDEFINESBYTYPE"
            or "IFCRELASSIGNSTOGROUP" or "IFCRELASSIGNSTOPROCESS" or "IFCRELASSIGNSTOCONTROL" or "IFCRELASSIGNSTOPRODUCT"
            or "IFCRELASSOCIATESMATERIAL" or "IFCRELASSOCIATESCLASSIFICATION" or "IFCRELASSOCIATESDOCUMENT" or "IFCRELASSOCIATESLIBRARY"
            or "IFCRELVOIDSELEMENT" or "IFCRELFILLSELEMENT" or "IFCRELCONNECTSPORTS"
            or "IFCRELCONNECTSPORTTOELEMENT" or "IFCRELINTERFERESELEMENTS" or "IFCRELPROJECTSELEMENT"
            or "IFCRELCONNECTSELEMENTS";
    }

    public static IfcDocument UpdateEntity(IfcDocument document, int entityId, string name, string description)
    {
        return Edit(document, "Update entity", store =>
        {
            var entity = GetEntity(store, entityId);
            if (entity is null)
            {
                return;
            }

            SetPropertyIfPresent(entity, "Name", string.IsNullOrWhiteSpace(name) ? null : name.Trim());
            SetPropertyIfPresent(entity, "Description", string.IsNullOrWhiteSpace(description) ? null : description.Trim());
        });
    }

    public static IfcDocument UpdatePropertyValue(IfcDocument document, int propertyValueId, string rawValue)
    {
        return Edit(document, "Update property value", store =>
        {
            var property = GetEntity(store, propertyValueId);
            if (property is null || !HasProperty(property, "NominalValue"))
            {
                return;
            }

            var current = GetPropertyValue(property, "NominalValue");
            var valueType = current?.GetType() ?? ResolveSchemaType(store, "MeasureResource", "IfcLabel");
            SetProperty(property, "NominalValue", CreateMeasureValue(valueType, rawValue));
        });
    }

    public static IfcDocument AddCommonPropertySet(IfcDocument document, int productId, string referenceText, string statusText)
    {
        return Edit(document, "Add common property set", store =>
        {
            var product = GetEntity(store, productId);
            if (product is null)
            {
                return;
            }

            var reference = string.IsNullOrWhiteSpace(referenceText) ? ReadName(product, "Native reference") : referenceText.Trim();
            var status = string.IsNullOrWhiteSpace(statusText) ? "New" : statusText.Trim();
            var pset = CreatePropertySet(store, "Pset_NativeCommon", [
                ("Reference", "IfcLabel", reference),
                ("Status", "IfcLabel", status),
                ("IsExternal", "IfcBoolean", "false"),
            ]);
            AttachPropertySet(store, product, pset, $"{ReadName(product, "Product")} common properties");
        });
    }

    public static IfcDocument AddBaseQuantitySet(IfcDocument document, int productId, string widthText, string depthText, string heightText)
    {
        return Edit(document, "Add base quantities", store =>
        {
            var product = GetEntity(store, productId);
            if (product is null)
            {
                return;
            }

            var quantitySet = New(store, ResolveSchemaType(store, "ProductExtension", "IfcElementQuantity"));
            SetRootDefaults(store, quantitySet, "Qto_NativeBaseQuantities", "IFCnative base quantities");
            AddToCollection(GetPropertyValue(quantitySet, "Quantities"), CreateQuantity(store, "IfcQuantityLength", "Length", heightText, "LengthValue"));
            AddToCollection(GetPropertyValue(quantitySet, "Quantities"), CreateQuantity(store, "IfcQuantityArea", "GrossArea", widthText, "AreaValue"));
            AddToCollection(GetPropertyValue(quantitySet, "Quantities"), CreateQuantity(store, "IfcQuantityVolume", "GrossVolume", depthText, "VolumeValue"));
            AttachPropertySet(store, product, quantitySet, $"{ReadName(product, "Product")} base quantities");
        });
    }

    public static IfcDocument UpdatePlacement(IfcDocument document, int productId, string xText, string yText, string zText)
    {
        return Edit(document, "Update placement", store =>
        {
            var product = GetEntity(store, productId);
            var location = GetPlacementLocation(product);
            if (location is null)
            {
                return;
            }

            SetCoordinateList(
                GetPropertyValue(location, "Coordinates"),
                ParseDouble(xText, 0),
                ParseDouble(yText, 0),
                ParseDouble(zText, 0));
        }, affectsGeometry: true);
    }

    public static IfcDocument UpdateSpatialParent(IfcDocument document, int childId, string parentIdText)
    {
        var parentId = ReadIds(parentIdText).FirstOrDefault();
        var currentContainment = FindContainment(document, childId);
        return Edit(document, "Update spatial parent", store =>
        {
            var child = GetEntity(store, childId);
            var parent = GetEntity(store, parentId);
            if (child is null || parent is null)
            {
                return;
            }

            if (currentContainment is not null)
            {
                var relation = GetEntity(store, currentContainment.Id);
                if (relation is not null && currentContainment.TargetIds.Count == 1)
                {
                    SetPropertyIfPresent(relation, "RelatingStructure", parent);
                    return;
                }

                if (relation is not null)
                {
                    RemoveFromCollection(GetPropertyValue(relation, "RelatedElements"), child);
                }
            }

            CreateContainment(store, parent, child, $"{ReadName(parent, "Parent")} contains {ReadName(child, "Product")}");
        });
    }

    public static IfcDocument RemoveFromSpatialParent(IfcDocument document, int childId)
    {
        var currentContainment = FindContainment(document, childId);
        return Edit(document, "Detach spatial parent", store =>
        {
            var child = GetEntity(store, childId);
            var relation = currentContainment is null ? null : GetEntity(store, currentContainment.Id);
            if (child is null || relation is null)
            {
                return;
            }

            RemoveFromCollection(GetPropertyValue(relation, "RelatedElements"), child);
            if (!AsEnumerable(GetPropertyValue(relation, "RelatedElements")).Any())
            {
                store.Delete(relation);
            }
        });
    }

    public static IfcDocument AddProduct(IfcDocument document, int parentSpatialId, string productTypeText, string nameText)
    {
        return Edit(document, "Create product", store =>
        {
            var parent = GetEntity(store, parentSpatialId);
            if (parent is null)
            {
                return;
            }

            var productType = NormalizeIfcType(productTypeText, "IFCBUILDINGELEMENTPROXY");
            var product = New(store, ResolveIfcEntityType(store, productType));
            var name = string.IsNullOrWhiteSpace(nameText) ? "New xBIM product" : nameText.Trim();
            SetRootDefaults(store, product, name, string.Empty);
            SetPropertyIfPresent(product, "ObjectPlacement", CreateLocalPlacement(store, parent));

            CreateContainment(store, parent, product, $"{ReadName(parent, "Parent")} contains {name}");
        }, affectsGeometry: true);
    }

    public static IfcDocument AddProductWithBodyRepresentation(
        IfcDocument document,
        int parentSpatialId,
        string productTypeText,
        string nameText,
        string widthText,
        string depthText,
        string heightText,
        string profileText)
    {
        return Edit(document, "Create product with body", store =>
        {
            var parent = GetEntity(store, parentSpatialId);
            if (parent is null)
            {
                return;
            }

            var productType = NormalizeIfcType(productTypeText, "IFCBUILDINGELEMENTPROXY");
            var product = New(store, ResolveIfcEntityType(store, productType));
            var name = string.IsNullOrWhiteSpace(nameText) ? "New xBIM product" : nameText.Trim();
            SetRootDefaults(store, product, name, string.Empty);
            SetPropertyIfPresent(product, "ObjectPlacement", CreateLocalPlacement(store, parent));
            SetPropertyIfPresent(product, "Representation", CreateBodyRepresentation(store, widthText, depthText, heightText, profileText));
            CreateContainment(store, parent, product, $"{ReadName(parent, "Parent")} contains {name}");
        }, affectsGeometry: true);
    }

    public static IfcDocument AddResource(IfcDocument document, int productId, string kind, string nameText, string identificationText)
    {
        return Edit(document, $"Add {kind} resource", store =>
        {
            var product = GetEntity(store, productId);
            if (product is null)
            {
                return;
            }

            var normalizedKind = string.IsNullOrWhiteSpace(kind) ? "material" : kind.Trim().ToLowerInvariant();
            var resourceType = normalizedKind switch
            {
                "classification" => "IFCCLASSIFICATIONREFERENCE",
                "document" => "IFCDOCUMENTREFERENCE",
                "library" => "IFCLIBRARYREFERENCE",
                _ => "IFCMATERIAL",
            };
            var relationshipType = normalizedKind switch
            {
                "classification" => "IFCRELASSOCIATESCLASSIFICATION",
                "document" => "IFCRELASSOCIATESDOCUMENT",
                "library" => "IFCRELASSOCIATESLIBRARY",
                _ => "IFCRELASSOCIATESMATERIAL",
            };
            var resource = New(store, ResolveIfcEntityType(store, resourceType));
            var name = string.IsNullOrWhiteSpace(nameText) ? $"xBIM {normalizedKind}" : nameText.Trim();
            SetPropertyIfPresent(resource, "Name", name);
            SetPropertyIfPresent(resource, "Description", name);
            SetPropertyIfPresent(resource, "Identification", string.IsNullOrWhiteSpace(identificationText) ? null : identificationText.Trim());
            SetPropertyIfPresent(resource, "ItemReference", string.IsNullOrWhiteSpace(identificationText) ? null : identificationText.Trim());
            SetPropertyIfPresent(resource, "Location", string.IsNullOrWhiteSpace(identificationText) ? null : identificationText.Trim());

            var relation = New(store, ResolveIfcEntityType(store, relationshipType));
            SetRootDefaults(store, relation, $"{ReadName(product, "Product")} {normalizedKind}", string.Empty);
            AddToCollection(GetPropertyValue(relation, "RelatedObjects"), product);
            SetFirstAvailableProperty(relation, ["RelatingMaterial", "RelatingClassification", "RelatingDocument", "RelatingLibrary"], resource);
        });
    }

    public static IfcDocument AssignBodyRepresentation(IfcDocument document, int productId, string widthText, string depthText, string heightText, string profileText)
    {
        return Edit(document, "Assign body representation", store =>
        {
            var product = GetEntity(store, productId);
            if (product is null)
            {
                return;
            }

            SetPropertyIfPresent(product, "Representation", CreateBodyRepresentation(store, widthText, depthText, heightText, profileText));
        }, affectsGeometry: true);
    }

    public static IfcDocument AddRelationship(IfcDocument document, string relationshipTypeText, string sourceIdsText, string targetIdsText, string nameText)
    {
        return Edit(document, "Add relationship", store =>
        {
            var relationshipType = NormalizeIfcType(relationshipTypeText, "IFCRELDEFINESBYPROPERTIES");
            var relation = New(store, ResolveIfcEntityType(store, relationshipType));
            SetRootDefaults(store, relation, string.IsNullOrWhiteSpace(nameText) ? relationshipType : nameText.Trim(), string.Empty);
            var sources = ReadIds(sourceIdsText).Select(id => GetEntity(store, id)).Where(entity => entity is not null).Cast<object>().ToList();
            var targets = ReadIds(targetIdsText).Select(id => GetEntity(store, id)).Where(entity => entity is not null).Cast<object>().ToList();
            var map = GetEndpointPropertyMap(relationshipType);
            if (map is not null)
            {
                ApplyEndpointMap(relation, map, sources, targets);
                return;
            }

            foreach (var source in sources)
            {
                AddToFirstAvailableCollection(relation, ["RelatedObjects", "RelatedElements", "RelatingObjects"], source);
                SetFirstAvailableProperty(relation, ["RelatingStructure", "RelatingObject", "RelatingElement"], source);
            }

            foreach (var target in targets)
            {
                AddToFirstAvailableCollection(relation, ["RelatedObjects", "RelatedElements"], target);
                SetFirstAvailableProperty(relation, ["RelatedObject", "RelatedElement"], target);
            }
        });
    }

    public static IfcDocument UpdateRelationshipEndpoints(IfcDocument document, int relationshipId, string sourceIdsText, string targetIdsText)
    {
        return Edit(document, "Update relationship endpoints", store =>
        {
            var relation = GetEntity(store, relationshipId);
            if (relation is null)
            {
                return;
            }

            var sources = ReadIds(sourceIdsText).Select(id => GetEntity(store, id)).Where(entity => entity is not null).Cast<object>().ToList();
            var targets = ReadIds(targetIdsText).Select(id => GetEntity(store, id)).Where(entity => entity is not null).Cast<object>().ToList();
            if (sources.Count == 0 && targets.Count == 0)
            {
                return;
            }

            var relationshipType = ToIfcType(relation);
            var map = GetEndpointPropertyMap(relationshipType);
            if (map is not null)
            {
                ApplyEndpointMap(relation, map, sources, targets);
                return;
            }

            ReplaceFirstAvailableCollection(relation, ["RelatedObjects", "RelatedElements"], targets.Count > 0 ? targets : sources);
            SetFirstAvailableProperty(relation, ["RelatingStructure", "RelatingObject", "RelatingElement"], sources.FirstOrDefault() ?? targets.FirstOrDefault()!);
            SetFirstAvailableProperty(relation, ["RelatedObject", "RelatedElement"], targets.FirstOrDefault() ?? sources.FirstOrDefault()!);
        });
    }

    public static IfcDocument DeleteRelationship(IfcDocument document, int relationshipId)
    {
        return Edit(document, "Delete relationship", store =>
        {
            var relation = GetEntity(store, relationshipId);
            if (relation is not null)
            {
                store.Delete(relation);
            }
        });
    }

    public static IfcDocument GenerateMissingGlobalId(IfcDocument document, int entityId)
    {
        return Edit(document, "Generate missing GlobalId", store =>
        {
            var entity = GetEntity(store, entityId);
            if (entity is not null)
            {
                SetPropertyIfPresent(entity, "GlobalId", StepGuidHelper.ConvertToBase64(Guid.NewGuid()));
            }
        });
    }

    public static IfcDocument RegenerateDuplicateGlobalIds(IfcDocument document, string diagnosticMessage)
    {
        var duplicateIds = ReadHashIds(diagnosticMessage).Skip(1).ToList();
        return Edit(document, "Regenerate duplicate GlobalIds", store =>
        {
            foreach (var entity in duplicateIds.Select(id => GetEntity(store, id)).Where(entity => entity is not null))
            {
                SetPropertyIfPresent(entity!, "GlobalId", StepGuidHelper.ConvertToBase64(Guid.NewGuid()));
            }
        });
    }

    public static IfcDocument AssignDefaultPlacement(IfcDocument document, int productId)
    {
        var parentId = FindContainment(document, productId)?.SourceIds.FirstOrDefault() ?? 0;
        return Edit(document, "Assign default placement", store =>
        {
            var product = GetEntity(store, productId);
            if (product is null)
            {
                return;
            }

            SetPropertyIfPresent(product, "ObjectPlacement", CreateLocalPlacement(store, parentId == 0 ? null : GetEntity(store, parentId)));
        }, affectsGeometry: true);
    }

    public static IfcDocument AssignDefaultBodyRepresentation(IfcDocument document, int productId)
    {
        return AssignBodyRepresentation(document, productId, "1", "1", "1", "rectangle");
    }

    public static IfcDocument KeepFirstPrimarySpatialContainment(IfcDocument document, int productId)
    {
        var duplicateContainments = document.RelationshipById.Values
            .Where(relationship => relationship.Type == "IFCRELCONTAINEDINSPATIALSTRUCTURE" && relationship.TargetIds.Contains(productId))
            .OrderBy(relationship => relationship.Id)
            .Skip(1)
            .Select(relationship => relationship.Id)
            .ToList();
        return Edit(document, "Repair spatial containment", store =>
        {
            var product = GetEntity(store, productId);
            if (product is null)
            {
                return;
            }

            foreach (var relationshipId in duplicateContainments)
            {
                var relation = GetEntity(store, relationshipId);
                if (relation is null)
                {
                    continue;
                }

                RemoveFromCollection(GetPropertyValue(relation, "RelatedElements"), product);
                if (!AsEnumerable(GetPropertyValue(relation, "RelatedElements")).Any())
                {
                    store.Delete(relation);
                }
            }
        });
    }

    public static IfcDocument RemoveRelationshipFromMissingReferenceDiagnostic(IfcDocument document, string diagnosticMessage)
    {
        var relationshipId = ReadHashIds(diagnosticMessage).FirstOrDefault();
        return relationshipId == 0 ? document : DeleteRelationship(document, relationshipId);
    }

    private static IfcDocument Edit(IfcDocument document, string transactionName, Action<IfcStore> apply, bool affectsGeometry = false)
    {
        var store = XbimIfcDocumentService.EnsureStore(document);
        using var transaction = store.BeginTransaction(transactionName);
        apply(store);
        transaction.Commit();

        if (affectsGeometry)
        {
            XbimIfcDocumentService.InvalidateGeometryContext(document);
        }

        var projected = XbimIfcDocumentService.ProjectStore(store, document.FileName);
        if (!affectsGeometry && XbimIfcDocumentService.TryGetGeometryContext(document) is { } geometryContext)
        {
            projected.XbimGeometryContext = geometryContext;
        }

        projected.Diagnostics.Info($"xBIM transaction committed: {transactionName}.");
        return projected;
    }

    private static IPersistEntity? GetEntity(IfcStore store, int entityId)
    {
        try
        {
            return store.Instances[entityId];
        }
        catch
        {
            return null;
        }
    }

    private static IPersistEntity New(IfcStore store, Type type)
    {
        return store.Instances.New(type);
    }

    private static IPersistEntity CreatePropertySet(IfcStore store, string name, IReadOnlyList<(string Name, string TypeName, string Value)> values)
    {
        var pset = New(store, ResolveSchemaType(store, "Kernel", "IfcPropertySet"));
        SetRootDefaults(store, pset, name, "IFCnative property set");
        var properties = GetPropertyValue(pset, "HasProperties");
        foreach (var value in values)
        {
            var property = New(store, ResolveSchemaType(store, "PropertyResource", "IfcPropertySingleValue"));
            SetProperty(property, "Name", value.Name);
            var measureType = ResolveSchemaType(store, "MeasureResource", value.TypeName);
            SetProperty(property, "NominalValue", CreateMeasureValue(measureType, value.Value));
            AddToCollection(properties, property);
        }

        return pset;
    }

    private static IPersistEntity CreateQuantity(IfcStore store, string typeName, string name, string valueText, string valueProperty)
    {
        var quantity = New(store, ResolveSchemaType(store, "QuantityResource", typeName));
        SetProperty(quantity, "Name", name);
        SetProperty(quantity, valueProperty, Math.Max(0, ParseDouble(valueText, 1)));
        return quantity;
    }

    private static void AttachPropertySet(IfcStore store, IPersistEntity product, IPersistEntity propertyDefinition, string relationName)
    {
        var relation = New(store, ResolveSchemaType(store, "Kernel", "IfcRelDefinesByProperties"));
        SetRootDefaults(store, relation, relationName, string.Empty);
        AddToCollection(GetPropertyValue(relation, "RelatedObjects"), product);
        SetProperty(relation, "RelatingPropertyDefinition", propertyDefinition);
    }

    private static void CreateContainment(IfcStore store, IPersistEntity parent, IPersistEntity child, string name)
    {
        var relation = New(store, ResolveSchemaType(store, "ProductExtension", "IfcRelContainedInSpatialStructure"));
        SetRootDefaults(store, relation, name, string.Empty);
        AddToCollection(GetPropertyValue(relation, "RelatedElements"), child);
        SetPropertyIfPresent(relation, "RelatingStructure", parent);
    }

    private static IPersistEntity CreateLocalPlacement(IfcStore store, IPersistEntity? parent)
    {
        var point = New(store, ResolveSchemaType(store, "GeometryResource", "IfcCartesianPoint"));
        SetCoordinateList(GetPropertyValue(point, "Coordinates"), 0, 0, 0);

        var axisPlacement = New(store, ResolveSchemaType(store, "GeometryResource", "IfcAxis2Placement3D"));
        SetProperty(axisPlacement, "Location", point);

        var localPlacement = New(store, ResolveSchemaType(store, "GeometricConstraintResource", "IfcLocalPlacement"));
        SetProperty(localPlacement, "RelativePlacement", axisPlacement);
        var parentPlacement = parent is null ? null : GetPropertyValue(parent, "ObjectPlacement");
        if (parentPlacement is IPersistEntity placement)
        {
            SetPropertyIfPresent(localPlacement, "PlacementRelTo", placement);
        }

        return localPlacement;
    }

    private static IPersistEntity CreateBodyRepresentation(IfcStore store, string widthText, string depthText, string heightText, string profileText)
    {
        var context = FindOrCreateGeometricRepresentationContext(store);
        var profile = CreateProfile(store, widthText, depthText, profileText);
        var solid = New(store, ResolveIfcEntityType(store, "IFCEXTRUDEDAREASOLID"));
        SetProperty(solid, "SweptArea", profile);
        SetPropertyIfPresent(solid, "Position", CreateAxis2Placement3D(store, 0, 0, 0));
        SetProperty(solid, "ExtrudedDirection", CreateDirection(store, 0, 0, 1));
        SetProperty(solid, "Depth", Math.Max(0.01, ParseDouble(heightText, 1)));

        var shape = New(store, ResolveIfcEntityType(store, "IFCSHAPEREPRESENTATION"));
        SetPropertyIfPresent(shape, "ContextOfItems", context);
        SetPropertyIfPresent(shape, "RepresentationIdentifier", "Body");
        SetPropertyIfPresent(shape, "RepresentationType", "SweptSolid");
        AddToCollection(GetPropertyValue(shape, "Items"), solid);

        var definitionShape = New(store, ResolveIfcEntityType(store, "IFCPRODUCTDEFINITIONSHAPE"));
        SetPropertyIfPresent(definitionShape, "Name", "xBIM body");
        AddToCollection(GetPropertyValue(definitionShape, "Representations"), shape);
        return definitionShape;
    }

    private static IPersistEntity FindOrCreateGeometricRepresentationContext(IfcStore store)
    {
        var existing = store.Instances
            .OfType<IPersistEntity>()
            .Where(instance => ToIfcType(instance) == "IFCGEOMETRICREPRESENTATIONCONTEXT")
            .FirstOrDefault(instance => (GetPropertyValue(instance, "ContextType")?.ToString() ?? string.Empty)
                .Contains("Model", StringComparison.OrdinalIgnoreCase));
        if (existing is not null)
        {
            return existing;
        }

        var context = New(store, ResolveIfcEntityType(store, "IFCGEOMETRICREPRESENTATIONCONTEXT"));
        SetPropertyIfPresent(context, "ContextIdentifier", "Body");
        SetPropertyIfPresent(context, "ContextType", "Model");
        SetPropertyIfPresent(context, "CoordinateSpaceDimension", 3);
        SetPropertyIfPresent(context, "Precision", 0.00001);
        SetPropertyIfPresent(context, "WorldCoordinateSystem", CreateAxis2Placement3D(store, 0, 0, 0));
        return context;
    }

    private static IPersistEntity CreateProfile(IfcStore store, string widthText, string depthText, string profileText)
    {
        var profile = profileText.Trim().Equals("cylinder", StringComparison.OrdinalIgnoreCase)
            ? New(store, ResolveIfcEntityType(store, "IFCCIRCLEPROFILEDEF"))
            : New(store, ResolveIfcEntityType(store, "IFCRECTANGLEPROFILEDEF"));
        SetEnumPropertyIfPresent(profile, "ProfileType", "AREA");
        SetPropertyIfPresent(profile, "ProfileName", profileText.Trim().Equals("cylinder", StringComparison.OrdinalIgnoreCase) ? "xBIM circle" : "xBIM rectangle");
        SetPropertyIfPresent(profile, "Position", CreateAxis2Placement2D(store, 0, 0));

        if (ToIfcType(profile) == "IFCCIRCLEPROFILEDEF")
        {
            var radius = Math.Max(0.01, ParseDouble(widthText, 1)) / 2;
            SetPropertyIfPresent(profile, "Radius", radius);
        }
        else
        {
            SetPropertyIfPresent(profile, "XDim", Math.Max(0.01, ParseDouble(widthText, 1)));
            SetPropertyIfPresent(profile, "YDim", Math.Max(0.01, ParseDouble(depthText, 1)));
        }

        return profile;
    }

    private static IPersistEntity CreateAxis2Placement3D(IfcStore store, double x, double y, double z)
    {
        var axisPlacement = New(store, ResolveSchemaType(store, "GeometryResource", "IfcAxis2Placement3D"));
        SetProperty(axisPlacement, "Location", CreateCartesianPoint(store, x, y, z));
        return axisPlacement;
    }

    private static IPersistEntity CreateAxis2Placement2D(IfcStore store, double x, double y)
    {
        var axisPlacement = New(store, ResolveSchemaType(store, "GeometryResource", "IfcAxis2Placement2D"));
        SetProperty(axisPlacement, "Location", CreateCartesianPoint(store, x, y));
        return axisPlacement;
    }

    private static IPersistEntity CreateCartesianPoint(IfcStore store, params double[] coordinates)
    {
        var point = New(store, ResolveSchemaType(store, "GeometryResource", "IfcCartesianPoint"));
        SetCoordinateList(GetPropertyValue(point, "Coordinates"), coordinates);
        return point;
    }

    private static IPersistEntity CreateDirection(IfcStore store, params double[] ratios)
    {
        var direction = New(store, ResolveSchemaType(store, "GeometryResource", "IfcDirection"));
        SetCoordinateList(GetPropertyValue(direction, "DirectionRatios"), ratios);
        return direction;
    }

    private static IPersistEntity? GetPlacementLocation(IPersistEntity? product)
    {
        var placement = GetPropertyValue(product, "ObjectPlacement");
        var relativePlacement = GetPropertyValue(placement, "RelativePlacement");
        return GetPropertyValue(relativePlacement, "Location") as IPersistEntity;
    }

    private static Type ResolveIfcEntityType(IfcStore store, string ifcType)
    {
        var className = ToPascalIfcName(ifcType);
        foreach (var section in new[] { "SharedBldgElements", "ProductExtension", "Kernel", "PropertyResource", "QuantityResource", "GeometricConstraintResource", "GeometryResource", "RepresentationResource", "MaterialResource", "ExternalReferenceResource", "ActorResource", "ConstraintResource", "ApprovalResource", "ConstructionMgmtDomain" })
        {
            var type = TryResolveSchemaType(store, section, className);
            if (type is not null)
            {
                return type;
            }
        }

        var normalizedStem = NormalizeIfcType(ifcType, "IFCBUILDINGELEMENTPROXY")[3..];
        var schemaPrefix = GetSchemaPrefix(store);
        var scanned = AppDomain.CurrentDomain.GetAssemblies()
            .Where(assembly => assembly.GetName().Name?.Equals(schemaPrefix, StringComparison.OrdinalIgnoreCase) == true)
            .SelectMany(GetLoadableTypes)
            .FirstOrDefault(type => type.Name.StartsWith("Ifc", StringComparison.Ordinal)
                && string.Equals(type.Name[3..].ToUpperInvariant(), normalizedStem, StringComparison.OrdinalIgnoreCase));
        if (scanned is not null)
        {
            return scanned;
        }

        throw new InvalidOperationException($"xBIM schema type not found for {ifcType}.");
    }

    private static Type ResolveSchemaType(IfcStore store, string section, string typeName)
    {
        return TryResolveSchemaType(store, section, typeName)
            ?? throw new InvalidOperationException($"xBIM schema type not found: {section}.{typeName}.");
    }

    private static Type? TryResolveSchemaType(IfcStore store, string section, string typeName)
    {
        var prefix = GetSchemaPrefix(store);
        var assembly = prefix[(prefix.LastIndexOf('.') + 1)..];
        return Type.GetType($"{prefix}.{section}.{typeName}, {prefix}")
            ?? Type.GetType($"{prefix}.{section}.{typeName}, {assembly}");
    }

    private static string GetSchemaPrefix(IfcStore store)
    {
        return store.SchemaVersion switch
        {
            Xbim.Common.Step21.XbimSchemaVersion.Ifc2X3 => "Xbim.Ifc2x3",
            Xbim.Common.Step21.XbimSchemaVersion.Ifc4x3 => "Xbim.Ifc4x3",
            _ => "Xbim.Ifc4",
        };
    }

    private static IEnumerable<Type> GetLoadableTypes(System.Reflection.Assembly assembly)
    {
        try
        {
            return assembly.GetTypes();
        }
        catch (System.Reflection.ReflectionTypeLoadException exception)
        {
            return exception.Types.Where(type => type is not null)!;
        }
    }

    private static void SetRootDefaults(IfcStore store, object entity, string name, string description)
    {
        SetPropertyIfPresent(entity, "GlobalId", StepGuidHelper.ConvertToBase64(Guid.NewGuid()));
        SetPropertyIfPresent(entity, "Name", string.IsNullOrWhiteSpace(name) ? null : name);
        SetPropertyIfPresent(entity, "Description", string.IsNullOrWhiteSpace(description) ? null : description);
    }

    private static void SetFirstAvailableProperty(object entity, IReadOnlyList<string> propertyNames, object value)
    {
        foreach (var propertyName in propertyNames)
        {
            if (SetPropertyIfPresent(entity, propertyName, value))
            {
                return;
            }
        }
    }

    private static bool SetEnumPropertyIfPresent(object entity, string propertyName, string value)
    {
        var property = FindProperty(entity.GetType(), propertyName);
        if (property is null)
        {
            return false;
        }

        var targetType = Nullable.GetUnderlyingType(property.PropertyType) ?? property.PropertyType;
        if (!targetType.IsEnum)
        {
            SetProperty(entity, propertyName, value);
            return true;
        }

        property.SetValue(entity, Enum.Parse(targetType, value, ignoreCase: true));
        return true;
    }

    private static void AddToFirstAvailableCollection(object entity, IReadOnlyList<string> propertyNames, object value)
    {
        foreach (var propertyName in propertyNames)
        {
            var collection = GetPropertyValue(entity, propertyName);
            if (AddToCollection(collection, value))
            {
                return;
            }
        }
    }

    private static bool SetPropertyIfPresent(object entity, string propertyName, object? value)
    {
        if (!HasProperty(entity, propertyName))
        {
            return false;
        }

        SetProperty(entity, propertyName, value);
        return true;
    }

    private static void SetProperty(object entity, string propertyName, object? value)
    {
        var property = FindProperty(entity.GetType(), propertyName)
            ?? throw new InvalidOperationException($"{entity.GetType().Name}.{propertyName} was not found.");
        property.SetValue(entity, ConvertForProperty(property.PropertyType, value));
    }

    private static bool HasProperty(object entity, string propertyName)
    {
        return FindProperty(entity.GetType(), propertyName) is not null;
    }

    private static object? GetPropertyValue(object? entity, string propertyName)
    {
        return entity is null ? null : FindProperty(entity.GetType(), propertyName)?.GetValue(entity);
    }

    private static PropertyInfo? FindProperty(Type type, string propertyName)
    {
        return type.GetProperty(propertyName)
            ?? type.GetProperties(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)
                .FirstOrDefault(property => property.GetIndexParameters().Length == 0
                    && property.Name.EndsWith($".{propertyName}", StringComparison.Ordinal));
    }

    private static object? ConvertForProperty(Type propertyType, object? value)
    {
        if (value is null)
        {
            return null;
        }

        var targetType = Nullable.GetUnderlyingType(propertyType) ?? propertyType;
        if (targetType.IsInstanceOfType(value))
        {
            return value;
        }

        if (typeof(IPersistEntity).IsAssignableFrom(targetType) && value is IPersistEntity)
        {
            return value;
        }

        if (targetType == typeof(string))
        {
            return value.ToString();
        }

        if (targetType == typeof(double))
        {
            return value is double number ? number : ParseDouble(value.ToString() ?? string.Empty, 0);
        }

        if (targetType == typeof(bool))
        {
            return value is bool boolean ? boolean : ParseBoolean(value.ToString() ?? string.Empty);
        }

        if (targetType == typeof(int))
        {
            return value is int integer ? integer : (int)ParseDouble(value.ToString() ?? string.Empty, 0);
        }

        if (targetType.IsEnum)
        {
            return Enum.Parse(targetType, value.ToString() ?? string.Empty, ignoreCase: true);
        }

        var measureText = value is double measureNumber
            ? measureNumber.ToString("R", CultureInfo.InvariantCulture)
            : value.ToString() ?? string.Empty;
        return CreateMeasureValue(targetType, measureText);
    }

    private static object CreateMeasureValue(Type type, string rawValue)
    {
        var text = UnwrapStepValue(rawValue);
        if (type.Name.Contains("Boolean", StringComparison.OrdinalIgnoreCase)
            || type.Name.Contains("Logical", StringComparison.OrdinalIgnoreCase))
        {
            return Activator.CreateInstance(type, ParseBoolean(text))!;
        }

        if (type.Name.Contains("Integer", StringComparison.OrdinalIgnoreCase)
            && int.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out var integer))
        {
            return Activator.CreateInstance(type, integer)!;
        }

        if ((type.Name.Contains("Real", StringComparison.OrdinalIgnoreCase)
                || type.Name.Contains("Measure", StringComparison.OrdinalIgnoreCase)
                || type.Name.Contains("Length", StringComparison.OrdinalIgnoreCase)
                || type.Name.Contains("Area", StringComparison.OrdinalIgnoreCase)
                || type.Name.Contains("Volume", StringComparison.OrdinalIgnoreCase)
                || type.Name.Contains("Count", StringComparison.OrdinalIgnoreCase))
            && double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var number))
        {
            return Activator.CreateInstance(type, number)!;
        }

        return Activator.CreateInstance(type, text)!;
    }

    private static bool AddToCollection(object? collection, object value)
    {
        if (collection is null)
        {
            return false;
        }

        var add = collection.GetType().GetMethod("Add", [value.GetType()])
            ?? collection.GetType().GetMethods().FirstOrDefault(method => method.Name == "Add" && method.GetParameters().Length == 1);
        if (add is null)
        {
            return false;
        }

        add.Invoke(collection, [value]);
        return true;
    }

    private static bool RemoveFromCollection(object? collection, object value)
    {
        if (collection is null)
        {
            return false;
        }

        var remove = collection.GetType().GetMethod("Remove", [value.GetType()])
            ?? collection.GetType().GetMethods().FirstOrDefault(method => method.Name == "Remove" && method.GetParameters().Length == 1);
        if (remove is null)
        {
            return false;
        }

        remove.Invoke(collection, [value]);
        return true;
    }

    private static void ReplaceFirstAvailableCollection(object entity, IReadOnlyList<string> propertyNames, IReadOnlyList<object> values)
    {
        foreach (var propertyName in propertyNames)
        {
            var collection = GetPropertyValue(entity, propertyName);
            if (collection is null)
            {
                continue;
            }

            ClearCollection(collection);
            foreach (var value in values)
            {
                AddToCollection(collection, value);
            }

            return;
        }
    }

    private static void ApplyEndpointMap(
        object relation,
        RelationshipEndpointProperties map,
        IReadOnlyList<object> sources,
        IReadOnlyList<object> targets)
    {
        if (map.SourceCollection is not null)
        {
            ReplaceCollection(relation, map.SourceCollection, sources);
        }
        else if (map.SourceProperty is not null && sources.FirstOrDefault() is { } source)
        {
            SetPropertyIfPresent(relation, map.SourceProperty, source);
        }

        if (map.TargetCollection is not null)
        {
            ReplaceCollection(relation, map.TargetCollection, targets);
        }
        else if (map.TargetProperty is not null && targets.FirstOrDefault() is { } target)
        {
            SetPropertyIfPresent(relation, map.TargetProperty, target);
        }
    }

    private static void ReplaceCollection(object entity, string propertyName, IReadOnlyList<object> values)
    {
        var collection = GetPropertyValue(entity, propertyName);
        if (collection is null)
        {
            return;
        }

        ClearCollection(collection);
        foreach (var value in values)
        {
            AddToCollection(collection, value);
        }
    }

    private static RelationshipEndpointProperties? GetEndpointPropertyMap(string relationshipType)
    {
        return relationshipType switch
        {
            "IFCRELAGGREGATES" or "IFCRELNESTS" => new("RelatingObject", null, null, "RelatedObjects"),
            "IFCRELCONTAINEDINSPATIALSTRUCTURE" or "IFCRELREFERENCEDINSPATIALSTRUCTURE" => new("RelatingStructure", null, null, "RelatedElements"),
            "IFCRELDEFINESBYPROPERTIES" => new("RelatingPropertyDefinition", null, null, "RelatedObjects"),
            "IFCRELDEFINESBYTYPE" => new("RelatingType", null, null, "RelatedObjects"),
            "IFCRELASSOCIATESMATERIAL" => new("RelatingMaterial", null, null, "RelatedObjects"),
            "IFCRELASSOCIATESCLASSIFICATION" => new("RelatingClassification", null, null, "RelatedObjects"),
            "IFCRELASSOCIATESDOCUMENT" => new("RelatingDocument", null, null, "RelatedObjects"),
            "IFCRELASSOCIATESLIBRARY" => new("RelatingLibrary", null, null, "RelatedObjects"),
            "IFCRELASSIGNSTOGROUP" => new("RelatingGroup", null, null, "RelatedObjects"),
            "IFCRELASSIGNSTOPROCESS" => new("RelatingProcess", null, null, "RelatedObjects"),
            "IFCRELASSIGNSTOCONTROL" => new("RelatingControl", null, null, "RelatedObjects"),
            "IFCRELASSIGNSTOPRODUCT" => new("RelatingProduct", null, null, "RelatedObjects"),
            "IFCRELVOIDSELEMENT" => new("RelatingBuildingElement", null, "RelatedOpeningElement", null),
            "IFCRELFILLSELEMENT" => new("RelatingOpeningElement", null, "RelatedBuildingElement", null),
            "IFCRELCONNECTSELEMENTS" => new("RelatingElement", null, "RelatedElement", null),
            "IFCRELCONNECTSPORTS" => new("RelatingPort", null, "RelatedPort", null),
            "IFCRELCONNECTSPORTTOELEMENT" => new("RelatingPort", null, "RelatedElement", null),
            "IFCRELINTERFERESELEMENTS" => new("RelatingElement", null, "RelatedElement", null),
            "IFCRELPROJECTSELEMENT" => new("RelatingElement", null, "RelatedFeatureElement", null),
            _ => null,
        };
    }

    private static string ToIfcType(IPersistEntity instance)
    {
        var typeName = instance.GetType().Name;
        return typeName.StartsWith("Ifc", StringComparison.OrdinalIgnoreCase)
            ? $"IFC{typeName[3..].ToUpperInvariant()}"
            : typeName.ToUpperInvariant();
    }

    private static void ClearCollection(object collection)
    {
        var clear = collection.GetType().GetMethod("Clear", Type.EmptyTypes);
        if (clear is not null)
        {
            clear.Invoke(collection, []);
            return;
        }

        foreach (var value in AsEnumerable(collection).ToList())
        {
            RemoveFromCollection(collection, value);
        }
    }

    private static IEnumerable<object> AsEnumerable(object? collection)
    {
        return collection is IEnumerable enumerable
            ? enumerable.Cast<object>()
            : [];
    }

    private static void SetCoordinateList(object? coordinates, params double[] values)
    {
        if (coordinates is null)
        {
            return;
        }

        coordinates.GetType().GetMethod("Clear", Type.EmptyTypes)?.Invoke(coordinates, []);
        foreach (var value in values)
        {
            var add = coordinates.GetType().GetMethod("Add", [typeof(double)])
                ?? coordinates.GetType().GetMethods().FirstOrDefault(method => method.Name == "Add" && method.GetParameters().Length == 1);
            if (add is null)
            {
                continue;
            }

            var parameterType = add.GetParameters()[0].ParameterType;
            add.Invoke(coordinates, [ConvertForProperty(parameterType, value)]);
        }
    }

    private static string ReadName(object entity, string fallback)
    {
        return GetPropertyValue(entity, "Name")?.ToString() ?? fallback;
    }

    private static IEnumerable<int> ReadIds(string text)
    {
        foreach (var match in System.Text.RegularExpressions.Regex.Matches(text, @"#?(?<id>\d+)").Cast<System.Text.RegularExpressions.Match>())
        {
            if (int.TryParse(match.Groups["id"].Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var id))
            {
                yield return id;
            }
        }
    }

    private static IEnumerable<int> ReadHashIds(string text)
    {
        foreach (var match in System.Text.RegularExpressions.Regex.Matches(text, @"#(?<id>\d+)").Cast<System.Text.RegularExpressions.Match>())
        {
            if (int.TryParse(match.Groups["id"].Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var id))
            {
                yield return id;
            }
        }
    }

    private static IfcRelationship? FindContainment(IfcDocument document, int childId)
    {
        return document.RelationshipsByEntity.TryGetValue(childId, out var relationships)
            ? relationships.FirstOrDefault(relationship =>
                relationship.Type.Equals("IFCRELCONTAINEDINSPATIALSTRUCTURE", StringComparison.OrdinalIgnoreCase)
                && relationship.TargetIds.Contains(childId))
            : null;
    }

    private static string NormalizeIfcType(string text, string fallback)
    {
        var value = string.IsNullOrWhiteSpace(text) ? fallback : text.Trim();
        return value.StartsWith("IFC", StringComparison.OrdinalIgnoreCase)
            ? value.ToUpperInvariant()
            : $"IFC{value.ToUpperInvariant()}";
    }

    private static string ToPascalIfcName(string ifcType)
    {
        var stem = NormalizeIfcType(ifcType, "IFCBUILDINGELEMENTPROXY")[3..].ToLowerInvariant();
        return "Ifc" + string.Concat(stem.Split('_', StringSplitOptions.RemoveEmptyEntries)
            .Select(part => CultureInfo.InvariantCulture.TextInfo.ToTitleCase(part)));
    }

    private static string UnwrapStepValue(string value)
    {
        var text = value.Trim();
        var wrapped = System.Text.RegularExpressions.Regex.Match(text, @"^[A-Z0-9_]+\((?<inner>.*)\)$", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        if (wrapped.Success)
        {
            text = wrapped.Groups["inner"].Value.Trim();
        }

        if (text.Length >= 2 && text[0] == '\'' && text[^1] == '\'')
        {
            text = text[1..^1].Replace("''", "'", StringComparison.Ordinal);
        }

        return text.Trim('.');
    }

    private static bool ParseBoolean(string value)
    {
        var text = value.Trim().Trim('.');
        return text.Equals("true", StringComparison.OrdinalIgnoreCase)
            || text.Equals("t", StringComparison.OrdinalIgnoreCase)
            || text.Equals("1", StringComparison.OrdinalIgnoreCase);
    }

    private static double ParseDouble(string value, double fallback)
    {
        var text = UnwrapStepValue(value);
        return double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : fallback;
    }
}
