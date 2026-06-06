using System.Globalization;
using IFCnative.NativeWindows.Models;

namespace IFCnative.NativeWindows.Services;

public static class IfcMemoryModelEditor
{
    public sealed record PropertyValueDraft(int SourceId, string IfcClass, string Name, IfcModelValue Value);

    public sealed record ResourceDraft(int SourceId, string IfcClass, string Name, string Identification, string Description);

    public sealed record ProductDraft(
        int SourceId,
        string IfcClass,
        string GlobalId,
        string Name,
        string Description,
        string PredefinedType,
        int PlacementSourceId,
        int AxisPlacementSourceId,
        int PointSourceId,
        int? RelativeToPlacementSourceId);

    public sealed record BodyRepresentationDraft(
        int ContextSourceId,
        int ProductDefinitionShapeSourceId,
        int ShapeRepresentationSourceId,
        int SolidSourceId,
        int SolidPositionSourceId,
        int SolidPointSourceId,
        int ProfileSourceId,
        int ProfilePositionSourceId,
        int ProfilePointSourceId,
        int ExtrusionDirectionSourceId,
        int ProfileDirectionSourceId,
        double Width,
        double Depth,
        double Height,
        bool IsCylinder);

    public static IfcMemoryModel UpdatePropertyValue(IfcMemoryModel model, int propertyValueSourceId, string rawValue)
    {
        var draft = Clone(model);
        foreach (var propertyValue in draft.PropertySetsByObjectId.Values.SelectMany(sets => sets).SelectMany(set => set.Values))
        {
            if (propertyValue.SourceId != propertyValueSourceId)
            {
                continue;
            }

            propertyValue.Value = IfcMemoryModelBuilder.ParsePropertyValue(rawValue);
            return draft;
        }

        return model;
    }

    public static IfcMemoryModel UpdateRawEntity(IfcMemoryModel model, int entitySourceId, string name, string description, IEnumerable<string> rawArguments)
    {
        if (!model.ObjectsBySourceId.ContainsKey(entitySourceId))
        {
            return model;
        }

        var draft = Clone(model);
        var modelObject = draft.ObjectsBySourceId[entitySourceId];
        modelObject.RawArguments.Clear();
        modelObject.RawArguments.AddRange(rawArguments);
        modelObject.HasRawArgumentOverride = true;
        modelObject.Name = name.Trim();
        modelObject.Description = description.Trim();
        return draft;
    }

    public static IfcMemoryModel UpdatePlacement(IfcMemoryModel model, int productSourceId, string xText, string yText, string zText)
    {
        if (!model.ObjectsBySourceId.TryGetValue(productSourceId, out var product) || product.Placement is null)
        {
            return model;
        }

        var draft = Clone(model);
        var draftProduct = draft.ObjectsBySourceId[productSourceId];
        if (draftProduct.Placement is null)
        {
            return model;
        }

        draftProduct.Placement.X = ParseCoordinate(xText, product.Placement.X);
        draftProduct.Placement.Y = ParseCoordinate(yText, product.Placement.Y);
        draftProduct.Placement.Z = ParseCoordinate(zText, product.Placement.Z);
        return draft;
    }

    public static IfcMemoryModel UpdateGlobalIds(IfcMemoryModel model, IReadOnlyDictionary<int, string> replacements)
    {
        if (replacements.Count == 0 || !replacements.Keys.Any(model.ObjectsBySourceId.ContainsKey))
        {
            return model;
        }

        var draft = Clone(model);
        var changed = false;
        foreach (var replacement in replacements)
        {
            if (!draft.ObjectsBySourceId.TryGetValue(replacement.Key, out var modelObject)
                || string.IsNullOrWhiteSpace(replacement.Value)
                || modelObject.GlobalId == replacement.Value)
            {
                continue;
            }

            modelObject.GlobalId = replacement.Value;
            changed = true;
        }

        return changed ? draft : model;
    }

    public static IfcMemoryModel AssignDefaultPlacement(
        IfcMemoryModel model,
        int productSourceId,
        int placementSourceId,
        int axisPlacementSourceId,
        int pointSourceId,
        int? relativeToSourceId = null)
    {
        if (!model.ObjectsBySourceId.ContainsKey(productSourceId)
            || model.ObjectsBySourceId.ContainsKey(placementSourceId)
            || model.ObjectsBySourceId.ContainsKey(axisPlacementSourceId)
            || model.ObjectsBySourceId.ContainsKey(pointSourceId))
        {
            return model;
        }

        var draft = Clone(model);
        var draftProduct = draft.ObjectsBySourceId[productSourceId];
        draftProduct.Placement = new IfcModelPlacement
        {
            SourceId = placementSourceId,
            AxisPlacementSourceId = axisPlacementSourceId,
            PointSourceId = pointSourceId,
            RelativeToSourceId = relativeToSourceId,
            X = 0,
            Y = 0,
            Z = 0,
        };
        AddGeneratedObject(draft, placementSourceId, "IFCLOCALPLACEMENT", "Native default placement");
        AddGeneratedObject(draft, axisPlacementSourceId, "IFCAXIS2PLACEMENT3D", "Native default axis placement");
        AddGeneratedObject(draft, pointSourceId, "IFCCARTESIANPOINT", "Native default origin");
        return draft;
    }

    public static IfcMemoryModel UpdateExtrudedBodyDimensions(
        IfcMemoryModel model,
        int productSourceId,
        string widthText,
        string depthText,
        string heightText)
    {
        if (!model.ProductGeometryByProductId.TryGetValue(productSourceId, out var geometry))
        {
            return model;
        }

        var primitive = geometry.Primitives.FirstOrDefault(candidate => candidate.Kind == "ExtrudedAreaSolid" && candidate.MappedItemSourceId == 0);
        if (primitive is null)
        {
            return model;
        }

        var draft = Clone(model);
        var draftPrimitive = draft.ProductGeometryByProductId[productSourceId].Primitives.First(candidate => candidate.SourceId == primitive.SourceId);
        draftPrimitive.SizeX = Math.Max(0, ParseCoordinate(widthText, primitive.SizeX ?? 1));
        draftPrimitive.SizeY = Math.Max(0, ParseCoordinate(depthText, primitive.SizeY ?? 1));
        draftPrimitive.SizeZ = Math.Max(0, ParseCoordinate(heightText, primitive.SizeZ ?? 1));

        if (draftPrimitive.Profile is not null)
        {
            if (draftPrimitive.Profile.Kind == "Circle")
            {
                draftPrimitive.Profile.Radius = Math.Max(draftPrimitive.SizeX ?? 0, draftPrimitive.SizeY ?? 0) / 2;
            }
            else
            {
                draftPrimitive.Profile.SizeX = draftPrimitive.SizeX;
                draftPrimitive.Profile.SizeY = draftPrimitive.SizeY;
            }
        }

        return draft;
    }

    public static IfcMemoryModel AssignBodyRepresentation(
        IfcMemoryModel model,
        int productSourceId,
        BodyRepresentationDraft body)
    {
        if (!model.ObjectsBySourceId.TryGetValue(productSourceId, out var product))
        {
            return model;
        }

        var generatedIds = new[]
        {
            body.ProductDefinitionShapeSourceId,
            body.ShapeRepresentationSourceId,
            body.SolidSourceId,
            body.SolidPositionSourceId,
            body.SolidPointSourceId,
            body.ProfileSourceId,
            body.ProfilePositionSourceId,
            body.ProfilePointSourceId,
            body.ExtrusionDirectionSourceId,
            body.ProfileDirectionSourceId,
        };
        if (generatedIds.Any(id => id <= 0 || model.ObjectsBySourceId.ContainsKey(id)))
        {
            return model;
        }

        var draft = Clone(model);
        if (body.ContextSourceId > 0 && !draft.ObjectsBySourceId.ContainsKey(body.ContextSourceId))
        {
            AddGeneratedObject(draft, body.ContextSourceId, "IFCGEOMETRICREPRESENTATIONCONTEXT", "Body");
        }

        AddGeneratedObject(draft, body.ProductDefinitionShapeSourceId, "IFCPRODUCTDEFINITIONSHAPE", "Native body shape");
        AddGeneratedObject(draft, body.ShapeRepresentationSourceId, "IFCSHAPEREPRESENTATION", "Body");
        AddGeneratedObject(draft, body.SolidSourceId, "IFCEXTRUDEDAREASOLID", "Native body solid");
        AddGeneratedObject(draft, body.SolidPositionSourceId, "IFCAXIS2PLACEMENT3D", "Native body placement");
        AddGeneratedObject(draft, body.SolidPointSourceId, "IFCCARTESIANPOINT", "Native body origin");
        AddGeneratedObject(draft, body.ProfileSourceId, body.IsCylinder ? "IFCCIRCLEPROFILEDEF" : "IFCRECTANGLEPROFILEDEF", body.IsCylinder ? "Assigned Cylindrical Body" : "Assigned Rectangular Body");
        AddGeneratedObject(draft, body.ProfilePositionSourceId, "IFCAXIS2PLACEMENT2D", "Native profile placement");
        AddGeneratedObject(draft, body.ProfilePointSourceId, "IFCCARTESIANPOINT", "Native profile origin");
        AddGeneratedObject(draft, body.ExtrusionDirectionSourceId, "IFCDIRECTION", "Native extrusion direction");
        AddGeneratedObject(draft, body.ProfileDirectionSourceId, "IFCDIRECTION", "Native profile direction");

        var shape = new IfcShapeRepresentationModel
        {
            SourceId = body.ShapeRepresentationSourceId,
            ContextSourceId = body.ContextSourceId,
            Identifier = "Body",
            RepresentationType = "SweptSolid",
        };
        shape.GeometryItemSourceIds.Add(body.SolidSourceId);

        var profile = new IfcGeometryProfile
        {
            SourceId = body.ProfileSourceId,
            PositionSourceId = body.ProfilePositionSourceId,
            PositionPointSourceId = body.ProfilePointSourceId,
            DirectionSourceId = body.ProfileDirectionSourceId,
            IfcClass = body.IsCylinder ? "IFCCIRCLEPROFILEDEF" : "IFCRECTANGLEPROFILEDEF",
            Kind = body.IsCylinder ? "Circle" : "Rectangle",
            Name = body.IsCylinder ? "Assigned Cylindrical Body" : "Assigned Rectangular Body",
            SizeX = body.IsCylinder ? null : body.Width,
            SizeY = body.IsCylinder ? null : body.Depth,
            Radius = body.IsCylinder ? Math.Max(body.Width, body.Depth) / 2 : null,
        };

        var primitive = new IfcGeometryPrimitive
        {
            SourceId = body.SolidSourceId,
            IfcClass = "IFCEXTRUDEDAREASOLID",
            Kind = "ExtrudedAreaSolid",
            Profile = profile,
            PositionSourceId = body.SolidPositionSourceId,
            PositionPointSourceId = body.SolidPointSourceId,
            DirectionSourceId = body.ExtrusionDirectionSourceId,
            SizeX = body.Width,
            SizeY = body.Depth,
            SizeZ = body.Height,
            Direction = IfcModelVector.UnitZ,
        };
        primitive.ReferencedSourceIds.AddRange([
            body.ProfileSourceId,
            body.SolidPositionSourceId,
            body.ExtrusionDirectionSourceId,
            body.ProfilePositionSourceId,
            body.ProfilePointSourceId,
            body.ProfileDirectionSourceId,
        ]);

        var geometry = new IfcProductGeometry
        {
            ProductSourceId = productSourceId,
            ProductDefinitionShapeSourceId = body.ProductDefinitionShapeSourceId,
        };
        geometry.ShapeRepresentations.Add(shape);
        geometry.Primitives.Add(primitive);
        draft.ProductGeometryByProductId[productSourceId] = geometry;
        draft.ObjectsBySourceId[productSourceId].Geometry = geometry;
        return draft;
    }

    public static IfcMemoryModel AddProductObject(IfcMemoryModel model, ProductDraft product)
    {
        var generatedIds = new[] { product.SourceId, product.PlacementSourceId, product.AxisPlacementSourceId, product.PointSourceId };
        if (generatedIds.Any(id => id <= 0 || model.ObjectsBySourceId.ContainsKey(id)))
        {
            return model;
        }

        var draft = Clone(model);
        var modelObject = new IfcModelObject
        {
            SourceId = product.SourceId,
            IfcClass = product.IfcClass,
            GlobalId = product.GlobalId,
            Name = product.Name,
            Description = product.Description,
            PredefinedType = product.PredefinedType,
            IsPhysicalProduct = IsPhysicalProduct(product.IfcClass),
            Placement = new IfcModelPlacement
            {
                SourceId = product.PlacementSourceId,
                AxisPlacementSourceId = product.AxisPlacementSourceId,
                PointSourceId = product.PointSourceId,
                RelativeToSourceId = product.RelativeToPlacementSourceId,
                X = 0,
                Y = 0,
                Z = 0,
            },
        };
        draft.Objects.Add(modelObject);
        draft.ObjectsBySourceId[modelObject.SourceId] = modelObject;
        AddToIndex(draft.ObjectsByClass, modelObject.IfcClass, modelObject);
        AddGeneratedObject(draft, product.PlacementSourceId, "IFCLOCALPLACEMENT", "Native product placement");
        AddGeneratedObject(draft, product.AxisPlacementSourceId, "IFCAXIS2PLACEMENT3D", "Native product axis placement");
        AddGeneratedObject(draft, product.PointSourceId, "IFCCARTESIANPOINT", "Native product origin");
        return draft;
    }

    public static IfcMemoryModel AddRelation(
        IfcMemoryModel model,
        int relationshipSourceId,
        string ifcClass,
        string name,
        IEnumerable<int> sourceObjectIds,
        IEnumerable<int> targetObjectIds)
    {
        if (model.Relations.Any(relation => relation.SourceId == relationshipSourceId))
        {
            return model;
        }

        var sourceIds = sourceObjectIds.Where(model.ObjectsBySourceId.ContainsKey).Distinct().ToList();
        var targetIds = targetObjectIds.Where(model.ObjectsBySourceId.ContainsKey).Distinct().ToList();
        if (sourceIds.Count == 0 || targetIds.Count == 0)
        {
            return model;
        }

        var draft = Clone(model);
        var relation = new IfcModelRelation
        {
            SourceId = relationshipSourceId,
            IfcClass = ifcClass,
            Name = name,
        };
        relation.SourceObjectIds.AddRange(sourceIds);
        relation.TargetObjectIds.AddRange(targetIds);
        draft.Relations.Add(relation);
        RebuildDerivedIndexes(draft);
        return draft;
    }

    public static IfcMemoryModel UpdateRelationEndpoints(
        IfcMemoryModel model,
        int relationshipSourceId,
        IEnumerable<int> sourceObjectIds,
        IEnumerable<int> targetObjectIds)
    {
        var relation = model.Relations.FirstOrDefault(relation => relation.SourceId == relationshipSourceId);
        if (relation is null)
        {
            return model;
        }

        var sourceIds = sourceObjectIds.Where(model.ObjectsBySourceId.ContainsKey).Distinct().ToList();
        var targetIds = targetObjectIds.Where(model.ObjectsBySourceId.ContainsKey).Distinct().ToList();
        if (sourceIds.Count == 0 || targetIds.Count == 0)
        {
            return model;
        }

        var draft = Clone(model);
        var draftRelation = draft.Relations.First(candidate => candidate.SourceId == relationshipSourceId);
        draftRelation.SourceObjectIds.Clear();
        draftRelation.SourceObjectIds.AddRange(sourceIds);
        draftRelation.TargetObjectIds.Clear();
        draftRelation.TargetObjectIds.AddRange(targetIds);
        RebuildDerivedIndexes(draft);
        return draft;
    }

    public static IfcMemoryModel RemoveRelation(IfcMemoryModel model, int relationshipSourceId)
    {
        if (!model.Relations.Any(relation => relation.SourceId == relationshipSourceId))
        {
            return model;
        }

        var draft = Clone(model);
        draft.Relations.RemoveAll(relation => relation.SourceId == relationshipSourceId);
        RebuildDerivedIndexes(draft);
        return draft;
    }

    public static IfcMemoryModel AddPropertySetAssignment(
        IfcMemoryModel model,
        int productSourceId,
        int propertySetSourceId,
        string kind,
        string name,
        IEnumerable<PropertyValueDraft> values,
        int relationshipSourceId,
        string relationshipName)
    {
        if (!model.ObjectsBySourceId.ContainsKey(productSourceId)
            || model.PropertySetBySourceId.ContainsKey(propertySetSourceId)
            || model.Relations.Any(relation => relation.SourceId == relationshipSourceId))
        {
            return model;
        }

        var valueDrafts = values.ToList();
        if (valueDrafts.Count == 0 || valueDrafts.Any(value => model.ObjectsBySourceId.ContainsKey(value.SourceId)))
        {
            return model;
        }

        var propertySetClass = kind.Equals("Qto", StringComparison.OrdinalIgnoreCase)
            ? "IFCELEMENTQUANTITY"
            : "IFCPROPERTYSET";
        var draft = Clone(model);
        var propertySetObject = new IfcModelObject
        {
            SourceId = propertySetSourceId,
            IfcClass = propertySetClass,
            GlobalId = MakeGeneratedGlobalId(kind, propertySetSourceId),
            Name = name,
        };
        draft.Objects.Add(propertySetObject);
        draft.ObjectsBySourceId[propertySetObject.SourceId] = propertySetObject;
        AddToIndex(draft.ObjectsByClass, propertySetObject.IfcClass, propertySetObject);

        var propertySet = new IfcModelPropertySet
        {
            SourceId = propertySetSourceId,
            Kind = kind,
            Name = name,
        };
        foreach (var value in valueDrafts)
        {
            var valueObject = new IfcModelObject
            {
                SourceId = value.SourceId,
                IfcClass = value.IfcClass,
                Name = value.Name,
            };
            draft.Objects.Add(valueObject);
            draft.ObjectsBySourceId[valueObject.SourceId] = valueObject;
            AddToIndex(draft.ObjectsByClass, valueObject.IfcClass, valueObject);
            propertySet.Values.Add(new IfcModelPropertyValue
            {
                SourceId = value.SourceId,
                IfcClass = value.IfcClass,
                Name = value.Name,
                Value = value.Value,
            });
        }

        draft.PropertySetBySourceId[propertySet.SourceId] = propertySet;
        var relation = new IfcModelRelation
        {
            SourceId = relationshipSourceId,
            IfcClass = "IFCRELDEFINESBYPROPERTIES",
            Name = relationshipName,
        };
        relation.SourceObjectIds.Add(propertySetSourceId);
        relation.TargetObjectIds.Add(productSourceId);
        draft.Relations.Add(relation);
        RebuildDerivedIndexes(draft);
        return draft;
    }

    public static IfcMemoryModel AddResourceAssignment(
        IfcMemoryModel model,
        int productSourceId,
        ResourceDraft resourceDraft,
        int relationshipSourceId,
        string relationshipType,
        string relationshipName)
    {
        if (!model.ObjectsBySourceId.ContainsKey(productSourceId)
            || model.ObjectsBySourceId.ContainsKey(resourceDraft.SourceId)
            || model.ResourceBySourceId.ContainsKey(resourceDraft.SourceId)
            || model.Relations.Any(relation => relation.SourceId == relationshipSourceId))
        {
            return model;
        }

        var draft = Clone(model);
        var resourceObject = new IfcModelObject
        {
            SourceId = resourceDraft.SourceId,
            IfcClass = resourceDraft.IfcClass,
            Name = resourceDraft.Name,
            Description = resourceDraft.Description,
        };
        draft.Objects.Add(resourceObject);
        draft.ObjectsBySourceId[resourceObject.SourceId] = resourceObject;
        AddToIndex(draft.ObjectsByClass, resourceObject.IfcClass, resourceObject);

        var resource = new IfcModelResource
        {
            SourceId = resourceDraft.SourceId,
            IfcClass = resourceDraft.IfcClass,
            Name = resourceDraft.Name,
            Identification = resourceDraft.Identification,
            Description = resourceDraft.Description,
        };
        draft.ResourceBySourceId[resource.SourceId] = resource;

        var relation = new IfcModelRelation
        {
            SourceId = relationshipSourceId,
            IfcClass = relationshipType,
            Name = relationshipName,
        };
        relation.SourceObjectIds.Add(resource.SourceId);
        relation.TargetObjectIds.Add(productSourceId);
        draft.Relations.Add(relation);
        RebuildDerivedIndexes(draft);
        return draft;
    }

    public static IfcMemoryModel Clone(IfcMemoryModel model)
    {
        var clone = new IfcMemoryModel
        {
            FileName = model.FileName,
            Schema = model.Schema,
        };

        foreach (var modelObject in model.Objects)
        {
            var clonedObject = CloneObjectWithoutLinks(modelObject);
            clone.Objects.Add(clonedObject);
            clone.ObjectsBySourceId[clonedObject.SourceId] = clonedObject;
            AddToIndex(clone.ObjectsByClass, clonedObject.IfcClass, clonedObject);
        }

        foreach (var relation in model.Relations)
        {
            var clonedRelation = CloneRelation(relation);
            clone.Relations.Add(clonedRelation);
        }

        foreach (var entry in model.PropertySetBySourceId)
        {
            clone.PropertySetBySourceId[entry.Key] = ClonePropertySet(entry.Value);
        }

        foreach (var entry in model.ResourceBySourceId)
        {
            clone.ResourceBySourceId[entry.Key] = CloneResource(entry.Value);
        }

        foreach (var entry in model.PropertySetsByObjectId)
        {
            if (!clone.ObjectsBySourceId.TryGetValue(entry.Key, out var clonedObject))
            {
                continue;
            }

            foreach (var propertySet in entry.Value)
            {
                var clonedSet = ClonePropertySet(propertySet);
                clonedObject.PropertySets.Add(clonedSet);
                AddToIndex(clone.PropertySetsByObjectId, entry.Key, clonedSet);
            }
        }

        foreach (var modelObject in model.Objects)
        {
            if (!clone.ObjectsBySourceId.TryGetValue(modelObject.SourceId, out var clonedObject))
            {
                continue;
            }

            if (modelObject.Geometry is not null)
            {
                var clonedGeometry = CloneGeometry(modelObject.Geometry);
                clonedObject.Geometry = clonedGeometry;
                clone.ProductGeometryByProductId[clonedGeometry.ProductSourceId] = clonedGeometry;
            }
        }

        RebuildDerivedIndexes(clone);
        return clone;
    }

    private static void RebuildDerivedIndexes(IfcMemoryModel model)
    {
        model.RelationsByObjectId.Clear();
        model.PropertySetsByObjectId.Clear();
        model.ResourcesByObjectId.Clear();

        foreach (var modelObject in model.Objects)
        {
            modelObject.Relations.Clear();
            modelObject.PropertySets.Clear();
            modelObject.Resources.Clear();
        }

        foreach (var relation in model.Relations)
        {
            foreach (var objectId in relation.SourceObjectIds.Concat(relation.TargetObjectIds).Distinct())
            {
                AddToIndex(model.RelationsByObjectId, objectId, relation);
                if (model.ObjectsBySourceId.TryGetValue(objectId, out var modelObject))
                {
                    modelObject.Relations.Add(relation);
                }
            }
        }

        foreach (var relation in model.Relations.Where(relation => relation.IfcClass == "IFCRELDEFINESBYPROPERTIES"))
        {
            foreach (var propertySetId in relation.SourceObjectIds)
            {
                if (!model.PropertySetBySourceId.TryGetValue(propertySetId, out var propertySet))
                {
                    continue;
                }

                foreach (var objectId in relation.TargetObjectIds)
                {
                    if (!model.ObjectsBySourceId.TryGetValue(objectId, out var modelObject))
                    {
                        continue;
                    }

                    modelObject.PropertySets.Add(propertySet);
                    AddToIndex(model.PropertySetsByObjectId, objectId, propertySet);
                }
            }
        }

        foreach (var relation in model.Relations.Where(relation => IsResourceRelationship(relation.IfcClass)))
        {
            foreach (var resourceId in relation.SourceObjectIds)
            {
                if (!model.ResourceBySourceId.TryGetValue(resourceId, out var resource))
                {
                    continue;
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

    private static IfcModelObject CloneObjectWithoutLinks(IfcModelObject modelObject)
    {
        var clone = new IfcModelObject
        {
            SourceId = modelObject.SourceId,
            IfcClass = modelObject.IfcClass,
            GlobalId = modelObject.GlobalId,
            Name = modelObject.Name,
            Description = modelObject.Description,
            PredefinedType = modelObject.PredefinedType,
            IsSpatial = modelObject.IsSpatial,
            IsPhysicalProduct = modelObject.IsPhysicalProduct,
            SpatialPath = modelObject.SpatialPath,
            Placement = modelObject.Placement is null ? null : ClonePlacement(modelObject.Placement),
        };
        clone.RawArguments.AddRange(modelObject.RawArguments);
        clone.HasRawArgumentOverride = modelObject.HasRawArgumentOverride;
        return clone;
    }

    private static IfcModelPlacement ClonePlacement(IfcModelPlacement placement)
    {
        return new IfcModelPlacement
        {
            SourceId = placement.SourceId,
            AxisPlacementSourceId = placement.AxisPlacementSourceId,
            PointSourceId = placement.PointSourceId,
            AxisDirectionSourceId = placement.AxisDirectionSourceId,
            RefDirectionSourceId = placement.RefDirectionSourceId,
            RelativeToSourceId = placement.RelativeToSourceId,
            X = placement.X,
            Y = placement.Y,
            Z = placement.Z,
            Axis = placement.Axis,
            RefDirection = placement.RefDirection,
        };
    }

    private static IfcModelRelation CloneRelation(IfcModelRelation relation)
    {
        var clone = new IfcModelRelation
        {
            SourceId = relation.SourceId,
            IfcClass = relation.IfcClass,
            Name = relation.Name,
        };
        clone.SourceObjectIds.AddRange(relation.SourceObjectIds);
        clone.TargetObjectIds.AddRange(relation.TargetObjectIds);
        return clone;
    }

    private static IfcModelPropertySet ClonePropertySet(IfcModelPropertySet propertySet)
    {
        var clone = new IfcModelPropertySet
        {
            SourceId = propertySet.SourceId,
            Kind = propertySet.Kind,
            Name = propertySet.Name,
        };

        foreach (var value in propertySet.Values)
        {
            clone.Values.Add(new IfcModelPropertyValue
            {
                SourceId = value.SourceId,
                IfcClass = value.IfcClass,
                Name = value.Name,
                Value = value.Value,
            });
        }

        return clone;
    }

    private static IfcModelResource CloneResource(IfcModelResource resource)
    {
        return new IfcModelResource
        {
            SourceId = resource.SourceId,
            IfcClass = resource.IfcClass,
            Name = resource.Name,
            Identification = resource.Identification,
            Description = resource.Description,
        };
    }

    private static IfcProductGeometry CloneGeometry(IfcProductGeometry geometry)
    {
        var clone = new IfcProductGeometry
        {
            ProductSourceId = geometry.ProductSourceId,
            ProductDefinitionShapeSourceId = geometry.ProductDefinitionShapeSourceId,
        };

        foreach (var shape in geometry.ShapeRepresentations)
        {
            var clonedShape = new IfcShapeRepresentationModel
            {
                SourceId = shape.SourceId,
                ContextSourceId = shape.ContextSourceId,
                Identifier = shape.Identifier,
                RepresentationType = shape.RepresentationType,
            };
            clonedShape.GeometryItemSourceIds.AddRange(shape.GeometryItemSourceIds);
            clone.ShapeRepresentations.Add(clonedShape);
        }

        foreach (var primitive in geometry.Primitives)
        {
            clone.Primitives.Add(ClonePrimitive(primitive));
        }

        return clone;
    }

    private static IfcGeometryPrimitive ClonePrimitive(IfcGeometryPrimitive primitive)
    {
        var clone = new IfcGeometryPrimitive
        {
            SourceId = primitive.SourceId,
            IfcClass = primitive.IfcClass,
            Kind = primitive.Kind,
            IsMissingReference = primitive.IsMissingReference,
            Profile = primitive.Profile is null ? null : CloneProfile(primitive.Profile),
            PositionSourceId = primitive.PositionSourceId,
            PositionPointSourceId = primitive.PositionPointSourceId,
            DirectionSourceId = primitive.DirectionSourceId,
            MappedItemSourceId = primitive.MappedItemSourceId,
            MappedGeometrySourceId = primitive.MappedGeometrySourceId,
            MappingX = primitive.MappingX,
            MappingY = primitive.MappingY,
            MappingZ = primitive.MappingZ,
            MappingScale = primitive.MappingScale,
            MappingAxis = primitive.MappingAxis,
            MappingRefDirection = primitive.MappingRefDirection,
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

    private static double ParseCoordinate(string value, double fallback)
    {
        return double.TryParse(value.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out var number)
            ? number
            : fallback;
    }

    private static string MakeGeneratedGlobalId(string prefix, int id)
    {
        var raw = $"IFCnative{prefix}{id:000000000000}";
        return raw.Length <= 22 ? raw : raw[..22];
    }

    private static bool IsResourceRelationship(string type)
    {
        return type is "IFCRELASSOCIATESMATERIAL" or "IFCRELASSOCIATESCLASSIFICATION"
            or "IFCRELASSOCIATESDOCUMENT" or "IFCRELASSOCIATESLIBRARY";
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

    private static void AddGeneratedObject(IfcMemoryModel model, int sourceId, string ifcClass, string name)
    {
        if (model.ObjectsBySourceId.ContainsKey(sourceId))
        {
            return;
        }

        var modelObject = new IfcModelObject
        {
            SourceId = sourceId,
            IfcClass = ifcClass,
            Name = name,
        };
        model.Objects.Add(modelObject);
        model.ObjectsBySourceId[modelObject.SourceId] = modelObject;
        AddToIndex(model.ObjectsByClass, modelObject.IfcClass, modelObject);
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
}
