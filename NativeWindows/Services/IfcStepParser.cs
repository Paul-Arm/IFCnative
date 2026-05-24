using System.Globalization;
using System.Text.RegularExpressions;
using IFCnative.NativeWindows;
using IFCnative.NativeWindows.Models;

namespace IFCnative.NativeWindows.Services;

public static partial class IfcStepParser
{
    public static IfcDocument Parse(string text, string fileName)
    {
        var document = new IfcDocument
        {
            FileName = fileName,
            HeaderText = ExtractSection(text, "HEADER") ?? DefaultHeader(fileName),
            Schema = ExtractSchema(text) ?? "UNKNOWN",
        };

        RunPreflight(text, document.Diagnostics);

        var data = ExtractSection(text, "DATA");
        if (data is null)
        {
            document.Diagnostics.Error("DATA section was not found.");
            return document;
        }

        foreach (var entity in ReadEntities(data, document.Diagnostics))
        {
            if (document.EntityById.ContainsKey(entity.Id))
            {
                document.Diagnostics.Warn($"Skipped duplicate STEP entity #{entity.Id}; keeping first parsed entity.");
                continue;
            }

            document.Entities.Add(entity);
            document.EntityById[entity.Id] = entity;

            if (!document.EntitiesByType.TryGetValue(entity.Type, out var bucket))
            {
                bucket = [];
                document.EntitiesByType[entity.Type] = bucket;
            }

            bucket.Add(entity);

            foreach (var argument in entity.Arguments)
            {
                foreach (var targetId in StepArgumentReader.ReadReferences(argument))
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

        BuildRelationshipIndex(document);
        BuildPropertyAndResourceIndexes(document);
        BuildPlacementIndex(document);
        BuildRepresentationIndex(document);
        BuildSpatialTree(document);
        ValidateDocument(document);
        document.Diagnostics.Info($"Loaded {document.Entities.Count:N0} STEP entities.");
        document.Diagnostics.Info($"Indexed {document.RelationshipById.Count:N0} IFC relationships.");
        document.Diagnostics.Info($"Indexed {document.PropertySetById.Count:N0} property/quantity sets.");
        document.Diagnostics.Info($"Indexed {document.PlacementsByEntity.Count:N0} product placements.");
        document.Diagnostics.Info($"Indexed {document.RepresentationsByEntity.Count:N0} product representations.");
        document.Diagnostics.Info($"Detected schema: {document.Schema}.");

        return document;
    }

    public static IfcDocument CreateSample()
    {
        return Parse(SampleIfcText, "IFCnative Native Sample.ifc");
    }

    private static void RunPreflight(string text, IfcDiagnostics diagnostics)
    {
        if (!text.TrimStart().StartsWith("ISO-10303-21;", StringComparison.OrdinalIgnoreCase))
        {
            diagnostics.Error("File does not start with ISO-10303-21.");
        }

        if (!text.Contains("HEADER;", StringComparison.OrdinalIgnoreCase))
        {
            diagnostics.Error("HEADER section is missing.");
        }

        if (!text.Contains("DATA;", StringComparison.OrdinalIgnoreCase))
        {
            diagnostics.Error("DATA section is missing.");
        }

        if (!text.TrimEnd().EndsWith("END-ISO-10303-21;", StringComparison.OrdinalIgnoreCase))
        {
            diagnostics.Error("File does not end with END-ISO-10303-21.");
        }
    }

    private static string? ExtractSection(string text, string sectionName)
    {
        var pattern = $@"{sectionName}\s*;(.*?)ENDSEC\s*;";
        var match = Regex.Match(text, pattern, RegexOptions.IgnoreCase | RegexOptions.Singleline);
        return match.Success ? $"{sectionName.ToUpperInvariant()};{match.Groups[1].Value}ENDSEC;" : null;
    }

    private static string? ExtractSchema(string text)
    {
        var match = SchemaRegex().Match(text);
        return match.Success ? match.Groups[1].Value.Trim().Trim('\'') : null;
    }

    private static IEnumerable<IfcEntity> ReadEntities(string data, IfcDiagnostics diagnostics)
    {
        var index = 0;
        while (index < data.Length)
        {
            SkipWhitespaceAndComments(data, ref index);
            if (index >= data.Length)
            {
                yield break;
            }

            if (data[index] != '#')
            {
                index++;
                continue;
            }

            var entityStart = index;
            var idStart = ++index;
            while (index < data.Length && char.IsDigit(data[index]))
            {
                index++;
            }

            if (!int.TryParse(data[idStart..index], out var id))
            {
                diagnostics.Warn($"Skipped malformed STEP id near offset {idStart}.");
                continue;
            }

            SkipWhitespaceAndComments(data, ref index);
            if (index >= data.Length || data[index] != '=')
            {
                diagnostics.Warn($"Skipped #{id}; missing '='.");
                continue;
            }

            index++;
            SkipWhitespaceAndComments(data, ref index);

            var typeStart = index;
            while (index < data.Length && (char.IsLetterOrDigit(data[index]) || data[index] == '_'))
            {
                index++;
            }

            var type = data[typeStart..index].Trim().ToUpperInvariant();
            if (string.IsNullOrWhiteSpace(type))
            {
                diagnostics.Warn($"Skipped #{id}; missing entity type.");
                continue;
            }

            SkipWhitespaceAndComments(data, ref index);

            if (index >= data.Length || data[index] != '(')
            {
                diagnostics.Warn($"Skipped #{id}; missing argument list.");
                continue;
            }

            if (!TryReadParenthesized(data, ref index, out var args))
            {
                diagnostics.Warn($"Skipped #{id}; unterminated argument list.");
                continue;
            }

            var terminator = ReadEntityTerminator(data, ref index);
            if (!terminator.HasSemicolon)
            {
                diagnostics.Warn($"Parsed #{id}; missing terminating ';' before next STEP entity.");
            }
            else if (terminator.HasUnexpectedTrailingText)
            {
                diagnostics.Warn($"Parsed #{id}; ignored unexpected text between argument list and terminating ';'.");
            }

            var originalStepLine = terminator is { HasSemicolon: true, HasUnexpectedTrailingText: false }
                ? data[entityStart..index].Trim()
                : null;
            var entity = new IfcEntity { Id = id, Type = type, OriginalStepLine = originalStepLine };
            entity.Arguments.AddRange(StepArgumentReader.SplitTopLevel(args));
            entity.OriginalArguments.AddRange(entity.Arguments);
            yield return entity;
        }
    }

    private static void SkipWhitespaceAndComments(string text, ref int index)
    {
        while (index < text.Length)
        {
            if (char.IsWhiteSpace(text[index]))
            {
                index++;
                continue;
            }

            if (index + 1 < text.Length && text[index] == '/' && text[index + 1] == '*')
            {
                index += 2;
                while (index + 1 < text.Length && (text[index] != '*' || text[index + 1] != '/'))
                {
                    index++;
                }

                index = Math.Min(text.Length, index + 2);
                continue;
            }

            break;
        }
    }

    private static EntityTerminator ReadEntityTerminator(string text, ref int index)
    {
        var hasUnexpectedTrailingText = false;
        while (index < text.Length)
        {
            if (char.IsWhiteSpace(text[index]))
            {
                index++;
                continue;
            }

            if (index + 1 < text.Length && text[index] == '/' && text[index + 1] == '*')
            {
                SkipWhitespaceAndComments(text, ref index);
                continue;
            }

            if (text[index] == ';')
            {
                index++;
                return new EntityTerminator(true, hasUnexpectedTrailingText);
            }

            if (text[index] == '#')
            {
                return new EntityTerminator(false, hasUnexpectedTrailingText);
            }

            hasUnexpectedTrailingText = true;
            index++;
        }

        return new EntityTerminator(false, hasUnexpectedTrailingText);
    }

    private readonly record struct EntityTerminator(bool HasSemicolon, bool HasUnexpectedTrailingText);

    private static bool TryReadParenthesized(string text, ref int index, out string value)
    {
        var start = index + 1;
        var depth = 0;
        var inString = false;

        for (; index < text.Length; index++)
        {
            var character = text[index];
            if (character == '\'')
            {
                if (inString && index + 1 < text.Length && text[index + 1] == '\'')
                {
                    index++;
                    continue;
                }

                inString = !inString;
                continue;
            }

            if (inString)
            {
                continue;
            }

            if (character == '(')
            {
                depth++;
            }
            else if (character == ')')
            {
                depth--;
                if (depth == 0)
                {
                    value = text[start..index];
                    index++;
                    return true;
                }
            }
            else if (character == ';' && depth <= 1)
            {
                value = text[start..index];
                index++;
                return false;
            }
        }

        value = text[start..];
        return false;
    }

    private static void BuildRelationshipIndex(IfcDocument document)
    {
        foreach (var entity in document.Entities.Where(entity => entity.Type.StartsWith("IFCREL", StringComparison.OrdinalIgnoreCase)))
        {
            var relationship = CreateRelationship(entity);
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

    private static IfcRelationship CreateRelationship(IfcEntity entity)
    {
        var relationship = new IfcRelationship { Id = entity.Id, Type = entity.Type };

        switch (entity.Type)
        {
            case "IFCRELAGGREGATES":
            case "IFCRELNESTS":
                AddRefs(relationship.SourceIds, entity, 4);
                AddRefs(relationship.TargetIds, entity, 5);
                break;
            case "IFCRELCONTAINEDINSPATIALSTRUCTURE":
            case "IFCRELREFERENCEDINSPATIALSTRUCTURE":
                AddRefs(relationship.SourceIds, entity, 5);
                AddRefs(relationship.TargetIds, entity, 4);
                break;
            case "IFCRELDEFINESBYPROPERTIES":
            case "IFCRELDEFINESBYTYPE":
            case "IFCRELASSIGNSTOGROUP":
            case "IFCRELASSIGNSTOPROCESS":
            case "IFCRELASSIGNSTOCONTROL":
            case "IFCRELASSIGNSTOPRODUCT":
            case "IFCRELASSOCIATESMATERIAL":
            case "IFCRELASSOCIATESCLASSIFICATION":
            case "IFCRELASSOCIATESDOCUMENT":
            case "IFCRELASSOCIATESLIBRARY":
                AddRefs(relationship.SourceIds, entity, 5);
                AddRefs(relationship.TargetIds, entity, 4);
                break;
            case "IFCRELVOIDSELEMENT":
            case "IFCRELFILLSELEMENT":
            case "IFCRELCONNECTSPORTS":
            case "IFCRELCONNECTSPORTTOELEMENT":
            case "IFCRELINTERFERESELEMENTS":
            case "IFCRELPROJECTSELEMENT":
                AddRefs(relationship.SourceIds, entity, 4);
                AddRefs(relationship.TargetIds, entity, 5);
                break;
            case "IFCRELCONNECTSELEMENTS":
                AddRefs(relationship.SourceIds, entity, 5);
                AddRefs(relationship.TargetIds, entity, 6);
                break;
            default:
                foreach (var id in entity.Arguments.SelectMany(StepArgumentReader.ReadReferences).Distinct())
                {
                    relationship.TargetIds.Add(id);
                }
                break;
        }

        return relationship;
    }

    private static void AddRefs(List<int> target, IfcEntity entity, int argumentIndex)
    {
        target.AddRange(StepArgumentReader.ReadReferences(entity.Arguments.ElementAtOrDefault(argumentIndex) ?? string.Empty));
    }

    private static void BuildPropertyAndResourceIndexes(IfcDocument document)
    {
        foreach (var propertySetEntity in document.Entities.Where(entity => entity.Type is "IFCPROPERTYSET" or "IFCELEMENTQUANTITY"))
        {
            var propertySet = CreatePropertySet(document, propertySetEntity);
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

        foreach (var unitAssignment in document.Entities.Where(entity => entity.Type == "IFCUNITASSIGNMENT"))
        {
            foreach (var unitId in StepArgumentReader.ReadReferences(unitAssignment.Arguments.FirstOrDefault() ?? string.Empty))
            {
                if (document.EntityById.TryGetValue(unitId, out var unit))
                {
                    document.Units.Add($"#{unit.Id} {unit.Type}: {StepArgumentReader.CompactPreview(string.Join(",", unit.Arguments))}");
                }
            }
        }
    }

    private static IfcPropertySet CreatePropertySet(IfcDocument document, IfcEntity propertySetEntity)
    {
        var propertySet = new IfcPropertySet
        {
            Id = propertySetEntity.Id,
            Kind = propertySetEntity.Type == "IFCELEMENTQUANTITY" ? "Qto" : "Pset",
            Name = ReadEntityLabel(propertySetEntity),
        };

        var valueArgumentIndex = propertySetEntity.Type == "IFCELEMENTQUANTITY" ? 5 : 4;
        foreach (var valueId in StepArgumentReader.ReadReferences(propertySetEntity.Arguments.ElementAtOrDefault(valueArgumentIndex) ?? string.Empty))
        {
            if (!document.EntityById.TryGetValue(valueId, out var valueEntity))
            {
                continue;
            }

            propertySet.Values.Add(new IfcPropertyValue
            {
                Id = valueEntity.Id,
                Type = valueEntity.Type,
                Name = ReadEntityLabel(valueEntity),
                Value = ReadPropertyDisplayValue(valueEntity),
            });
        }

        return propertySet;
    }

    private static string ReadEntityLabel(IfcEntity entity)
    {
        var label = entity.Type switch
        {
            "IFCMATERIAL" => FirstLabelArgument(entity, 0),
            "IFCCLASSIFICATIONREFERENCE" or "IFCLIBRARYREFERENCE" => FirstLabelArgument(entity, 2, 1, 0),
            "IFCDOCUMENTREFERENCE" => FirstLabelArgument(entity, 2, 0),
            _ => FirstLabelArgument(entity, DefaultLabelArgumentIndex(entity)),
        };

        return label ?? entity.Name;
    }

    private static int DefaultLabelArgumentIndex(IfcEntity entity)
    {
        return entity.Type switch
        {
            "IFCPROPERTYSET" or "IFCELEMENTQUANTITY" => 2,
            "IFCPROPERTYSINGLEVALUE" => 0,
            "IFCQUANTITYLENGTH" or "IFCQUANTITYAREA" or "IFCQUANTITYVOLUME" or "IFCQUANTITYCOUNT" or "IFCQUANTITYWEIGHT" or "IFCQUANTITYTIME" => 0,
            _ => 2,
        };
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

    private static string ReadPropertyDisplayValue(IfcEntity valueEntity)
    {
        return valueEntity.Type switch
        {
            "IFCPROPERTYSINGLEVALUE" => StepArgumentReader.CompactPreview(valueEntity.Arguments.ElementAtOrDefault(2) ?? string.Empty),
            "IFCQUANTITYLENGTH" or "IFCQUANTITYAREA" or "IFCQUANTITYVOLUME" or "IFCQUANTITYCOUNT" or "IFCQUANTITYWEIGHT" or "IFCQUANTITYTIME" => StepArgumentReader.CompactPreview(valueEntity.Arguments.ElementAtOrDefault(3) ?? string.Empty),
            _ => StepArgumentReader.CompactPreview(string.Join(",", valueEntity.Arguments)),
        };
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

    private static void BuildPlacementIndex(IfcDocument document)
    {
        foreach (var product in document.Entities.Where(entity => entity.Arguments.Count > 5))
        {
            var placementId = StepArgumentReader.ReadReferences(product.Arguments[5]).FirstOrDefault();
            if (placementId == 0 || !document.EntityById.TryGetValue(placementId, out var placement) || placement.Type != "IFCLOCALPLACEMENT")
            {
                continue;
            }

            var axisPlacementId = StepArgumentReader.ReadReferences(placement.Arguments.ElementAtOrDefault(1) ?? string.Empty).FirstOrDefault();
            if (axisPlacementId == 0 || !document.EntityById.TryGetValue(axisPlacementId, out var axisPlacement) || axisPlacement.Type != "IFCAXIS2PLACEMENT3D")
            {
                continue;
            }

            var pointId = StepArgumentReader.ReadReferences(axisPlacement.Arguments.FirstOrDefault() ?? string.Empty).FirstOrDefault();
            if (pointId == 0 || !document.EntityById.TryGetValue(pointId, out var point) || point.Type != "IFCCARTESIANPOINT")
            {
                continue;
            }

            var coordinates = ReadCoordinateTuple(point.Arguments.FirstOrDefault() ?? string.Empty);
            if (coordinates is null)
            {
                continue;
            }

            var relativeToId = StepArgumentReader.ReadReferences(placement.Arguments.FirstOrDefault() ?? string.Empty).FirstOrDefault();
            document.PlacementsByEntity[product.Id] = new IfcPlacementSummary
            {
                ProductId = product.Id,
                PlacementId = placement.Id,
                RelativeToId = relativeToId == 0 ? null : relativeToId,
                AxisPlacementId = axisPlacement.Id,
                PointId = point.Id,
                X = coordinates.Value.X,
                Y = coordinates.Value.Y,
                Z = coordinates.Value.Z,
            };
        }
    }

    private static (double X, double Y, double Z)? ReadCoordinateTuple(string value)
    {
        var trimmed = value.Trim();
        if (!trimmed.StartsWith('(') || !trimmed.EndsWith(')'))
        {
            return null;
        }

        var parts = StepArgumentReader.SplitTopLevel(trimmed[1..^1]);
        if (parts.Count < 3)
        {
            return null;
        }

        return double.TryParse(parts[0], NumberStyles.Float, CultureInfo.InvariantCulture, out var x)
            && double.TryParse(parts[1], NumberStyles.Float, CultureInfo.InvariantCulture, out var y)
            && double.TryParse(parts[2], NumberStyles.Float, CultureInfo.InvariantCulture, out var z)
            ? (x, y, z)
            : null;
    }

    private static void BuildRepresentationIndex(IfcDocument document)
    {
        foreach (var product in document.Entities.Where(entity => entity.Arguments.Count > 6))
        {
            var definitionShapeId = StepArgumentReader.ReadReferences(product.Arguments[6]).FirstOrDefault();
            if (definitionShapeId == 0
                || !document.EntityById.TryGetValue(definitionShapeId, out var definitionShape)
                || definitionShape.Type != "IFCPRODUCTDEFINITIONSHAPE")
            {
                continue;
            }

            var summary = new IfcRepresentationSummary
            {
                ProductId = product.Id,
                ProductDefinitionShapeId = definitionShape.Id,
            };

            var shapeRepresentationIds = StepArgumentReader.ReadReferences(definitionShape.Arguments.ElementAtOrDefault(2) ?? string.Empty);
            foreach (var shapeRepresentationId in shapeRepresentationIds)
            {
                if (!document.EntityById.TryGetValue(shapeRepresentationId, out var shapeRepresentation)
                    || shapeRepresentation.Type != "IFCSHAPEREPRESENTATION")
                {
                    continue;
                }

                summary.ShapeRepresentationIds.Add(shapeRepresentation.Id);
                summary.GeometryItemIds.AddRange(StepArgumentReader.ReadReferences(shapeRepresentation.Arguments.ElementAtOrDefault(3) ?? string.Empty));
            }

            document.RepresentationsByEntity[product.Id] = summary;
        }
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

        ValidatePhysicalProducts(document);

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

    private static void BuildSpatialTree(IfcDocument document)
    {
        var childrenByParent = new Dictionary<int, List<(int ChildId, string Relation)>>();
        var childIds = new HashSet<int>();

        foreach (var rel in document.Entities.Where(entity => entity.Type == "IFCRELAGGREGATES"))
        {
            var parent = StepArgumentReader.ReadReferences(rel.Arguments.ElementAtOrDefault(4) ?? string.Empty).FirstOrDefault();
            var children = StepArgumentReader.ReadReferences(rel.Arguments.ElementAtOrDefault(5) ?? string.Empty);
            AddChildren(childrenByParent, childIds, parent, children, "aggregate");
        }

        foreach (var rel in document.Entities.Where(entity => entity.Type == "IFCRELCONTAINEDINSPATIALSTRUCTURE"))
        {
            var parent = StepArgumentReader.ReadReferences(rel.Arguments.ElementAtOrDefault(5) ?? string.Empty).FirstOrDefault();
            var children = StepArgumentReader.ReadReferences(rel.Arguments.ElementAtOrDefault(4) ?? string.Empty);
            AddChildren(childrenByParent, childIds, parent, children, "contains");
        }

        var roots = document.Entities
            .Where(entity => (entity.Type is "IFCPROJECT" or "IFCPROJECTLIBRARY") || IsSpatial(entity.Type))
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

    private static bool IsSpatial(string type)
    {
        return type is "IFCSITE" or "IFCBUILDING" or "IFCBUILDINGSTOREY" or "IFCSPACE" or "IFCFACILITY"
            or "IFCFACILITYPART" or "IFCROAD" or "IFCRAILWAY" or "IFCBRIDGE";
    }

    private static string DefaultHeader(string fileName)
    {
        return $"""
HEADER;
FILE_DESCRIPTION(('ViewDefinition [Native IFCnative]'),'2;1');
FILE_NAME('{fileName}','2026-05-10T00:00:00',('IFCnative'),('IFCnative'),'IFCnative Native Windows','IFCnative','');
FILE_SCHEMA(('IFC4X3_ADD2'));
ENDSEC;
""";
    }

    private const string SampleIfcText = """
ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');
FILE_NAME('IFCnative Native Sample.ifc','2026-05-10T00:00:00',('IFCnative'),('IFCnative'),'IFCnative Native Windows','IFCnative','');
FILE_SCHEMA(('IFC4X3_ADD2'));
ENDSEC;
DATA;
#1= IFCPROJECT('2XQ2f8a9b2ff4l$IFCnative',$,'IFCnative Native Sample',$,$,$,$,$,$);
#10= IFCSITE('0Site8a9b2ff4l$IFCnative',$,'Sample Site',$,$,$,$,$,$,$,$,$,$,$);
#20= IFCBUILDING('0Build8a9b2ff4l$IFCnative',$,'Sample Building',$,$,$,$,$,$,$,$,$);
#30= IFCBUILDINGSTOREY('0Level8a9b2ff4l$IFCnative',$,'Level 0',$,$,$,$,$,$);
#40= IFCBUILDINGELEMENTPROXY('0Proxy8a9b2ff4l$IFCnative',$,'Sample Inspection Block',$,$,#100,#110,$,$);
#50= IFCRELAGGREGATES('1AggProjectSite000000000',$,'Project Site',$,#1,(#10));
#51= IFCRELAGGREGATES('1AggSiteBuilding00000000',$,'Site Building',$,#10,(#20));
#52= IFCRELAGGREGATES('1AggBuildingLevel000000',$,'Building Level',$,#20,(#30));
#53= IFCRELCONTAINEDINSPATIALSTRUCTURE('1ContLevelProxy0000000',$,'Level Contains Proxy',$,(#40),#30);
#60= IFCPROPERTYSET('1PsetProxy000000000000',$,'Pset_IFCnative',$,(#61,#62));
#61= IFCPROPERTYSINGLEVALUE('ReviewStatus',$,'Native editable shell',$);
#62= IFCPROPERTYSINGLEVALUE('Source',$,'Generated sample',$);
#63= IFCRELDEFINESBYPROPERTIES('1RelPsetProxy00000000',$,'Proxy Properties',$,(#40),#60);
#100= IFCLOCALPLACEMENT($,#101);
#101= IFCAXIS2PLACEMENT3D(#102,$,$);
#102= IFCCARTESIANPOINT((0.,0.,0.));
#110= IFCPRODUCTDEFINITIONSHAPE($,$,(#120));
#120= IFCSHAPEREPRESENTATION(#130,'Body','SweptSolid',(#140));
#130= IFCGEOMETRICREPRESENTATIONCONTEXT('Body','Model',3,1.E-05,$,$);
#140= IFCEXTRUDEDAREASOLID(#150,#160,#170,2.4);
#150= IFCRECTANGLEPROFILEDEF(.AREA.,'Sample rectangle',#180,2.6,1.4);
#160= IFCAXIS2PLACEMENT3D(#190,$,$);
#170= IFCDIRECTION((0.,0.,1.));
#180= IFCAXIS2PLACEMENT2D(#200,$);
#190= IFCCARTESIANPOINT((0.,0.,0.));
#200= IFCCARTESIANPOINT((0.,0.));
ENDSEC;
END-ISO-10303-21;
""";

    [GeneratedRegex(@"FILE_SCHEMA\s*\(\s*\(\s*([^)]+?)\s*\)\s*\)", RegexOptions.IgnoreCase | RegexOptions.Singleline)]
    private static partial Regex SchemaRegex();
}
