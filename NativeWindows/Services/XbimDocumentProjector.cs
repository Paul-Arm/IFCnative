using System.Collections;
using System.Globalization;
using System.Reflection;
using IFCnative.NativeWindows.Models;
using Xbim.Common;
using Xbim.Ifc;

namespace IFCnative.NativeWindows.Services;

public static class XbimDocumentProjector
{
    private static readonly Lock CacheLock = new();
    private static readonly Dictionary<(Type Type, string PropertyName), PropertyInfo?> PropertyCache = [];
    private static readonly Dictionary<Type, string> IfcTypeCache = [];

    public static IfcDocument Project(IfcStore store, string fileName)
    {
        var document = new IfcDocument
        {
            FileName = fileName,
            HeaderText = $"HEADER;/* xBIM {store.SchemaVersion} projection */ENDSEC;",
            Schema = FormatSchema(store),
        };

        var instances = store.Instances
            .OfType<IPersistEntity>()
            .Where(instance => instance.EntityLabel > 0)
            .OrderBy(instance => instance.EntityLabel)
            .ToList();
        var instancesById = instances.ToDictionary(instance => instance.EntityLabel);

        foreach (var instance in instances)
        {
            AddEntity(document, CreateEntity(instance));
        }

        BuildRelationshipIndex(document, instances);
        BuildIncomingReferences(document);
        BuildPropertyAndResourceIndexes(document, instancesById);
        BuildPlacementIndex(document, instances);
        BuildRepresentationIndex(document, instances);
        BuildSpatialTree(document);
        ValidateDocument(document);

        document.Diagnostics.Info($"Projected {document.Entities.Count:N0} xBIM entities.");
        document.Diagnostics.Info($"Indexed {document.RelationshipById.Count:N0} IFC relationships from xBIM.");
        document.Diagnostics.Info($"Indexed {document.PropertySetById.Count:N0} property/quantity sets from xBIM.");
        document.Diagnostics.Info($"Indexed {document.PlacementsByEntity.Count:N0} product placements from xBIM.");
        document.Diagnostics.Info($"Indexed {document.RepresentationsByEntity.Count:N0} product representations from xBIM.");
        document.Diagnostics.Info($"Detected schema: {document.Schema}.");

        return document;
    }

    private static IfcEntity CreateEntity(IPersistEntity instance)
    {
        var entity = new IfcEntity
        {
            Id = instance.EntityLabel,
            Type = ToIfcType(instance),
        };

        entity.Arguments.Add(ToStepString(GetPropertyValue(instance, "GlobalId")));
        entity.Arguments.Add("$");
        entity.Arguments.Add(ToStepString(GetPropertyValue(instance, "Name")));
        entity.Arguments.Add(ToStepString(GetPropertyValue(instance, "Description")));
        entity.OriginalArguments.AddRange(entity.Arguments);
        return entity;
    }

    private static void AddEntity(IfcDocument document, IfcEntity entity)
    {
        if (document.EntityById.ContainsKey(entity.Id))
        {
            document.Diagnostics.Warn($"Skipped duplicate xBIM entity label #{entity.Id}; keeping first projected entity.");
            return;
        }

        document.Entities.Add(entity);
        document.EntityById[entity.Id] = entity;

        if (!document.EntitiesByType.TryGetValue(entity.Type, out var bucket))
        {
            bucket = [];
            document.EntitiesByType[entity.Type] = bucket;
        }

        bucket.Add(entity);
    }

    private static void BuildIncomingReferences(IfcDocument document)
    {
        foreach (var relationship in document.RelationshipById.Values)
        {
            if (!document.EntityById.TryGetValue(relationship.Id, out var source))
            {
                continue;
            }

            foreach (var targetId in relationship.SourceIds.Concat(relationship.TargetIds).Where(id => id != source.Id).Distinct())
            {
                if (!document.EntityById.ContainsKey(targetId))
                {
                    continue;
                }

                if (!document.IncomingReferences.TryGetValue(targetId, out var incoming))
                {
                    incoming = [];
                    document.IncomingReferences[targetId] = incoming;
                }

                incoming.Add(source);
            }
        }
    }

    private static void BuildRelationshipIndex(IfcDocument document, IReadOnlyList<IPersistEntity> instances)
    {
        foreach (var instance in instances.Where(instance => ToIfcType(instance).StartsWith("IFCREL", StringComparison.OrdinalIgnoreCase)))
        {
            var relationship = CreateRelationship(instance);
            document.RelationshipById[relationship.Id] = relationship;

            foreach (var entityId in relationship.SourceIds.Concat(relationship.TargetIds).Distinct())
            {
                if (!document.RelationshipsByEntity.TryGetValue(entityId, out var bucket))
                {
                    bucket = [];
                    document.RelationshipsByEntity[entityId] = bucket;
                }

                bucket.Add(relationship);
            }
        }
    }

    private static IfcRelationship CreateRelationship(IPersistEntity instance)
    {
        var type = ToIfcType(instance);
        var relationship = new IfcRelationship { Id = instance.EntityLabel, Type = type };

        switch (type)
        {
            case "IFCRELAGGREGATES":
            case "IFCRELNESTS":
                relationship.SourceIds.AddRange(ReadReferenceIds(instance, "RelatingObject"));
                relationship.TargetIds.AddRange(ReadReferenceIds(instance, "RelatedObjects"));
                break;
            case "IFCRELCONTAINEDINSPATIALSTRUCTURE":
            case "IFCRELREFERENCEDINSPATIALSTRUCTURE":
                relationship.SourceIds.AddRange(ReadReferenceIds(instance, "RelatingStructure"));
                relationship.TargetIds.AddRange(ReadReferenceIds(instance, "RelatedElements"));
                break;
            case "IFCRELDEFINESBYPROPERTIES":
                relationship.SourceIds.AddRange(ReadReferenceIds(instance, "RelatingPropertyDefinition"));
                relationship.TargetIds.AddRange(ReadReferenceIds(instance, "RelatedObjects"));
                break;
            case "IFCRELDEFINESBYTYPE":
                relationship.SourceIds.AddRange(ReadReferenceIds(instance, "RelatingType"));
                relationship.TargetIds.AddRange(ReadReferenceIds(instance, "RelatedObjects"));
                break;
            case "IFCRELASSOCIATESMATERIAL":
                relationship.SourceIds.AddRange(ReadReferenceIds(instance, "RelatingMaterial"));
                relationship.TargetIds.AddRange(ReadReferenceIds(instance, "RelatedObjects"));
                break;
            case "IFCRELASSOCIATESCLASSIFICATION":
                relationship.SourceIds.AddRange(ReadReferenceIds(instance, "RelatingClassification"));
                relationship.TargetIds.AddRange(ReadReferenceIds(instance, "RelatedObjects"));
                break;
            case "IFCRELASSOCIATESDOCUMENT":
                relationship.SourceIds.AddRange(ReadReferenceIds(instance, "RelatingDocument"));
                relationship.TargetIds.AddRange(ReadReferenceIds(instance, "RelatedObjects"));
                break;
            case "IFCRELASSOCIATESLIBRARY":
                relationship.SourceIds.AddRange(ReadReferenceIds(instance, "RelatingLibrary"));
                relationship.TargetIds.AddRange(ReadReferenceIds(instance, "RelatedObjects"));
                break;
            case "IFCRELASSIGNSTOGROUP":
                relationship.SourceIds.AddRange(ReadReferenceIds(instance, "RelatingGroup"));
                relationship.TargetIds.AddRange(ReadReferenceIds(instance, "RelatedObjects"));
                break;
            case "IFCRELASSIGNSTOPROCESS":
                relationship.SourceIds.AddRange(ReadReferenceIds(instance, "RelatingProcess"));
                relationship.TargetIds.AddRange(ReadReferenceIds(instance, "RelatedObjects"));
                break;
            case "IFCRELASSIGNSTOCONTROL":
                relationship.SourceIds.AddRange(ReadReferenceIds(instance, "RelatingControl"));
                relationship.TargetIds.AddRange(ReadReferenceIds(instance, "RelatedObjects"));
                break;
            case "IFCRELASSIGNSTOPRODUCT":
                relationship.SourceIds.AddRange(ReadReferenceIds(instance, "RelatingProduct"));
                relationship.TargetIds.AddRange(ReadReferenceIds(instance, "RelatedObjects"));
                break;
            case "IFCRELVOIDSELEMENT":
                relationship.SourceIds.AddRange(ReadReferenceIds(instance, "RelatingBuildingElement"));
                relationship.TargetIds.AddRange(ReadReferenceIds(instance, "RelatedOpeningElement"));
                break;
            case "IFCRELFILLSELEMENT":
                relationship.SourceIds.AddRange(ReadReferenceIds(instance, "RelatingOpeningElement"));
                relationship.TargetIds.AddRange(ReadReferenceIds(instance, "RelatedBuildingElement"));
                break;
            case "IFCRELCONNECTSELEMENTS":
                relationship.SourceIds.AddRange(ReadReferenceIds(instance, "RelatingElement"));
                relationship.TargetIds.AddRange(ReadReferenceIds(instance, "RelatedElement"));
                break;
            case "IFCRELCONNECTSPORTS":
                relationship.SourceIds.AddRange(ReadReferenceIds(instance, "RelatingPort"));
                relationship.TargetIds.AddRange(ReadReferenceIds(instance, "RelatedPort"));
                break;
            case "IFCRELCONNECTSPORTTOELEMENT":
                relationship.SourceIds.AddRange(ReadReferenceIds(instance, "RelatingPort"));
                relationship.TargetIds.AddRange(ReadReferenceIds(instance, "RelatedElement"));
                break;
            case "IFCRELINTERFERESELEMENTS":
                relationship.SourceIds.AddRange(ReadReferenceIds(instance, "RelatingElement"));
                relationship.TargetIds.AddRange(ReadReferenceIds(instance, "RelatedElement"));
                break;
            case "IFCRELPROJECTSELEMENT":
                relationship.SourceIds.AddRange(ReadReferenceIds(instance, "RelatingElement"));
                relationship.TargetIds.AddRange(ReadReferenceIds(instance, "RelatedFeatureElement"));
                break;
        }

        ReplaceWithDistinctIds(relationship.SourceIds);
        ReplaceWithDistinctIds(relationship.TargetIds);
        return relationship;
    }

    private static void BuildPropertyAndResourceIndexes(IfcDocument document, IReadOnlyDictionary<int, IPersistEntity> instancesById)
    {
        foreach (var instance in instancesById.Values.Where(instance => ToIfcType(instance) is "IFCPROPERTYSET" or "IFCELEMENTQUANTITY"))
        {
            var propertySet = CreatePropertySet(instance);
            document.PropertySetById[propertySet.Id] = propertySet;
        }

        foreach (var relationship in document.RelationshipById.Values)
        {
            switch (relationship.Type)
            {
                case "IFCRELDEFINESBYPROPERTIES":
                    foreach (var setId in relationship.SourceIds)
                    {
                        if (!document.PropertySetById.TryGetValue(setId, out var propertySet))
                        {
                            continue;
                        }

                        foreach (var objectId in relationship.TargetIds)
                        {
                            AddToIndex(document.PropertySetsByEntity, objectId, propertySet);
                        }
                    }
                    break;
                case "IFCRELDEFINESBYTYPE":
                    foreach (var typeId in relationship.SourceIds)
                    {
                        if (!document.EntityById.TryGetValue(typeId, out var typeEntity))
                        {
                            continue;
                        }

                        var assignment = new IfcTypeAssignment
                        {
                            RelationshipId = relationship.Id,
                            TypeId = typeEntity.Id,
                            TypeClass = typeEntity.Type,
                            TypeName = ReadEntityLabel(typeEntity),
                        };
                        assignment.ObjectIds.AddRange(relationship.TargetIds);

                        foreach (var objectId in relationship.TargetIds)
                        {
                            AddToIndex(document.TypeAssignmentsByEntity, objectId, assignment);
                        }
                    }
                    break;
                case "IFCRELASSOCIATESMATERIAL":
                case "IFCRELASSOCIATESCLASSIFICATION":
                case "IFCRELASSOCIATESDOCUMENT":
                case "IFCRELASSOCIATESLIBRARY":
                    foreach (var resourceId in relationship.SourceIds)
                    {
                        if (!document.EntityById.TryGetValue(resourceId, out var resource))
                        {
                            continue;
                        }

                        var label = $"#{resource.Id} {resource.TypeName()} {ReadEntityLabel(resource)}".Trim();
                        foreach (var objectId in relationship.TargetIds)
                        {
                            AddToIndex(document.ResourcesByEntity, objectId, label);
                        }
                    }
                    break;
            }
        }

        foreach (var unitAssignment in instancesById.Values.Where(instance => ToIfcType(instance) == "IFCUNITASSIGNMENT"))
        {
            foreach (var unitId in ReadReferenceIds(unitAssignment, "Units"))
            {
                if (document.EntityById.TryGetValue(unitId, out var unit))
                {
                    document.Units.Add($"#{unit.Id} {unit.Type}: {ReadEntityLabel(unit)}");
                }
            }
        }
    }

    private static IfcPropertySet CreatePropertySet(IPersistEntity instance)
    {
        var type = ToIfcType(instance);
        var propertySet = new IfcPropertySet
        {
            Id = instance.EntityLabel,
            Kind = type == "IFCELEMENTQUANTITY" ? "Qto" : "Pset",
            Name = ReadDisplayText(GetPropertyValue(instance, "Name"), $"#{instance.EntityLabel}"),
        };

        var valueProperty = type == "IFCELEMENTQUANTITY" ? "Quantities" : "HasProperties";
        foreach (var value in EnumeratePersistEntities(GetPropertyValue(instance, valueProperty)).OrderBy(value => value.EntityLabel))
        {
            propertySet.Values.Add(CreatePropertyValue(value));
        }

        return propertySet;
    }

    private static IfcPropertyValue CreatePropertyValue(IPersistEntity instance)
    {
        var type = ToIfcType(instance);
        return new IfcPropertyValue
        {
            Id = instance.EntityLabel,
            Type = type,
            Name = ReadDisplayText(GetPropertyValue(instance, "Name"), $"#{instance.EntityLabel}"),
            Value = ReadPropertyDisplayValue(instance, type),
        };
    }

    private static string ReadPropertyDisplayValue(IPersistEntity instance, string type)
    {
        var value = type switch
        {
            "IFCPROPERTYSINGLEVALUE" => GetPropertyValue(instance, "NominalValue"),
            "IFCQUANTITYLENGTH" => GetPropertyValue(instance, "LengthValue"),
            "IFCQUANTITYAREA" => GetPropertyValue(instance, "AreaValue"),
            "IFCQUANTITYVOLUME" => GetPropertyValue(instance, "VolumeValue"),
            "IFCQUANTITYCOUNT" => GetPropertyValue(instance, "CountValue"),
            "IFCQUANTITYWEIGHT" => GetPropertyValue(instance, "WeightValue"),
            "IFCQUANTITYTIME" => GetPropertyValue(instance, "TimeValue"),
            _ => null,
        };

        return ReadDisplayText(value, string.Empty);
    }

    private static void BuildPlacementIndex(IfcDocument document, IReadOnlyList<IPersistEntity> instances)
    {
        foreach (var product in instances)
        {
            var placement = GetPropertyValue(product, "ObjectPlacement") as IPersistEntity;
            var relativePlacement = GetPropertyValue(placement, "RelativePlacement") as IPersistEntity;
            var point = GetPropertyValue(relativePlacement, "Location") as IPersistEntity;
            var coordinates = ReadNumberList(GetPropertyValue(point, "Coordinates"));
            if (placement is null || relativePlacement is null || point is null || coordinates.Count < 3)
            {
                continue;
            }

            var relativeTo = GetPropertyValue(placement, "PlacementRelTo") as IPersistEntity;
            document.PlacementsByEntity[product.EntityLabel] = new IfcPlacementSummary
            {
                ProductId = product.EntityLabel,
                PlacementId = placement.EntityLabel,
                RelativeToId = relativeTo?.EntityLabel,
                AxisPlacementId = relativePlacement.EntityLabel,
                PointId = point.EntityLabel,
                X = coordinates[0],
                Y = coordinates[1],
                Z = coordinates[2],
            };
        }
    }

    private static void BuildRepresentationIndex(IfcDocument document, IReadOnlyList<IPersistEntity> instances)
    {
        foreach (var product in instances)
        {
            var definitionShape = GetPropertyValue(product, "Representation") as IPersistEntity;
            if (definitionShape is null)
            {
                continue;
            }

            var summary = new IfcRepresentationSummary
            {
                ProductId = product.EntityLabel,
                ProductDefinitionShapeId = definitionShape.EntityLabel,
            };

            foreach (var shape in EnumeratePersistEntities(GetPropertyValue(definitionShape, "Representations")).OrderBy(shape => shape.EntityLabel))
            {
                summary.ShapeRepresentationIds.Add(shape.EntityLabel);
                summary.GeometryItemIds.AddRange(EnumeratePersistEntities(GetPropertyValue(shape, "Items")).Select(item => item.EntityLabel));
            }

            document.RepresentationsByEntity[product.EntityLabel] = summary;
        }
    }

    private static void BuildSpatialTree(IfcDocument document)
    {
        var childrenByParent = new Dictionary<int, List<(int ChildId, string Relation)>>();
        var childIds = new HashSet<int>();

        foreach (var relationship in document.RelationshipById.Values.Where(relationship => relationship.Type == "IFCRELAGGREGATES"))
        {
            AddChildren(childrenByParent, childIds, relationship.SourceIds.FirstOrDefault(), relationship.TargetIds, "aggregate");
        }

        foreach (var relationship in document.RelationshipById.Values.Where(relationship => relationship.Type == "IFCRELCONTAINEDINSPATIALSTRUCTURE"))
        {
            AddChildren(childrenByParent, childIds, relationship.SourceIds.FirstOrDefault(), relationship.TargetIds, "contains");
        }

        var roots = document.Entities
            .Where(entity => entity.Type is "IFCPROJECT" or "IFCPROJECTLIBRARY" || IsSpatial(entity.Type))
            .Where(entity => !childIds.Contains(entity.Id))
            .OrderBy(entity => entity.Type == "IFCPROJECT" ? 0 : 1)
            .ThenBy(entity => entity.Id);

        foreach (var root in roots)
        {
            document.SpatialRoots.Add(BuildNode(document, root, "root", childrenByParent, [], []));
        }
    }

    private static void AddChildren(
        Dictionary<int, List<(int ChildId, string Relation)>> childrenByParent,
        HashSet<int> childIds,
        int parent,
        IEnumerable<int> children,
        string relation)
    {
        if (parent == 0)
        {
            return;
        }

        if (!childrenByParent.TryGetValue(parent, out var bucket))
        {
            bucket = [];
            childrenByParent[parent] = bucket;
        }

        foreach (var child in children)
        {
            bucket.Add((child, relation));
            childIds.Add(child);
        }
    }

    private static IfcTreeNode BuildNode(
        IfcDocument document,
        IfcEntity entity,
        string relation,
        Dictionary<int, List<(int ChildId, string Relation)>> childrenByParent,
        HashSet<int> path,
        IReadOnlyList<string> parentLabels)
    {
        var node = new IfcTreeNode(entity, relation);
        var currentLabels = parentLabels.Concat([$"{entity.DisplayName} ({entity.TypeName()})"]).ToList();
        document.SpatialPathByEntity[entity.Id] = string.Join(" / ", currentLabels);

        if (!path.Add(entity.Id))
        {
            return node;
        }

        if (childrenByParent.TryGetValue(entity.Id, out var children))
        {
            foreach (var child in children.OrderBy(child => child.ChildId))
            {
                if (document.EntityById.TryGetValue(child.ChildId, out var childEntity))
                {
                    node.Children.Add(BuildNode(document, childEntity, child.Relation, childrenByParent, path, currentLabels));
                }
            }
        }

        path.Remove(entity.Id);
        return node;
    }

    private static void ValidateDocument(IfcDocument document)
    {
        foreach (var relationship in document.RelationshipById.Values)
        {
            foreach (var id in relationship.SourceIds.Concat(relationship.TargetIds).Distinct())
            {
                if (!document.EntityById.ContainsKey(id))
                {
                    document.Diagnostics.Warn($"Relationship #{relationship.Id} {relationship.Type} references missing entity #{id}.");
                }
            }
        }

        var duplicateGlobalIds = document.Entities
            .Where(entity => !string.IsNullOrWhiteSpace(entity.GlobalId))
            .GroupBy(entity => entity.GlobalId, StringComparer.Ordinal)
            .Where(group => group.Count() > 1);

        foreach (var duplicate in duplicateGlobalIds)
        {
            document.Diagnostics.Warn($"Duplicate GlobalId {duplicate.Key}: {string.Join(", ", duplicate.Select(entity => $"#{entity.Id}"))}.");
        }

        foreach (var entity in document.Entities.Where(entity => IsRootedEntity(entity.Type) && string.IsNullOrWhiteSpace(entity.GlobalId)))
        {
            document.Diagnostics.Warn($"#{entity.Id} {entity.Type} has no GlobalId.");
        }

        foreach (var product in document.Entities.Where(entity => IsPhysicalProduct(entity.Type)))
        {
            if (!document.PlacementsByEntity.ContainsKey(product.Id))
            {
                document.Diagnostics.Warn($"#{product.Id} {product.Type} has no ObjectPlacement.");
            }

            if (!document.RepresentationsByEntity.ContainsKey(product.Id))
            {
                document.Diagnostics.Warn($"#{product.Id} {product.Type} has no Representation.");
            }
        }

        var primaryContainersByProduct = document.RelationshipById.Values
            .Where(relationship => relationship.Type == "IFCRELCONTAINEDINSPATIALSTRUCTURE")
            .SelectMany(relationship => relationship.TargetIds.Select(targetId => new { TargetId = targetId, RelationshipId = relationship.Id }))
            .GroupBy(item => item.TargetId)
            .Where(group => group.Count() > 1);

        foreach (var duplicateContainer in primaryContainersByProduct)
        {
            document.Diagnostics.Warn($"Entity #{duplicateContainer.Key} has multiple primary spatial containment relationships: {string.Join(", ", duplicateContainer.Select(item => $"#{item.RelationshipId}"))}.");
        }
    }

    private static IEnumerable<int> ReadReferenceIds(IPersistEntity entity, params string[] propertyNames)
    {
        foreach (var propertyName in propertyNames)
        {
            foreach (var id in ReadReferenceIds(GetPropertyValue(entity, propertyName)))
            {
                yield return id;
            }
        }
    }

    private static IEnumerable<int> ReadReferenceIds(object? value)
    {
        if (value is IPersistEntity entity)
        {
            yield return entity.EntityLabel;
            yield break;
        }

        if (value is string or null)
        {
            yield break;
        }

        if (value is IEnumerable enumerable)
        {
            foreach (var item in enumerable)
            {
                if (item is IPersistEntity itemEntity)
                {
                    yield return itemEntity.EntityLabel;
                }
            }
        }
    }

    private static IEnumerable<IPersistEntity> EnumeratePersistEntities(object? value)
    {
        if (value is IPersistEntity entity)
        {
            yield return entity;
            yield break;
        }

        if (value is string or null)
        {
            yield break;
        }

        if (value is IEnumerable enumerable)
        {
            foreach (var item in enumerable)
            {
                if (item is IPersistEntity itemEntity)
                {
                    yield return itemEntity;
                }
            }
        }
    }

    private static object? GetPropertyValue(object? entity, string propertyName)
    {
        if (entity is null)
        {
            return null;
        }

        try
        {
            return FindProperty(entity.GetType(), propertyName)?.GetValue(entity);
        }
        catch
        {
            return null;
        }
    }

    private static PropertyInfo? FindProperty(Type type, string propertyName)
    {
        var key = (type, propertyName);
        lock (CacheLock)
        {
            if (PropertyCache.TryGetValue(key, out var cached))
            {
                return cached;
            }
        }

        var property = type.GetProperty(propertyName)
            ?? type.GetProperties(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)
                .FirstOrDefault(candidate => candidate.GetIndexParameters().Length == 0
                    && candidate.Name.EndsWith($".{propertyName}", StringComparison.Ordinal));
        lock (CacheLock)
        {
            PropertyCache[key] = property;
        }

        return property;
    }

    private static List<double> ReadNumberList(object? value)
    {
        if (value is not IEnumerable enumerable || value is string)
        {
            return [];
        }

        return enumerable
            .Cast<object>()
            .Select(item => ReadDisplayText(item, string.Empty))
            .Select(ParseProjectedDouble)
            .Where(number => !double.IsNaN(number))
            .ToList();
    }

    private static double ParseProjectedDouble(string text)
    {
        var normalized = text.Trim();
        if (normalized.Contains(',', StringComparison.Ordinal) && !normalized.Contains('.', StringComparison.Ordinal)
            && double.TryParse(normalized.Replace(',', '.'), NumberStyles.Float, CultureInfo.InvariantCulture, out var decimalCommaNumber))
        {
            return decimalCommaNumber;
        }

        if (double.TryParse(normalized, NumberStyles.Float, CultureInfo.InvariantCulture, out var invariantNumber))
        {
            return invariantNumber;
        }

        return double.TryParse(normalized, NumberStyles.Float, CultureInfo.CurrentCulture, out var fallbackNumber)
            ? fallbackNumber
            : double.NaN;
    }

    private static void ReplaceWithDistinctIds(List<int> target)
    {
        var distinct = target.Where(id => id > 0).Distinct().OrderBy(id => id).ToList();
        target.Clear();
        target.AddRange(distinct);
    }

    private static void AddToIndex<T>(Dictionary<int, List<T>> index, int entityId, T value)
    {
        if (!index.TryGetValue(entityId, out var bucket))
        {
            bucket = [];
            index[entityId] = bucket;
        }

        bucket.Add(value);
    }

    private static string ToIfcType(IPersistEntity instance)
    {
        var type = instance.GetType();
        lock (CacheLock)
        {
            if (IfcTypeCache.TryGetValue(type, out var cached))
            {
                return cached;
            }
        }

        var typeName = type.Name;
        if (typeName.Contains('`', StringComparison.Ordinal))
        {
            typeName = typeName[..typeName.IndexOf('`', StringComparison.Ordinal)];
        }

        var ifcType = typeName.StartsWith("Ifc", StringComparison.OrdinalIgnoreCase)
            ? $"IFC{typeName[3..].ToUpperInvariant()}"
            : typeName.ToUpperInvariant();
        lock (CacheLock)
        {
            IfcTypeCache[type] = ifcType;
        }

        return ifcType;
    }

    private static string ReadEntityLabel(IfcEntity entity)
    {
        return string.IsNullOrWhiteSpace(entity.Name) ? entity.DisplayName : entity.Name;
    }

    private static string ReadDisplayText(object? value, string fallback)
    {
        if (value is null)
        {
            return fallback;
        }

        value = UnwrapSimpleValue(value);
        if (value is null)
        {
            return fallback;
        }

        if (value is IPersistEntity entity)
        {
            return $"#{entity.EntityLabel} {ToIfcType(entity)}";
        }

        if (value is string text)
        {
            return string.IsNullOrWhiteSpace(text) ? fallback : text;
        }

        if (value is IEnumerable enumerable && value is not string)
        {
            var values = enumerable.Cast<object>().Select(item => ReadDisplayText(item, string.Empty)).Where(text => !string.IsNullOrWhiteSpace(text)).ToList();
            return values.Count == 0 ? fallback : string.Join(", ", values);
        }

        var display = value.ToString();
        return string.IsNullOrWhiteSpace(display) ? fallback : display.Trim();
    }

    private static object? UnwrapSimpleValue(object value)
    {
        var current = value;
        for (var index = 0; index < 6; index++)
        {
            if (current is string or IPersistEntity || current is IEnumerable)
            {
                return current;
            }

            var property = current.GetType().GetProperty("Value")
                ?? current.GetType().GetProperty("ValueItem");
            if (property is null || property.GetIndexParameters().Length > 0)
            {
                return current;
            }

            var next = property.GetValue(current);
            if (next is null || ReferenceEquals(next, current))
            {
                return next;
            }

            current = next;
        }

        return current;
    }

    private static string ToStepString(object? value)
    {
        var text = ReadDisplayText(value, string.Empty);
        return string.IsNullOrWhiteSpace(text) ? "$" : StepArgumentReader.Quote(text);
    }

    private static string FormatSchema(IfcStore store)
    {
        return store.SchemaVersion.ToString().ToUpperInvariant();
    }

    private static bool IsSpatial(string type)
    {
        return type is "IFCSITE" or "IFCBUILDING" or "IFCBUILDINGSTOREY" or "IFCSPACE" or "IFCFACILITY"
            or "IFCFACILITYPART" or "IFCROAD" or "IFCRAILWAY" or "IFCBRIDGE";
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
