using System.Globalization;
using IFCnative.NativeWindows.Models;

namespace IFCnative.NativeWindows.Services;

public static class IfcMemoryModelBuilder
{
    public static IfcMemoryModel Build(IfcDocument document)
    {
        var model = new IfcMemoryModel
        {
            FileName = document.FileName,
            Schema = document.Schema,
        };

        foreach (var entity in document.Entities)
        {
            var modelObject = new IfcModelObject
            {
                SourceId = entity.Id,
                IfcClass = entity.Type,
                GlobalId = IsRootedEntity(entity.Type) ? entity.GlobalId : string.Empty,
                Name = entity.Name,
                Description = entity.Description,
                PredefinedType = ReadPredefinedType(entity),
                IsSpatial = IsSpatial(entity.Type),
                IsPhysicalProduct = IsPhysicalProduct(entity.Type),
                SpatialPath = document.SpatialPathByEntity.GetValueOrDefault(entity.Id, string.Empty),
                Placement = document.PlacementsByEntity.TryGetValue(entity.Id, out var placement) ? ConvertPlacement(document, placement) : null,
            };
            modelObject.RawArguments.AddRange(entity.Arguments);

            model.Objects.Add(modelObject);
            model.ObjectsBySourceId[modelObject.SourceId] = modelObject;
            AddToIndex(model.ObjectsByClass, modelObject.IfcClass, modelObject);
        }

        AddRelations(document, model);
        AddProperties(document, model);
        AddResources(document, model);
        AddGeometry(document, model);

        return model;
    }

    private static void AddRelations(IfcDocument document, IfcMemoryModel model)
    {
        foreach (var relationship in document.RelationshipById.Values.OrderBy(relationship => relationship.Id))
        {
            var relation = new IfcModelRelation
            {
                SourceId = relationship.Id,
                IfcClass = relationship.Type,
                Name = document.EntityById.TryGetValue(relationship.Id, out var entity) ? entity.Name : string.Empty,
            };
            relation.SourceObjectIds.AddRange(relationship.SourceIds);
            relation.TargetObjectIds.AddRange(relationship.TargetIds);
            model.Relations.Add(relation);

            foreach (var objectId in relation.SourceObjectIds.Concat(relation.TargetObjectIds).Distinct())
            {
                AddToIndex(model.RelationsByObjectId, objectId, relation);
                if (model.ObjectsBySourceId.TryGetValue(objectId, out var modelObject))
                {
                    modelObject.Relations.Add(relation);
                }
            }
        }
    }

    private static void AddProperties(IfcDocument document, IfcMemoryModel model)
    {
        foreach (var entry in document.PropertySetsByEntity.OrderBy(entry => entry.Key))
        {
            if (!model.ObjectsBySourceId.TryGetValue(entry.Key, out var modelObject))
            {
                continue;
            }

            foreach (var propertySet in entry.Value)
            {
                var modelPropertySet = ConvertPropertySet(document, propertySet);
                model.PropertySetBySourceId[modelPropertySet.SourceId] = modelPropertySet;
                modelObject.PropertySets.Add(modelPropertySet);
                AddToIndex(model.PropertySetsByObjectId, entry.Key, modelPropertySet);
            }
        }
    }

    private static void AddResources(IfcDocument document, IfcMemoryModel model)
    {
        foreach (var relation in model.Relations.Where(relation => IsResourceRelationship(relation.IfcClass)).OrderBy(relation => relation.SourceId))
        {
            foreach (var resourceId in relation.SourceObjectIds)
            {
                if (!document.EntityById.TryGetValue(resourceId, out var resourceEntity))
                {
                    continue;
                }

                if (!model.ResourceBySourceId.TryGetValue(resourceId, out var resource))
                {
                    resource = ConvertResource(resourceEntity);
                    model.ResourceBySourceId[resource.SourceId] = resource;
                }

                foreach (var objectId in relation.TargetObjectIds)
                {
                    if (!model.ObjectsBySourceId.TryGetValue(objectId, out var modelObject)
                        || modelObject.Resources.Any(existing => existing.SourceId == resource.SourceId))
                    {
                        continue;
                    }

                    modelObject.Resources.Add(resource);
                    AddToIndex(model.ResourcesByObjectId, objectId, resource);
                }
            }
        }
    }

    private static IfcModelResource ConvertResource(IfcEntity entity)
    {
        return new IfcModelResource
        {
            SourceId = entity.Id,
            IfcClass = entity.Type,
            Name = ReadResourceName(entity),
            Identification = ReadResourceIdentification(entity),
            Description = ReadResourceDescription(entity),
        };
    }

    private static string ReadResourceName(IfcEntity entity)
    {
        return entity.Type switch
        {
            "IFCMATERIAL" => FirstLabelArgument(entity, 0),
            "IFCCLASSIFICATIONREFERENCE" or "IFCLIBRARYREFERENCE" => FirstLabelArgument(entity, 2, 1, 0),
            "IFCDOCUMENTREFERENCE" => FirstLabelArgument(entity, 2, 0),
            _ => FirstLabelArgument(entity, 2, 0),
        } ?? entity.Name;
    }

    private static string ReadResourceIdentification(IfcEntity entity)
    {
        return entity.Type switch
        {
            "IFCCLASSIFICATIONREFERENCE" or "IFCLIBRARYREFERENCE" => FirstLabelArgument(entity, 1, 0),
            "IFCDOCUMENTREFERENCE" => FirstLabelArgument(entity, 0),
            _ => string.Empty,
        } ?? string.Empty;
    }

    private static string ReadResourceDescription(IfcEntity entity)
    {
        return entity.Type switch
        {
            "IFCMATERIAL" => FirstLabelArgument(entity, 1),
            "IFCCLASSIFICATIONREFERENCE" or "IFCLIBRARYREFERENCE" => FirstLabelArgument(entity, 4, 3),
            "IFCDOCUMENTREFERENCE" => FirstLabelArgument(entity, 3, 1),
            _ => entity.Description,
        } ?? string.Empty;
    }

    private static string? FirstLabelArgument(IfcEntity entity, params int[] argumentIndexes)
    {
        foreach (var argumentIndex in argumentIndexes)
        {
            var label = StepArgumentReader.Unquote(entity.Arguments.ElementAtOrDefault(argumentIndex));
            if (!string.IsNullOrWhiteSpace(label))
            {
                return label;
            }
        }

        return null;
    }

    private static void AddGeometry(IfcDocument document, IfcMemoryModel model)
    {
        foreach (var summary in document.RepresentationsByEntity.Values.OrderBy(summary => summary.ProductId))
        {
            var productGeometry = new IfcProductGeometry
            {
                ProductSourceId = summary.ProductId,
                ProductDefinitionShapeSourceId = summary.ProductDefinitionShapeId,
            };

            foreach (var shapeRepresentationId in summary.ShapeRepresentationIds)
            {
                if (!document.EntityById.TryGetValue(shapeRepresentationId, out var shapeRepresentation))
                {
                    continue;
                }

                var shape = new IfcShapeRepresentationModel
                {
                    SourceId = shapeRepresentation.Id,
                    ContextSourceId = StepArgumentReader.ReadReferences(shapeRepresentation.Arguments.ElementAtOrDefault(0) ?? string.Empty).FirstOrDefault(),
                    Identifier = ReadLabel(shapeRepresentation.Arguments.ElementAtOrDefault(1)),
                    RepresentationType = ReadLabel(shapeRepresentation.Arguments.ElementAtOrDefault(2)),
                };
                shape.GeometryItemSourceIds.AddRange(StepArgumentReader.ReadReferences(shapeRepresentation.Arguments.ElementAtOrDefault(3) ?? string.Empty));
                productGeometry.ShapeRepresentations.Add(shape);
            }

            foreach (var geometryItemId in summary.GeometryItemIds.Distinct())
            {
                productGeometry.Primitives.AddRange(BuildPrimitives(document, geometryItemId, []));
            }

            model.ProductGeometryByProductId[summary.ProductId] = productGeometry;
            if (model.ObjectsBySourceId.TryGetValue(summary.ProductId, out var modelObject))
            {
                modelObject.Geometry = productGeometry;
            }
        }
    }

    private static IfcModelPlacement ConvertPlacement(IfcDocument document, IfcPlacementSummary placement)
    {
        var axisPlacement = ReadAxisPlacement3D(document, placement.AxisPlacementId);
        return new IfcModelPlacement
        {
            SourceId = placement.PlacementId,
            RelativeToSourceId = placement.RelativeToId,
            AxisPlacementSourceId = placement.AxisPlacementId,
            PointSourceId = placement.PointId,
            AxisDirectionSourceId = axisPlacement.AxisDirectionSourceId,
            RefDirectionSourceId = axisPlacement.RefDirectionSourceId,
            X = placement.X,
            Y = placement.Y,
            Z = placement.Z,
            Axis = axisPlacement.Axis,
            RefDirection = axisPlacement.RefDirection,
        };
    }

    private static IfcModelPropertySet ConvertPropertySet(IfcDocument document, IfcPropertySet propertySet)
    {
        var modelPropertySet = new IfcModelPropertySet
        {
            SourceId = propertySet.Id,
            Kind = propertySet.Kind,
            Name = propertySet.Name,
        };

        foreach (var value in propertySet.Values)
        {
            var modelValue = document.EntityById.TryGetValue(value.Id, out var valueEntity)
            ? ReadPropertyValue(valueEntity)
                : new IfcModelValue(IfcPropertyValueKind.Unknown, null, null, null, null, value.Value);

            modelPropertySet.Values.Add(new IfcModelPropertyValue
            {
                SourceId = value.Id,
                IfcClass = value.Type,
                Name = value.Name,
                Value = modelValue,
            });
        }

        return modelPropertySet;
    }

    private static IfcModelValue ReadPropertyValue(IfcEntity valueEntity)
    {
        var raw = valueEntity.Type switch
        {
            "IFCPROPERTYSINGLEVALUE" => valueEntity.Arguments.ElementAtOrDefault(2),
            "IFCQUANTITYLENGTH" or "IFCQUANTITYAREA" or "IFCQUANTITYVOLUME" or "IFCQUANTITYCOUNT" or "IFCQUANTITYWEIGHT" or "IFCQUANTITYTIME" => valueEntity.Arguments.ElementAtOrDefault(3),
            _ => string.Join(",", valueEntity.Arguments),
        };

        return ParsePropertyValue(raw);
    }

    public static IfcModelValue ParsePropertyValue(string? rawValue)
    {
        var raw = rawValue?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(raw) || raw is "$" or "*")
        {
            return IfcModelValue.Empty;
        }

        var wrapped = TryReadWrappedValue(raw);
        if (wrapped is not null)
        {
            var innerValue = ParsePropertyValue(wrapped.Value.Inner);
            return innerValue with
            {
                IfcType = wrapped.Value.Type,
                Display = string.IsNullOrWhiteSpace(innerValue.Display)
                    ? $"{wrapped.Value.Type}()"
                    : $"{wrapped.Value.Type}({innerValue.Display})",
            };
        }

        var text = StepArgumentReader.Unquote(raw);
        if (text is not null)
        {
            return new IfcModelValue(IfcPropertyValueKind.String, null, text, null, null, text);
        }

        if (raw.Equals(".T.", StringComparison.OrdinalIgnoreCase) || raw.Equals(".F.", StringComparison.OrdinalIgnoreCase))
        {
            var value = raw.Equals(".T.", StringComparison.OrdinalIgnoreCase);
            return new IfcModelValue(IfcPropertyValueKind.Boolean, null, null, null, value, value ? "true" : "false");
        }

        if (double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out var number))
        {
            return new IfcModelValue(IfcPropertyValueKind.Number, null, null, number, null, number.ToString("0.###", CultureInfo.InvariantCulture));
        }

        if (raw.StartsWith('#'))
        {
            return new IfcModelValue(IfcPropertyValueKind.Reference, null, raw, null, null, raw);
        }

        if (raw.Length > 2 && raw.StartsWith('.') && raw.EndsWith('.'))
        {
            var enumValue = raw.Trim('.');
            return new IfcModelValue(IfcPropertyValueKind.Enum, null, enumValue, null, null, enumValue);
        }

        return new IfcModelValue(IfcPropertyValueKind.Unknown, null, raw, null, null, StepArgumentReader.CompactPreview(raw));
    }

    private static (string Type, string Inner)? TryReadWrappedValue(string raw)
    {
        var openIndex = raw.IndexOf('(');
        if (openIndex <= 0 || !raw.EndsWith(')'))
        {
            return null;
        }

        var type = raw[..openIndex].Trim().ToUpperInvariant();
        if (type.Length == 0 || !type.All(character => char.IsLetterOrDigit(character) || character == '_'))
        {
            return null;
        }

        return (type, raw[(openIndex + 1)..^1].Trim());
    }

    private static IReadOnlyList<IfcGeometryPrimitive> BuildPrimitives(IfcDocument document, int geometryItemId, HashSet<int> visited)
    {
        if (!visited.Add(geometryItemId))
        {
            return
            [
                new IfcGeometryPrimitive
                {
                    SourceId = geometryItemId,
                    IfcClass = "CYCLIC",
                    Kind = "CyclicReference",
                    IsMissingReference = true,
                },
            ];
        }

        if (!document.EntityById.TryGetValue(geometryItemId, out var entity))
        {
            return
            [
                new IfcGeometryPrimitive
                {
                    SourceId = geometryItemId,
                    IfcClass = "MISSING",
                    Kind = "MissingReference",
                    IsMissingReference = true,
                },
            ];
        }

        return entity.Type switch
        {
            "IFCEXTRUDEDAREASOLID" => [BuildExtrudedAreaSolid(document, entity)],
            "IFCBOUNDINGBOX" => [BuildBoundingBox(entity)],
            "IFCMAPPEDITEM" => BuildMappedItem(document, entity, visited),
            _ => [BuildUnknownPrimitive(entity)],
        };
    }

    private static IReadOnlyList<IfcGeometryPrimitive> BuildMappedItem(IfcDocument document, IfcEntity entity, HashSet<int> visited)
    {
        var representationMapId = StepArgumentReader.ReadReferences(entity.Arguments.ElementAtOrDefault(0) ?? string.Empty).FirstOrDefault();
        var targetTransformId = StepArgumentReader.ReadReferences(entity.Arguments.ElementAtOrDefault(1) ?? string.Empty).FirstOrDefault();
        if (representationMapId == 0
            || !document.EntityById.TryGetValue(representationMapId, out var representationMap)
            || representationMap.Type != "IFCREPRESENTATIONMAP")
        {
            return [BuildUnknownPrimitive(entity)];
        }

        var mappedRepresentationId = StepArgumentReader.ReadReferences(representationMap.Arguments.ElementAtOrDefault(1) ?? string.Empty).FirstOrDefault();
        if (mappedRepresentationId == 0
            || !document.EntityById.TryGetValue(mappedRepresentationId, out var mappedRepresentation)
            || mappedRepresentation.Type != "IFCSHAPEREPRESENTATION")
        {
            return [BuildUnknownPrimitive(entity)];
        }

        var mapping = ReadMappingTransform(document, targetTransformId);
        var primitives = new List<IfcGeometryPrimitive>();
        foreach (var childItemId in StepArgumentReader.ReadReferences(mappedRepresentation.Arguments.ElementAtOrDefault(3) ?? string.Empty).Distinct())
        {
            foreach (var child in BuildPrimitives(document, childItemId, new HashSet<int>(visited)))
            {
                primitives.Add(CloneMappedPrimitive(entity, child, mapping));
            }
        }

        return primitives.Count == 0 ? [BuildUnknownPrimitive(entity)] : primitives;
    }

    private static IfcGeometryPrimitive CloneMappedPrimitive(IfcEntity mappedItem, IfcGeometryPrimitive primitive, MappingTransform mapping)
    {
        var clone = new IfcGeometryPrimitive
        {
            SourceId = mappedItem.Id,
            IfcClass = primitive.IfcClass,
            Kind = primitive.Kind,
            IsMissingReference = primitive.IsMissingReference,
            Profile = primitive.Profile is null ? null : CloneProfile(primitive.Profile),
            PositionSourceId = primitive.PositionSourceId,
            PositionPointSourceId = primitive.PositionPointSourceId,
            DirectionSourceId = primitive.DirectionSourceId,
            MappedItemSourceId = mappedItem.Id,
            MappedGeometrySourceId = primitive.MappedGeometrySourceId > 0 ? primitive.MappedGeometrySourceId : primitive.SourceId,
            MappingX = mapping.X,
            MappingY = mapping.Y,
            MappingZ = mapping.Z,
            MappingScale = mapping.Scale,
            MappingAxis = mapping.Axis,
            MappingRefDirection = mapping.RefDirection,
            PositionAxisSourceId = primitive.PositionAxisSourceId,
            PositionRefDirectionSourceId = primitive.PositionRefDirectionSourceId,
            PositionX = primitive.PositionX,
            PositionY = primitive.PositionY,
            PositionZ = primitive.PositionZ,
            SizeX = primitive.SizeX,
            SizeY = primitive.SizeY,
            SizeZ = primitive.SizeZ,
            Direction = primitive.Direction,
            PositionAxis = primitive.PositionAxis,
            PositionRefDirection = primitive.PositionRefDirection,
        };
        clone.ReferencedSourceIds.AddRange(primitive.ReferencedSourceIds);
        clone.ReferencedSourceIds.AddRange(mappedItem.Arguments.SelectMany(StepArgumentReader.ReadReferences));
        clone.ReferencedSourceIds.Add(clone.MappedGeometrySourceId);
        return clone;
    }

    private static IfcGeometryProfile CloneProfile(IfcGeometryProfile profile)
    {
        return new IfcGeometryProfile
        {
            SourceId = profile.SourceId,
            PositionSourceId = profile.PositionSourceId,
            PositionPointSourceId = profile.PositionPointSourceId,
            DirectionSourceId = profile.DirectionSourceId,
            PositionX = profile.PositionX,
            PositionY = profile.PositionY,
            PositionZ = profile.PositionZ,
            PositionRefDirection = profile.PositionRefDirection,
            IfcClass = profile.IfcClass,
            Kind = profile.Kind,
            Name = profile.Name,
            SizeX = profile.SizeX,
            SizeY = profile.SizeY,
            Radius = profile.Radius,
        };
    }

    private static MappingTransform ReadMappingTransform(IfcDocument document, int transformId)
    {
        if (transformId == 0 || !document.EntityById.TryGetValue(transformId, out var transform)
            || !transform.Type.StartsWith("IFCCARTESIANTRANSFORMATIONOPERATOR", StringComparison.OrdinalIgnoreCase))
        {
            return MappingTransform.Identity;
        }

        var axis1Id = StepArgumentReader.ReadReferences(transform.Arguments.ElementAtOrDefault(0) ?? string.Empty).FirstOrDefault();
        var localOriginId = StepArgumentReader.ReadReferences(transform.Arguments.ElementAtOrDefault(2) ?? string.Empty).FirstOrDefault();
        var axis3Id = StepArgumentReader.ReadReferences(transform.Arguments.ElementAtOrDefault(4) ?? string.Empty).FirstOrDefault();
        var origin = ReadPointCoordinates(document, localOriginId);
        var scale = ReadDouble(transform.Arguments.ElementAtOrDefault(3)) ?? 1;
        return new MappingTransform(
            origin.X,
            origin.Y,
            origin.Z,
            scale <= 0 ? 1 : scale,
            axis3Id == 0 ? IfcModelVector.UnitZ : ReadDirection(document, axis3Id, IfcModelVector.UnitZ),
            axis1Id == 0 ? IfcModelVector.UnitX : ReadDirection(document, axis1Id, IfcModelVector.UnitX));
    }

    private static IfcGeometryPrimitive BuildExtrudedAreaSolid(IfcDocument document, IfcEntity entity)
    {
        var profileId = StepArgumentReader.ReadReferences(entity.Arguments.ElementAtOrDefault(0) ?? string.Empty).FirstOrDefault();
        var profile = profileId == 0 ? null : BuildProfile(document, profileId);
        var positionId = StepArgumentReader.ReadReferences(entity.Arguments.ElementAtOrDefault(1) ?? string.Empty).FirstOrDefault();
        var positionPointId = ReadPlacementPointId(document, positionId);
        var position = ReadPointCoordinates(document, positionPointId);
        var axisPlacement = ReadAxisPlacement3D(document, positionId);
        var sizeX = profile?.Kind == "Circle" ? profile.Radius * 2 : profile?.SizeX;
        var sizeY = profile?.Kind == "Circle" ? profile.Radius * 2 : profile?.SizeY;
        var sizeZ = ReadDouble(entity.Arguments.ElementAtOrDefault(3));
        var directionId = StepArgumentReader.ReadReferences(entity.Arguments.ElementAtOrDefault(2) ?? string.Empty).FirstOrDefault();
        var direction = directionId == 0 ? IfcModelVector.UnitZ : ReadDirection(document, directionId);
        var primitive = new IfcGeometryPrimitive
        {
            SourceId = entity.Id,
            IfcClass = entity.Type,
            Kind = "ExtrudedAreaSolid",
            Profile = profile,
            PositionSourceId = positionId,
            PositionPointSourceId = positionPointId,
            DirectionSourceId = directionId,
            PositionX = position.X,
            PositionY = position.Y,
            PositionZ = position.Z,
            PositionAxisSourceId = axisPlacement.AxisDirectionSourceId,
            PositionRefDirectionSourceId = axisPlacement.RefDirectionSourceId,
            SizeX = sizeX,
            SizeY = sizeY,
            SizeZ = sizeZ,
            Direction = direction,
            PositionAxis = axisPlacement.Axis,
            PositionRefDirection = axisPlacement.RefDirection,
        };

        primitive.ReferencedSourceIds.AddRange(entity.Arguments.SelectMany(StepArgumentReader.ReadReferences).Distinct());
        return primitive;
    }

    private static IfcGeometryPrimitive BuildBoundingBox(IfcEntity entity)
    {
        var numbers = entity.Arguments.Select(ReadDouble).Where(value => value is not null).Select(value => value!.Value).ToList();
        var sizeX = numbers.Count >= 3 ? numbers[^3] : null as double?;
        var sizeY = numbers.Count >= 2 ? numbers[^2] : null as double?;
        var sizeZ = numbers.Count >= 1 ? numbers[^1] : null as double?;
        var primitive = new IfcGeometryPrimitive
        {
            SourceId = entity.Id,
            IfcClass = entity.Type,
            Kind = "BoundingBox",
            SizeX = sizeX,
            SizeY = sizeY,
            SizeZ = sizeZ,
        };

        primitive.ReferencedSourceIds.AddRange(entity.Arguments.SelectMany(StepArgumentReader.ReadReferences).Distinct());
        return primitive;
    }

    private static IfcGeometryPrimitive BuildUnknownPrimitive(IfcEntity entity)
    {
        var primitive = new IfcGeometryPrimitive
        {
            SourceId = entity.Id,
            IfcClass = entity.Type,
        };

        primitive.ReferencedSourceIds.AddRange(entity.Arguments.SelectMany(StepArgumentReader.ReadReferences).Distinct());
        return primitive;
    }

    private static IfcGeometryProfile? BuildProfile(IfcDocument document, int profileId)
    {
        if (!document.EntityById.TryGetValue(profileId, out var profileEntity))
        {
            return null;
        }

        var profile = profileEntity.Type switch
        {
            "IFCRECTANGLEPROFILEDEF" => new IfcGeometryProfile
            {
                SourceId = profileEntity.Id,
                PositionSourceId = StepArgumentReader.ReadReferences(profileEntity.Arguments.ElementAtOrDefault(2) ?? string.Empty).FirstOrDefault(),
                IfcClass = profileEntity.Type,
                Kind = "Rectangle",
                Name = ReadLabel(profileEntity.Arguments.ElementAtOrDefault(1)),
                SizeX = ReadDouble(profileEntity.Arguments.ElementAtOrDefault(3)),
                SizeY = ReadDouble(profileEntity.Arguments.ElementAtOrDefault(4)),
            },
            "IFCCIRCLEPROFILEDEF" => new IfcGeometryProfile
            {
                SourceId = profileEntity.Id,
                PositionSourceId = StepArgumentReader.ReadReferences(profileEntity.Arguments.ElementAtOrDefault(2) ?? string.Empty).FirstOrDefault(),
                IfcClass = profileEntity.Type,
                Kind = "Circle",
                Name = ReadLabel(profileEntity.Arguments.ElementAtOrDefault(1)),
                Radius = ReadDouble(profileEntity.Arguments.ElementAtOrDefault(3)),
            },
            _ => new IfcGeometryProfile
            {
                SourceId = profileEntity.Id,
                PositionSourceId = StepArgumentReader.ReadReferences(profileEntity.Arguments.ElementAtOrDefault(2) ?? string.Empty).FirstOrDefault(),
                IfcClass = profileEntity.Type,
                Name = ReadLabel(profileEntity.Arguments.ElementAtOrDefault(1)),
            },
        };

        if (profile.PositionSourceId != 0 && document.EntityById.TryGetValue(profile.PositionSourceId, out var position))
        {
            profile.PositionPointSourceId = StepArgumentReader.ReadReferences(position.Arguments.ElementAtOrDefault(0) ?? string.Empty).FirstOrDefault();
            profile.DirectionSourceId = StepArgumentReader.ReadReferences(position.Arguments.ElementAtOrDefault(1) ?? string.Empty).FirstOrDefault();
            var coordinates = ReadPointCoordinates(document, profile.PositionPointSourceId);
            profile.PositionX = coordinates.X;
            profile.PositionY = coordinates.Y;
            profile.PositionZ = coordinates.Z;
            profile.PositionRefDirection = profile.DirectionSourceId == 0
                ? IfcModelVector.UnitX
                : ReadDirection(document, profile.DirectionSourceId, IfcModelVector.UnitX);
        }

        return profile;
    }

    private static int ReadPlacementPointId(IfcDocument document, int placementId)
    {
        if (placementId == 0 || !document.EntityById.TryGetValue(placementId, out var placement))
        {
            return 0;
        }

        return StepArgumentReader.ReadReferences(placement.Arguments.ElementAtOrDefault(0) ?? string.Empty).FirstOrDefault();
    }

    private static IfcModelVector ReadPointCoordinates(IfcDocument document, int pointId)
    {
        if (pointId == 0 || !document.EntityById.TryGetValue(pointId, out var point) || point.Type != "IFCCARTESIANPOINT")
        {
            return new IfcModelVector(0, 0, 0);
        }

        var coordinates = ReadTuple(point.Arguments.FirstOrDefault() ?? string.Empty);
        return coordinates.Count switch
        {
            >= 3 => new IfcModelVector(coordinates[0], coordinates[1], coordinates[2]),
            2 => new IfcModelVector(coordinates[0], coordinates[1], 0),
            1 => new IfcModelVector(coordinates[0], 0, 0),
            _ => new IfcModelVector(0, 0, 0),
        };
    }

    private static AxisPlacement3D ReadAxisPlacement3D(IfcDocument document, int axisPlacementId)
    {
        if (axisPlacementId == 0 || !document.EntityById.TryGetValue(axisPlacementId, out var axisPlacement) || axisPlacement.Type != "IFCAXIS2PLACEMENT3D")
        {
            return new AxisPlacement3D(0, 0, IfcModelVector.UnitZ, IfcModelVector.UnitX);
        }

        var axisDirectionId = StepArgumentReader.ReadReferences(axisPlacement.Arguments.ElementAtOrDefault(1) ?? string.Empty).FirstOrDefault();
        var refDirectionId = StepArgumentReader.ReadReferences(axisPlacement.Arguments.ElementAtOrDefault(2) ?? string.Empty).FirstOrDefault();
        return new AxisPlacement3D(
            axisDirectionId,
            refDirectionId,
            axisDirectionId == 0 ? IfcModelVector.UnitZ : ReadDirection(document, axisDirectionId, IfcModelVector.UnitZ),
            refDirectionId == 0 ? IfcModelVector.UnitX : ReadDirection(document, refDirectionId, IfcModelVector.UnitX));
    }

    private static IfcModelVector ReadDirection(IfcDocument document, int directionId)
    {
        return ReadDirection(document, directionId, IfcModelVector.UnitZ);
    }

    private static IfcModelVector ReadDirection(IfcDocument document, int directionId, IfcModelVector fallback)
    {
        if (!document.EntityById.TryGetValue(directionId, out var direction) || direction.Type != "IFCDIRECTION")
        {
            return fallback;
        }

        var coordinates = ReadTuple(direction.Arguments.FirstOrDefault() ?? string.Empty);
        return coordinates.Count switch
        {
            >= 3 => new IfcModelVector(coordinates[0], coordinates[1], coordinates[2]),
            2 => new IfcModelVector(coordinates[0], coordinates[1], 0),
            1 => new IfcModelVector(coordinates[0], 0, 0),
            _ => fallback,
        };
    }

    private static List<double> ReadTuple(string value)
    {
        var trimmed = value.Trim();
        if (!trimmed.StartsWith('(') || !trimmed.EndsWith(')'))
        {
            return [];
        }

        return StepArgumentReader.SplitTopLevel(trimmed[1..^1])
            .Select(ReadDouble)
            .Where(number => number is not null)
            .Select(number => number!.Value)
            .ToList();
    }

    private static double? ReadDouble(string? value)
    {
        return double.TryParse(value?.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out var number)
            ? number
            : null;
    }

    private static string ReadLabel(string? value)
    {
        return StepArgumentReader.Unquote(value) ?? StepArgumentReader.CompactPreview(value ?? string.Empty);
    }

    private static string ReadPredefinedType(IfcEntity entity)
    {
        var raw = entity.Arguments.ElementAtOrDefault(8)?.Trim() ?? string.Empty;
        return raw is "$" or "*" ? string.Empty : raw;
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

    private static bool IsSpatial(string type)
    {
        return type is "IFCSITE" or "IFCBUILDING" or "IFCBUILDINGSTOREY" or "IFCSPACE" or "IFCFACILITY"
            or "IFCFACILITYPART" or "IFCROAD" or "IFCRAILWAY" or "IFCBRIDGE";
    }

    private static bool IsRootedEntity(string type)
    {
        return type is "IFCPROJECT" or "IFCSITE" or "IFCBUILDING" or "IFCBUILDINGSTOREY" or "IFCSPACE"
            or "IFCPROPERTYSET" or "IFCELEMENTQUANTITY" or "IFCTYPEOBJECT" or "IFCBUILDINGELEMENTPROXYTYPE"
            || IsPhysicalProduct(type)
            || type.StartsWith("IFCREL", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsResourceRelationship(string type)
    {
        return type is "IFCRELASSOCIATESMATERIAL" or "IFCRELASSOCIATESCLASSIFICATION"
            or "IFCRELASSOCIATESDOCUMENT" or "IFCRELASSOCIATESLIBRARY";
    }

    private static void AddToIndex<TKey, TValue>(Dictionary<TKey, List<TValue>> index, TKey key, TValue value)
        where TKey : notnull
    {
        if (!index.TryGetValue(key, out var bucket))
        {
            bucket = [];
            index[key] = bucket;
        }

        bucket.Add(value);
    }

    private sealed record AxisPlacement3D(
        int AxisDirectionSourceId,
        int RefDirectionSourceId,
        IfcModelVector Axis,
        IfcModelVector RefDirection);

    private sealed record MappingTransform(
        double X,
        double Y,
        double Z,
        double Scale,
        IfcModelVector Axis,
        IfcModelVector RefDirection)
    {
        public static MappingTransform Identity { get; } = new(0, 0, 0, 1, IfcModelVector.UnitZ, IfcModelVector.UnitX);
    }
}
