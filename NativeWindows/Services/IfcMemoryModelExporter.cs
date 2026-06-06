using System.Globalization;
using IFCnative.NativeWindows.Models;

namespace IFCnative.NativeWindows.Services;

public static class IfcMemoryModelExporter
{
    private sealed record RelationshipEndpointMap(int SourceArgumentIndex, int TargetArgumentIndex, bool SourceIsList, bool TargetIsList);

    public static IfcDocument ApplyToDocument(IfcDocument importedDocument, IfcMemoryModel model)
    {
        var exported = CloneDocument(importedDocument);
        ApplyObjects(exported, model);
        ApplyResources(exported, model);
        ApplyRelationships(exported, model);
        ApplyProperties(exported, model);
        ApplyPlacements(exported, model);
        ApplyGeometry(exported, model);
        RefreshSpatialProjection(exported, model);
        RefreshMutableDiagnostics(exported);
        exported.MemoryModel = model;
        return exported;
    }

    private static void ApplyObjects(IfcDocument document, IfcMemoryModel model)
    {
        foreach (var modelObject in model.Objects)
        {
            if (model.ResourceBySourceId.ContainsKey(modelObject.SourceId))
            {
                continue;
            }

            var createdEntity = false;
            if (!document.EntityById.TryGetValue(modelObject.SourceId, out var entity))
            {
                if (!ShouldMaterializeObject(modelObject))
                {
                    continue;
                }

                entity = new IfcEntity { Id = modelObject.SourceId, Type = modelObject.IfcClass };
                document.Entities.Add(entity);
                createdEntity = true;
            }

            if (modelObject.HasRawArgumentOverride)
            {
                entity.Arguments.Clear();
                entity.Arguments.AddRange(modelObject.RawArguments);
                entity.Name = modelObject.Name;
                entity.Description = modelObject.Description;
            }

            if (IsRootedEntity(modelObject.IfcClass) && !string.IsNullOrWhiteSpace(modelObject.GlobalId))
            {
                SetArgument(entity, 0, StepArgumentReader.Quote(modelObject.GlobalId));
            }

            if (createdEntity)
            {
                ApplyProductObjectEntity(entity, modelObject, model);
            }
        }
    }

    private static void ApplyResources(IfcDocument document, IfcMemoryModel model)
    {
        foreach (var resource in model.ResourceBySourceId.Values.OrderBy(resource => resource.SourceId))
        {
            if (!document.EntityById.TryGetValue(resource.SourceId, out var entity))
            {
                entity = new IfcEntity { Id = resource.SourceId, Type = resource.IfcClass };
                document.Entities.Add(entity);
            }

            ApplyResourceEntity(entity, resource);
        }

        RebuildEntityIndexes(document);
        RefreshProjectedResources(document, model);
    }

    private static void ApplyProperties(IfcDocument document, IfcMemoryModel model)
    {
        foreach (var propertySet in model.PropertySetBySourceId.Values.OrderBy(propertySet => propertySet.SourceId))
        {
            var propertySetClass = propertySet.Kind.Equals("Qto", StringComparison.OrdinalIgnoreCase)
                ? "IFCELEMENTQUANTITY"
                : "IFCPROPERTYSET";
            if (!document.EntityById.TryGetValue(propertySet.SourceId, out var propertySetEntity))
            {
                propertySetEntity = new IfcEntity { Id = propertySet.SourceId, Type = propertySetClass };
                document.Entities.Add(propertySetEntity);
            }

            if (propertySet.Kind.Equals("Qto", StringComparison.OrdinalIgnoreCase))
            {
                SetArgument(propertySetEntity, 0, MakeGeneratedGlobalId("Qto", propertySet.SourceId));
                SetArgument(propertySetEntity, 1, "$");
                SetArgument(propertySetEntity, 2, StepArgumentReader.Quote(propertySet.Name));
                SetArgument(propertySetEntity, 3, "$");
                SetArgument(propertySetEntity, 4, StepArgumentReader.Quote("Native measured quantities"));
                SetArgument(propertySetEntity, 5, FormatReferenceArgument(propertySet.Values.Select(value => value.SourceId), asList: true));
            }
            else
            {
                SetArgument(propertySetEntity, 0, MakeGeneratedGlobalId("Pset", propertySet.SourceId));
                SetArgument(propertySetEntity, 1, "$");
                SetArgument(propertySetEntity, 2, StepArgumentReader.Quote(propertySet.Name));
                SetArgument(propertySetEntity, 3, "$");
                SetArgument(propertySetEntity, 4, FormatReferenceArgument(propertySet.Values.Select(value => value.SourceId), asList: true));
            }

            foreach (var value in propertySet.Values)
            {
                if (!document.EntityById.TryGetValue(value.SourceId, out var valueEntity))
                {
                    valueEntity = new IfcEntity { Id = value.SourceId, Type = value.IfcClass };
                    document.Entities.Add(valueEntity);
                }

                if (value.IfcClass == "IFCPROPERTYSINGLEVALUE")
                {
                    SetArgument(valueEntity, 0, StepArgumentReader.Quote(value.Name));
                    SetArgument(valueEntity, 1, "$");
                    SetArgument(valueEntity, 2, FormatStepValue(value.Value));
                    SetArgument(valueEntity, 3, "$");
                }
                else
                {
                    SetArgument(valueEntity, 0, StepArgumentReader.Quote(value.Name));
                    SetArgument(valueEntity, 1, "$");
                    SetArgument(valueEntity, 2, "$");
                    SetArgument(valueEntity, 3, FormatStepValue(value.Value));
                    SetArgument(valueEntity, 4, "$");
                }
            }
        }

        var valuesById = model.PropertySetsByObjectId.Values
            .SelectMany(sets => sets)
            .SelectMany(set => set.Values)
            .GroupBy(value => value.SourceId)
            .ToDictionary(group => group.Key, group => group.First());

        foreach (var propertyValue in valuesById.Values)
        {
            if (!document.EntityById.TryGetValue(propertyValue.SourceId, out var entity))
            {
                continue;
            }

            var argumentIndex = entity.Type switch
            {
                "IFCPROPERTYSINGLEVALUE" => 2,
                "IFCQUANTITYLENGTH" or "IFCQUANTITYAREA" or "IFCQUANTITYVOLUME" or "IFCQUANTITYCOUNT" or "IFCQUANTITYWEIGHT" or "IFCQUANTITYTIME" => 3,
                _ => -1,
            };

            if (argumentIndex >= 0)
            {
                SetArgument(entity, argumentIndex, FormatStepValue(propertyValue.Value));
            }
        }

        RebuildEntityIndexes(document);
        RefreshProjectedPropertySets(document, model);
    }

    private static void ApplyRelationships(IfcDocument document, IfcMemoryModel model)
    {
        var relationIds = model.Relations.Select(relation => relation.SourceId).ToHashSet();
        document.Entities.RemoveAll(entity => entity.Type.StartsWith("IFCREL", StringComparison.OrdinalIgnoreCase) && !relationIds.Contains(entity.Id));

        foreach (var relation in model.Relations.OrderBy(relation => relation.SourceId))
        {
            if (GetRelationshipEndpointMap(relation.IfcClass) is not { } map)
            {
                continue;
            }

            if (!document.EntityById.TryGetValue(relation.SourceId, out var entity))
            {
                entity = new IfcEntity { Id = relation.SourceId, Type = relation.IfcClass };
                document.Entities.Add(entity);
            }

            SetArgument(entity, 0, MakeGeneratedGlobalId("Rel", relation.SourceId));
            SetArgument(entity, 2, string.IsNullOrWhiteSpace(relation.Name) ? "$" : StepArgumentReader.Quote(relation.Name));
            SetArgument(entity, map.SourceArgumentIndex, FormatReferenceArgument(relation.SourceObjectIds, map.SourceIsList));
            SetArgument(entity, map.TargetArgumentIndex, FormatReferenceArgument(relation.TargetObjectIds, map.TargetIsList));
        }

        RebuildEntityIndexes(document);
        RefreshProjectedRelationships(document, model);
    }

    private static void ApplyPlacements(IfcDocument document, IfcMemoryModel model)
    {
        foreach (var modelObject in model.Objects.Where(modelObject => modelObject.Placement is not null))
        {
            var placement = modelObject.Placement!;
            if (document.EntityById.TryGetValue(modelObject.SourceId, out var product))
            {
                SetArgument(product, 5, $"#{placement.SourceId}");
            }

            var placementEntity = EnsureEntity(document, placement.SourceId, "IFCLOCALPLACEMENT");
            SetArgument(placementEntity, 0, placement.RelativeToSourceId is null ? "$" : $"#{placement.RelativeToSourceId}");
            SetArgument(placementEntity, 1, placement.AxisPlacementSourceId > 0 ? $"#{placement.AxisPlacementSourceId}" : "$");

            if (placement.AxisPlacementSourceId > 0)
            {
                var axisPlacement = EnsureEntity(document, placement.AxisPlacementSourceId, "IFCAXIS2PLACEMENT3D");
                SetArgument(axisPlacement, 0, placement.PointSourceId > 0 ? $"#{placement.PointSourceId}" : "$");
                SetArgument(axisPlacement, 1, placement.AxisDirectionSourceId > 0 ? $"#{placement.AxisDirectionSourceId}" : "$");
                SetArgument(axisPlacement, 2, placement.RefDirectionSourceId > 0 ? $"#{placement.RefDirectionSourceId}" : "$");
                ApplyDirection(document, placement.AxisDirectionSourceId, placement.Axis, twoDimensional: false);
                ApplyDirection(document, placement.RefDirectionSourceId, placement.RefDirection, twoDimensional: false);
            }

            if (placement.PointSourceId > 0)
            {
                var point = EnsureEntity(document, placement.PointSourceId, "IFCCARTESIANPOINT");
                SetArgument(point, 0, $"({FormatMeasure(placement.X)},{FormatMeasure(placement.Y)},{FormatMeasure(placement.Z)})");
            }

            document.PlacementsByEntity[modelObject.SourceId] = new IfcPlacementSummary
            {
                ProductId = modelObject.SourceId,
                PlacementId = placement.SourceId,
                RelativeToId = placement.RelativeToSourceId,
                AxisPlacementId = placement.AxisPlacementSourceId,
                PointId = placement.PointSourceId,
                X = placement.X,
                Y = placement.Y,
                Z = placement.Z,
            };
        }
    }

    private static void ApplyGeometry(IfcDocument document, IfcMemoryModel model)
    {
        foreach (var geometry in model.ProductGeometryByProductId.Values)
        {
            if (document.EntityById.TryGetValue(geometry.ProductSourceId, out var product))
            {
                SetArgument(product, 6, $"#{geometry.ProductDefinitionShapeSourceId}");
            }

            var productDefinitionShape = EnsureEntity(document, geometry.ProductDefinitionShapeSourceId, "IFCPRODUCTDEFINITIONSHAPE");
            SetArgument(productDefinitionShape, 0, "$");
            SetArgument(productDefinitionShape, 1, "$");
            SetArgument(productDefinitionShape, 2, FormatReferenceArgument(geometry.ShapeRepresentations.Select(shape => shape.SourceId), asList: true));

            foreach (var shape in geometry.ShapeRepresentations)
            {
                ApplyShapeRepresentation(document, shape);
            }

            foreach (var primitive in geometry.Primitives.Where(primitive => primitive.Kind == "ExtrudedAreaSolid" && !primitive.IsMissingReference && primitive.MappedItemSourceId == 0))
            {
                ApplyExtrudedAreaSolid(document, primitive);
            }
        }

        RebuildEntityIndexes(document);
        RefreshProjectedRepresentations(document, model);
    }

    private static IfcDocument CloneDocument(IfcDocument document)
    {
        var clone = new IfcDocument
        {
            FileName = document.FileName,
            HeaderText = document.HeaderText,
            Schema = document.Schema,
        };
        var entityMap = new Dictionary<int, IfcEntity>();

        foreach (var entity in document.Entities)
        {
            var clonedEntity = new IfcEntity
            {
                Id = entity.Id,
                Type = entity.Type,
                OriginalStepLine = entity.OriginalStepLine,
            };
            clonedEntity.Arguments.AddRange(entity.Arguments);
            clonedEntity.OriginalArguments.AddRange(entity.OriginalArguments);
            clone.Entities.Add(clonedEntity);
            clone.EntityById[clonedEntity.Id] = clonedEntity;
            entityMap[clonedEntity.Id] = clonedEntity;

            if (!clone.EntitiesByType.TryGetValue(clonedEntity.Type, out var bucket))
            {
                bucket = [];
                clone.EntitiesByType[clonedEntity.Type] = bucket;
            }

            bucket.Add(clonedEntity);
        }

        foreach (var entry in document.IncomingReferences)
        {
            clone.IncomingReferences[entry.Key] = entry.Value
                .Where(entity => entityMap.ContainsKey(entity.Id))
                .Select(entity => entityMap[entity.Id])
                .ToList();
        }

        foreach (var entry in document.RelationshipById)
        {
            clone.RelationshipById[entry.Key] = CloneRelationship(entry.Value);
        }

        foreach (var entry in document.RelationshipsByEntity)
        {
            clone.RelationshipsByEntity[entry.Key] = entry.Value.Select(CloneRelationship).ToList();
        }

        foreach (var entry in document.PropertySetById)
        {
            clone.PropertySetById[entry.Key] = ClonePropertySet(entry.Value);
        }

        foreach (var entry in document.PropertySetsByEntity)
        {
            clone.PropertySetsByEntity[entry.Key] = entry.Value.Select(ClonePropertySet).ToList();
        }

        foreach (var entry in document.ResourcesByEntity)
        {
            clone.ResourcesByEntity[entry.Key] = [.. entry.Value];
        }

        foreach (var entry in document.TypeAssignmentsByEntity)
        {
            clone.TypeAssignmentsByEntity[entry.Key] = entry.Value.Select(CloneTypeAssignment).ToList();
        }

        foreach (var entry in document.PlacementsByEntity)
        {
            clone.PlacementsByEntity[entry.Key] = ClonePlacement(entry.Value);
        }

        foreach (var entry in document.RepresentationsByEntity)
        {
            clone.RepresentationsByEntity[entry.Key] = CloneRepresentation(entry.Value);
        }

        clone.Units.AddRange(document.Units);
        foreach (var root in document.SpatialRoots)
        {
            if (entityMap.TryGetValue(root.Entity.Id, out var entity))
            {
                clone.SpatialRoots.Add(CloneTreeNode(root, entityMap, entity));
            }
        }

        foreach (var entry in document.SpatialPathByEntity)
        {
            clone.SpatialPathByEntity[entry.Key] = entry.Value;
        }

        clone.Diagnostics.Messages.AddRange(document.Diagnostics.Messages);
        clone.MemoryModel = IfcMemoryModelEditor.Clone(document.MemoryModel);
        return clone;
    }

    private static void RebuildEntityIndexes(IfcDocument document)
    {
        document.EntityById.Clear();
        document.EntitiesByType.Clear();
        document.IncomingReferences.Clear();

        foreach (var entity in document.Entities)
        {
            document.EntityById[entity.Id] = entity;
            if (!document.EntitiesByType.TryGetValue(entity.Type, out var bucket))
            {
                bucket = [];
                document.EntitiesByType[entity.Type] = bucket;
            }

            bucket.Add(entity);

            foreach (var targetId in entity.Arguments.SelectMany(StepArgumentReader.ReadReferences))
            {
                if (!document.IncomingReferences.TryGetValue(targetId, out var incoming))
                {
                    incoming = [];
                    document.IncomingReferences[targetId] = incoming;
                }

                incoming.Add(entity);
            }
        }
    }

    private static void RefreshProjectedRelationships(IfcDocument document, IfcMemoryModel model)
    {
        document.RelationshipById.Clear();
        document.RelationshipsByEntity.Clear();

        foreach (var modelRelation in model.Relations)
        {
            var relationship = new IfcRelationship
            {
                Id = modelRelation.SourceId,
                Type = modelRelation.IfcClass,
            };
            relationship.SourceIds.AddRange(modelRelation.SourceObjectIds);
            relationship.TargetIds.AddRange(modelRelation.TargetObjectIds);
            document.RelationshipById[relationship.Id] = relationship;

            foreach (var objectId in relationship.SourceIds.Concat(relationship.TargetIds).Distinct())
            {
                if (!document.RelationshipsByEntity.TryGetValue(objectId, out var bucket))
                {
                    bucket = [];
                    document.RelationshipsByEntity[objectId] = bucket;
                }

                bucket.Add(relationship);
            }
        }
    }

    private static void RefreshSpatialProjection(IfcDocument document, IfcMemoryModel model)
    {
        document.SpatialRoots.Clear();
        document.SpatialPathByEntity.Clear();
        foreach (var modelObject in model.Objects)
        {
            modelObject.SpatialPath = string.Empty;
        }

        var childrenByParent = new Dictionary<int, List<(int ChildId, string Relation)>>();
        var childIds = new HashSet<int>();
        foreach (var relation in model.Relations.Where(relation => relation.IfcClass is "IFCRELAGGREGATES" or "IFCRELCONTAINEDINSPATIALSTRUCTURE"))
        {
            var label = relation.IfcClass == "IFCRELAGGREGATES" ? "aggregate" : "contains";
            foreach (var parentId in relation.SourceObjectIds)
            {
                if (!childrenByParent.TryGetValue(parentId, out var children))
                {
                    children = [];
                    childrenByParent[parentId] = children;
                }

                foreach (var childId in relation.TargetObjectIds)
                {
                    children.Add((childId, label));
                    childIds.Add(childId);
                }
            }
        }

        var roots = model.Objects
            .Where(modelObject => modelObject.IfcClass is "IFCPROJECT" or "IFCPROJECTLIBRARY" || modelObject.IsSpatial)
            .Where(modelObject => !childIds.Contains(modelObject.SourceId))
            .OrderBy(modelObject => modelObject.IfcClass == "IFCPROJECT" ? 0 : 1)
            .ThenBy(modelObject => modelObject.SourceId);

        foreach (var root in roots)
        {
            if (document.EntityById.TryGetValue(root.SourceId, out var rootEntity))
            {
                document.SpatialRoots.Add(BuildSpatialNode(document, model, rootEntity, "root", childrenByParent, [], []));
            }
        }
    }

    private static IfcTreeNode BuildSpatialNode(
        IfcDocument document,
        IfcMemoryModel model,
        IfcEntity entity,
        string relation,
        IReadOnlyDictionary<int, List<(int ChildId, string Relation)>> childrenByParent,
        HashSet<int> path,
        IReadOnlyList<string> parentLabels)
    {
        var node = new IfcTreeNode(entity, relation);
        var currentLabels = parentLabels.Concat([$"{entity.DisplayName} ({entity.TypeName()})"]).ToList();
        var spatialPath = string.Join(" / ", currentLabels);
        document.SpatialPathByEntity[entity.Id] = spatialPath;
        if (model.ObjectsBySourceId.TryGetValue(entity.Id, out var modelObject))
        {
            modelObject.SpatialPath = spatialPath;
        }

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
                    node.Children.Add(BuildSpatialNode(document, model, childEntity, child.Relation, childrenByParent, path, currentLabels));
                }
            }
        }

        path.Remove(entity.Id);
        return node;
    }

    private static void RefreshProjectedPropertySets(IfcDocument document, IfcMemoryModel model)
    {
        document.PropertySetsByEntity.Clear();
        document.PropertySetById.Clear();

        foreach (var entry in model.PropertySetsByObjectId)
        {
            foreach (var propertySet in entry.Value)
            {
                var projectedSet = ToProjectedPropertySet(propertySet);
                document.PropertySetById[propertySet.SourceId] = projectedSet;
                if (!document.PropertySetsByEntity.TryGetValue(entry.Key, out var bucket))
                {
                    bucket = [];
                    document.PropertySetsByEntity[entry.Key] = bucket;
                }

                bucket.Add(projectedSet);
            }
        }
    }

    private static IfcPropertySet ToProjectedPropertySet(IfcModelPropertySet propertySet)
    {
        var projectedSet = new IfcPropertySet
        {
            Id = propertySet.SourceId,
            Kind = propertySet.Kind,
            Name = propertySet.Name,
        };

        foreach (var value in propertySet.Values)
        {
            projectedSet.Values.Add(new IfcPropertyValue
            {
                Id = value.SourceId,
                Type = value.IfcClass,
                Name = value.Name,
                Value = value.Value.Display,
            });
        }

        return projectedSet;
    }

    private static void RefreshProjectedResources(IfcDocument document, IfcMemoryModel model)
    {
        document.ResourcesByEntity.Clear();
        foreach (var entry in model.ResourcesByObjectId)
        {
            foreach (var resource in entry.Value)
            {
                AddToIndex(document.ResourcesByEntity, entry.Key, resource.Label);
            }
        }
    }

    private static void RefreshProjectedRepresentations(IfcDocument document, IfcMemoryModel model)
    {
        document.RepresentationsByEntity.Clear();
        foreach (var geometry in model.ProductGeometryByProductId.Values)
        {
            var summary = new IfcRepresentationSummary
            {
                ProductId = geometry.ProductSourceId,
                ProductDefinitionShapeId = geometry.ProductDefinitionShapeSourceId,
            };
            summary.ShapeRepresentationIds.AddRange(geometry.ShapeRepresentations.Select(shape => shape.SourceId));
            summary.GeometryItemIds.AddRange(geometry.Primitives.Select(primitive => primitive.SourceId));
            document.RepresentationsByEntity[summary.ProductId] = summary;
        }
    }

    private static void RefreshMutableDiagnostics(IfcDocument document)
    {
        document.Diagnostics.Messages.RemoveAll(IsMutableValidationDiagnostic);
        ValidateRelationshipReferences(document);
        ValidateDuplicateGlobalIds(document);
        ValidateMissingGlobalIds(document);
        ValidatePrimarySpatialContainment(document);
        ValidatePhysicalProducts(document);
    }

    private static bool IsMutableValidationDiagnostic(string message)
    {
        return message.StartsWith("Warning:", StringComparison.OrdinalIgnoreCase)
            && (message.Contains("references missing entity", StringComparison.OrdinalIgnoreCase)
                || message.Contains("Duplicate GlobalId", StringComparison.OrdinalIgnoreCase)
                || message.Contains("has no GlobalId", StringComparison.OrdinalIgnoreCase)
                || message.Contains("multiple primary spatial containment", StringComparison.OrdinalIgnoreCase)
                || message.Contains("has no ObjectPlacement", StringComparison.OrdinalIgnoreCase)
                || message.Contains("ObjectPlacement points to", StringComparison.OrdinalIgnoreCase)
                || message.Contains("has no Representation", StringComparison.OrdinalIgnoreCase)
                || message.Contains("Representation points to", StringComparison.OrdinalIgnoreCase));
    }

    private static void ValidateRelationshipReferences(IfcDocument document)
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
    }

    private static void ValidateDuplicateGlobalIds(IfcDocument document)
    {
        var duplicateGlobalIds = document.Entities
            .Where(entity => !string.IsNullOrWhiteSpace(entity.GlobalId))
            .GroupBy(entity => entity.GlobalId, StringComparer.Ordinal)
            .Where(group => group.Count() > 1);

        foreach (var duplicate in duplicateGlobalIds)
        {
            document.Diagnostics.Warn($"Duplicate GlobalId {duplicate.Key}: {string.Join(", ", duplicate.Select(entity => $"#{entity.Id}"))}.");
        }
    }

    private static void ValidateMissingGlobalIds(IfcDocument document)
    {
        foreach (var entity in document.Entities.Where(entity => IsRootedEntity(entity.Type) && string.IsNullOrWhiteSpace(entity.GlobalId)))
        {
            document.Diagnostics.Warn($"#{entity.Id} {entity.Type} has no GlobalId.");
        }
    }

    private static void ValidatePrimarySpatialContainment(IfcDocument document)
    {
        var primaryContainersByProduct = document.RelationshipById.Values
            .Where(relationship => relationship.Type == "IFCRELCONTAINEDINSPATIALSTRUCTURE")
            .SelectMany(relationship => relationship.TargetIds.Select(targetId => (ProductId: targetId, RelationshipId: relationship.Id)))
            .GroupBy(item => item.ProductId)
            .Where(group => group.Count() > 1);

        foreach (var duplicateContainer in primaryContainersByProduct)
        {
            document.Diagnostics.Warn($"Entity #{duplicateContainer.Key} has multiple primary spatial containment relationships: {string.Join(", ", duplicateContainer.Select(item => $"#{item.RelationshipId}"))}.");
        }
    }

    private static void ValidatePhysicalProducts(IfcDocument document)
    {
        foreach (var product in document.Entities.Where(entity => IsPhysicalProduct(entity.Type)))
        {
            var placementId = product.Arguments.Count > 5
                ? StepArgumentReader.ReadReferences(product.Arguments[5]).FirstOrDefault()
                : 0;
            if (placementId == 0)
            {
                document.Diagnostics.Warn($"#{product.Id} {product.Type} has no ObjectPlacement.");
            }
            else if (!document.EntityById.TryGetValue(placementId, out var placement) || placement.Type != "IFCLOCALPLACEMENT")
            {
                document.Diagnostics.Warn($"#{product.Id} {product.Type} ObjectPlacement points to #{placementId}, not IFCLOCALPLACEMENT.");
            }

            var representationId = product.Arguments.Count > 6
                ? StepArgumentReader.ReadReferences(product.Arguments[6]).FirstOrDefault()
                : 0;
            if (representationId == 0)
            {
                document.Diagnostics.Warn($"#{product.Id} {product.Type} has no Representation.");
            }
            else if (!document.EntityById.TryGetValue(representationId, out var representation) || representation.Type != "IFCPRODUCTDEFINITIONSHAPE")
            {
                document.Diagnostics.Warn($"#{product.Id} {product.Type} Representation points to #{representationId}, not IFCPRODUCTDEFINITIONSHAPE.");
            }
        }
    }

    private static IfcRelationship CloneRelationship(IfcRelationship relationship)
    {
        var clone = new IfcRelationship
        {
            Id = relationship.Id,
            Type = relationship.Type,
        };
        clone.SourceIds.AddRange(relationship.SourceIds);
        clone.TargetIds.AddRange(relationship.TargetIds);
        return clone;
    }

    private static IfcPropertySet ClonePropertySet(IfcPropertySet propertySet)
    {
        var clone = new IfcPropertySet
        {
            Id = propertySet.Id,
            Kind = propertySet.Kind,
            Name = propertySet.Name,
        };
        foreach (var value in propertySet.Values)
        {
            clone.Values.Add(new IfcPropertyValue
            {
                Id = value.Id,
                Type = value.Type,
                Name = value.Name,
                Value = value.Value,
            });
        }

        return clone;
    }

    private static IfcTypeAssignment CloneTypeAssignment(IfcTypeAssignment assignment)
    {
        var clone = new IfcTypeAssignment
        {
            RelationshipId = assignment.RelationshipId,
            TypeId = assignment.TypeId,
            TypeClass = assignment.TypeClass,
            TypeName = assignment.TypeName,
        };
        clone.ObjectIds.AddRange(assignment.ObjectIds);
        return clone;
    }

    private static IfcPlacementSummary ClonePlacement(IfcPlacementSummary placement)
    {
        return new IfcPlacementSummary
        {
            ProductId = placement.ProductId,
            PlacementId = placement.PlacementId,
            RelativeToId = placement.RelativeToId,
            AxisPlacementId = placement.AxisPlacementId,
            PointId = placement.PointId,
            X = placement.X,
            Y = placement.Y,
            Z = placement.Z,
        };
    }

    private static IfcRepresentationSummary CloneRepresentation(IfcRepresentationSummary representation)
    {
        var clone = new IfcRepresentationSummary
        {
            ProductId = representation.ProductId,
            ProductDefinitionShapeId = representation.ProductDefinitionShapeId,
        };
        clone.ShapeRepresentationIds.AddRange(representation.ShapeRepresentationIds);
        clone.GeometryItemIds.AddRange(representation.GeometryItemIds);
        return clone;
    }

    private static IfcTreeNode CloneTreeNode(IfcTreeNode node, IReadOnlyDictionary<int, IfcEntity> entityMap, IfcEntity fallbackEntity)
    {
        var clone = new IfcTreeNode(entityMap.GetValueOrDefault(node.Entity.Id) ?? fallbackEntity, node.Relation);
        foreach (var child in node.Children)
        {
            if (entityMap.TryGetValue(child.Entity.Id, out var childEntity))
            {
                clone.Children.Add(CloneTreeNode(child, entityMap, childEntity));
            }
        }

        return clone;
    }

    private static string FormatStepValue(IfcModelValue value)
    {
        var formatted = value.Kind switch
        {
            IfcPropertyValueKind.Empty => "$",
            IfcPropertyValueKind.String => StepArgumentReader.Quote(value.Text ?? string.Empty),
            IfcPropertyValueKind.Boolean => value.Boolean.GetValueOrDefault() ? ".T." : ".F.",
            IfcPropertyValueKind.Number => FormatMeasure(value.Number ?? 0),
            IfcPropertyValueKind.Enum => $".{value.Text}.",
            IfcPropertyValueKind.Reference => value.Text ?? "$",
            _ => value.Text ?? "$",
        };

        return string.IsNullOrWhiteSpace(value.IfcType) || formatted == "$"
            ? formatted
            : $"{value.IfcType}({formatted})";
    }

    private static void ApplyResourceEntity(IfcEntity entity, IfcModelResource resource)
    {
        switch (resource.IfcClass)
        {
            case "IFCMATERIAL":
                SetArgument(entity, 0, FormatOptionalLabel(resource.Name));
                SetArgument(entity, 1, FormatOptionalLabel(resource.Description));
                SetArgument(entity, 2, "$");
                break;
            case "IFCCLASSIFICATIONREFERENCE":
            case "IFCLIBRARYREFERENCE":
                SetArgument(entity, 0, "$");
                SetArgument(entity, 1, FormatOptionalLabel(resource.Identification));
                SetArgument(entity, 2, FormatOptionalLabel(resource.Name));
                SetArgument(entity, 3, "$");
                SetArgument(entity, 4, FormatOptionalLabel(resource.Description));
                break;
            case "IFCDOCUMENTREFERENCE":
                SetArgument(entity, 0, FormatOptionalLabel(resource.Identification));
                SetArgument(entity, 1, "$");
                SetArgument(entity, 2, FormatOptionalLabel(resource.Name));
                SetArgument(entity, 3, FormatOptionalLabel(resource.Description));
                break;
            default:
                SetArgument(entity, 0, FormatOptionalLabel(resource.Identification));
                SetArgument(entity, 2, FormatOptionalLabel(resource.Name));
                SetArgument(entity, 3, FormatOptionalLabel(resource.Description));
                break;
        }
    }

    private static bool ShouldMaterializeObject(IfcModelObject modelObject)
    {
        return modelObject.Placement is not null
            && !string.IsNullOrWhiteSpace(modelObject.IfcClass)
            && !modelObject.IfcClass.StartsWith("IFCREL", StringComparison.OrdinalIgnoreCase);
    }

    private static void ApplyProductObjectEntity(IfcEntity entity, IfcModelObject modelObject, IfcMemoryModel model)
    {
        SetArgument(entity, 0, FormatOptionalLabel(modelObject.GlobalId));
        SetArgument(entity, 1, "$");
        SetArgument(entity, 2, FormatOptionalLabel(modelObject.Name));
        SetArgument(entity, 3, FormatOptionalLabel(modelObject.Description));
        SetArgument(entity, 4, "$");
        SetArgument(entity, 5, modelObject.Placement is null ? "$" : $"#{modelObject.Placement.SourceId}");
        SetArgument(entity, 6, model.ProductGeometryByProductId.TryGetValue(modelObject.SourceId, out var geometry)
            ? $"#{geometry.ProductDefinitionShapeSourceId}"
            : "$");
        SetArgument(entity, 7, "$");
        SetArgument(entity, 8, string.IsNullOrWhiteSpace(modelObject.PredefinedType) ? "$" : modelObject.PredefinedType);
    }

    private static void ApplyShapeRepresentation(IfcDocument document, IfcShapeRepresentationModel shape)
    {
        if (shape.ContextSourceId > 0)
        {
            EnsureRepresentationContext(document, shape.ContextSourceId);
        }

        var entity = EnsureEntity(document, shape.SourceId, "IFCSHAPEREPRESENTATION");
        SetArgument(entity, 0, shape.ContextSourceId > 0 ? $"#{shape.ContextSourceId}" : "$");
        SetArgument(entity, 1, StepArgumentReader.Quote(string.IsNullOrWhiteSpace(shape.Identifier) ? "Body" : shape.Identifier));
        SetArgument(entity, 2, StepArgumentReader.Quote(string.IsNullOrWhiteSpace(shape.RepresentationType) ? "SweptSolid" : shape.RepresentationType));
        SetArgument(entity, 3, FormatReferenceArgument(shape.GeometryItemSourceIds, asList: true));
    }

    private static void ApplyExtrudedAreaSolid(IfcDocument document, IfcGeometryPrimitive primitive)
    {
        var solid = EnsureEntity(document, primitive.SourceId, "IFCEXTRUDEDAREASOLID");
        SetArgument(solid, 0, primitive.Profile is null ? "$" : $"#{primitive.Profile.SourceId}");
        SetArgument(solid, 1, primitive.PositionSourceId > 0 ? $"#{primitive.PositionSourceId}" : "$");
        SetArgument(solid, 2, primitive.DirectionSourceId > 0 ? $"#{primitive.DirectionSourceId}" : "$");
        SetArgument(solid, 3, FormatMeasure(primitive.SizeZ ?? 0));

        if (primitive.PositionSourceId > 0)
        {
            var position = EnsureEntity(document, primitive.PositionSourceId, "IFCAXIS2PLACEMENT3D");
            SetArgument(position, 0, primitive.PositionPointSourceId > 0 ? $"#{primitive.PositionPointSourceId}" : "$");
            SetArgument(position, 1, primitive.PositionAxisSourceId > 0 ? $"#{primitive.PositionAxisSourceId}" : "$");
            SetArgument(position, 2, primitive.PositionRefDirectionSourceId > 0 ? $"#{primitive.PositionRefDirectionSourceId}" : "$");
            ApplyDirection(document, primitive.PositionAxisSourceId, primitive.PositionAxis, twoDimensional: false);
            ApplyDirection(document, primitive.PositionRefDirectionSourceId, primitive.PositionRefDirection, twoDimensional: false);
        }

        if (primitive.PositionPointSourceId > 0)
        {
            var point = EnsureEntity(document, primitive.PositionPointSourceId, "IFCCARTESIANPOINT");
            SetArgument(point, 0, FormatPoint3D(primitive.PositionX, primitive.PositionY, primitive.PositionZ));
        }

        if (primitive.DirectionSourceId > 0)
        {
            ApplyDirection(document, primitive.DirectionSourceId, primitive.Direction, twoDimensional: false);
        }

        if (primitive.Profile is not null)
        {
            ApplyProfile(document, primitive.Profile, primitive);
        }
    }

    private static void ApplyProfile(IfcDocument document, IfcGeometryProfile profile, IfcGeometryPrimitive primitive)
    {
        var profileEntity = EnsureEntity(document, profile.SourceId, profile.IfcClass);
        SetArgument(profileEntity, 0, ".AREA.");
        SetArgument(profileEntity, 1, StepArgumentReader.Quote(profile.Name));
        SetArgument(profileEntity, 2, profile.PositionSourceId > 0 ? $"#{profile.PositionSourceId}" : "$");

        if (profile.Kind == "Circle")
        {
            SetArgument(profileEntity, 3, FormatMeasure(profile.Radius ?? Math.Max(primitive.SizeX ?? 0, primitive.SizeY ?? 0) / 2));
        }
        else
        {
            SetArgument(profileEntity, 3, FormatMeasure(profile.SizeX ?? primitive.SizeX ?? 0));
            SetArgument(profileEntity, 4, FormatMeasure(profile.SizeY ?? primitive.SizeY ?? 0));
        }

        if (profile.PositionSourceId > 0)
        {
            var position = EnsureEntity(document, profile.PositionSourceId, "IFCAXIS2PLACEMENT2D");
            SetArgument(position, 0, profile.PositionPointSourceId > 0 ? $"#{profile.PositionPointSourceId}" : "$");
            SetArgument(position, 1, profile.DirectionSourceId > 0 ? $"#{profile.DirectionSourceId}" : "$");
        }

        if (profile.PositionPointSourceId > 0)
        {
            var point = EnsureEntity(document, profile.PositionPointSourceId, "IFCCARTESIANPOINT");
            SetArgument(point, 0, FormatPoint2D(profile.PositionX, profile.PositionY));
        }

        if (profile.DirectionSourceId > 0)
        {
            ApplyDirection(document, profile.DirectionSourceId, profile.PositionRefDirection, twoDimensional: true);
        }
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

    private static string FormatReferenceArgument(IEnumerable<int> ids, bool asList)
    {
        var references = ids.Distinct().Select(id => $"#{id}").ToList();
        if (references.Count == 0)
        {
            return asList ? "()" : "$";
        }

        return asList ? $"({string.Join(',', references)})" : references[0];
    }

    private static string FormatOptionalLabel(string value)
    {
        return string.IsNullOrWhiteSpace(value) ? "$" : StepArgumentReader.Quote(value);
    }

    private static IfcEntity EnsureEntity(IfcDocument document, int id, string type)
    {
        if (document.EntityById.TryGetValue(id, out var entity))
        {
            return entity;
        }

        entity = new IfcEntity { Id = id, Type = type };
        document.Entities.Add(entity);
        document.EntityById[id] = entity;
        return entity;
    }

    private static void EnsureRepresentationContext(IfcDocument document, int contextId)
    {
        if (document.EntityById.ContainsKey(contextId))
        {
            return;
        }

        var context = EnsureEntity(document, contextId, "IFCGEOMETRICREPRESENTATIONCONTEXT");
        SetArgument(context, 0, StepArgumentReader.Quote("Body"));
        SetArgument(context, 1, StepArgumentReader.Quote("Model"));
        SetArgument(context, 2, "3");
        SetArgument(context, 3, "1.E-05");
        SetArgument(context, 4, "$");
        SetArgument(context, 5, "$");
    }

    private static bool IsRootedEntity(string type)
    {
        return type is "IFCPROJECT" or "IFCSITE" or "IFCBUILDING" or "IFCBUILDINGSTOREY" or "IFCSPACE"
            or "IFCPROPERTYSET" or "IFCELEMENTQUANTITY" or "IFCTYPEOBJECT" or "IFCBUILDINGELEMENTPROXYTYPE"
            || IsPhysicalProduct(type)
            || type.StartsWith("IFCREL", StringComparison.OrdinalIgnoreCase)
            || type.EndsWith("TYPE", StringComparison.OrdinalIgnoreCase);
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

    private static string MakeGeneratedGlobalId(string prefix, int id)
    {
        var raw = $"IFCnative{prefix}{id:000000000000}";
        return StepArgumentReader.Quote(raw.Length <= 22 ? raw : raw[..22]);
    }

    private static void SetArgument(IfcEntity entity, int argumentIndex, string value)
    {
        while (entity.Arguments.Count <= argumentIndex)
        {
            entity.Arguments.Add("$");
        }

        entity.Arguments[argumentIndex] = value;
    }

    private static string FormatMeasure(double value)
    {
        var formatted = value.ToString("0.########", CultureInfo.InvariantCulture);
        return formatted.Contains('.', StringComparison.Ordinal) ? formatted : $"{formatted}.";
    }

    private static string FormatPoint2D(double x, double y)
    {
        return $"({FormatMeasure(x)},{FormatMeasure(y)})";
    }

    private static string FormatPoint3D(double x, double y, double z)
    {
        return $"({FormatMeasure(x)},{FormatMeasure(y)},{FormatMeasure(z)})";
    }

    private static void ApplyDirection(IfcDocument document, int directionSourceId, IfcModelVector vector, bool twoDimensional)
    {
        if (directionSourceId <= 0)
        {
            return;
        }

        var direction = EnsureEntity(document, directionSourceId, "IFCDIRECTION");
        SetArgument(direction, 0, twoDimensional
            ? FormatPoint2D(vector.X, vector.Y)
            : FormatPoint3D(vector.X, vector.Y, vector.Z));
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
}
