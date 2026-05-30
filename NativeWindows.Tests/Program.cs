using System.IO.Compression;
using IFCnative.NativeWindows.Services;

var tests = new NativeTestRunner();
tests.RunAll();
Console.WriteLine($"Native service tests passed: {tests.Passed}");

internal sealed class NativeTestRunner
{
    public int Passed { get; private set; }

    public void RunAll()
    {
        Run("sample parser builds core indexes", SampleParserBuildsCoreIndexes);
        Run("IFC file loader reads ifcZIP archives", IfcFileLoaderReadsIfcZipArchives);
        Run("IFC file loader writes ifcZIP archives", IfcFileLoaderWritesIfcZipArchives);
        Run("native dependency catalog exposes planned libraries", NativeDependencyCatalogExposesPlannedLibraries);
        Run("IFC file loader roundtrips ifcXML payloads", IfcFileLoaderRoundtripsIfcXmlPayloads);
        Run("xBIM document adapter opens ifcXML payloads", XbimDocumentAdapterOpensIfcXmlPayloads);
        Run("STEP export preserves parsed entity order", StepExportPreservesParsedEntityOrder);
        Run("STEP writer exposes canonical entity helpers", StepWriterExposesCanonicalEntityHelpers);
        Run("STEP export preserves untouched entity text", StepExportPreservesUntouchedEntityText);
        Run("parser recovers after malformed entity arguments", ParserRecoversAfterMalformedEntityArguments);
        Run("parser recovers valid entity missing semicolon", ParserRecoversValidEntityMissingSemicolon);
        Run("parser keeps first entity when STEP ids duplicate", ParserKeepsFirstEntityWhenStepIdsDuplicate);
        Run("parser recovers after entity missing type", ParserRecoversAfterEntityMissingType);
        Run("parser recovers after unterminated string", ParserRecoversAfterUnterminatedString);
        Run("parser repairs unexpected text before entity terminator", ParserRepairsUnexpectedTextBeforeEntityTerminator);
        Run("entity/property/relationship edits create targeted diffs", EditsCreateTargetedDiffs);
        Run("spatial reparent updates containment parent", SpatialReparentUpdatesContainmentParent);
        Run("spatial detach removes containment link", SpatialDetachRemovesContainmentLink);
        Run("relationship create adds indexed link", RelationshipCreateAddsIndexedLink);
        Run("relationship delete removes selected link", RelationshipDeleteRemovesSelectedLink);
        Run("element connection create indexes connected endpoints", ElementConnectionCreateIndexesConnectedEndpoints);
        Run("element disconnect removes connection relationship", ElementDisconnectRemovesConnectionRelationship);
        Run("placement edit updates Cartesian point", PlacementEditUpdatesCartesianPoint);
        Run("product preset creates contained placed body", ProductPresetCreatesContainedPlacedBody);
        Run("opening void preset creates void relationship and body", OpeningVoidPresetCreatesVoidRelationshipAndBody);
        Run("opening filling preset creates fill relationship and body", OpeningFillingPresetCreatesFillRelationshipAndBody);
        Run("property templates create indexed pset and qto", PropertyTemplatesCreateIndexedPsetAndQto);
        Run("resource assignments create indexed references", ResourceAssignmentsCreateIndexedReferences);
        Run("body assignment creates swept solid representation", BodyAssignmentCreatesSweptSolidRepresentation);
        Run("geometry backend projects body dimensions", GeometryBackendProjectsBodyDimensions);
        Run("body assignment can be staged as draft", BodyAssignmentCanBeStagedAsDraft);
        Run("export validation reparses document before save", ExportValidationReparsesDocumentBeforeSave);
        Run("missing relationship reference diagnostics can be repaired", MissingRelationshipReferenceDiagnosticsCanBeRepaired);
        Run("duplicate GlobalId diagnostics can be repaired", DuplicateGlobalIdDiagnosticsCanBeRepaired);
        Run("missing GlobalId diagnostics can be repaired", MissingGlobalIdDiagnosticsCanBeRepaired);
        Run("spatial containment diagnostics can be repaired", SpatialContainmentDiagnosticsCanBeRepaired);
        Run("placement and representation diagnostics can be repaired", PlacementAndRepresentationDiagnosticsCanBeRepaired);
        Run("diagnostics projector supports text and severity filters", DiagnosticsProjectorSupportsFilters);
        Run("IDS validation reports passing and failing entity requirements", IdsValidationReportsEntityRequirements);
        Run("advanced search filters model indexes", AdvancedSearchFiltersModelIndexes);
        Run("relationship graph supports filter and depth", RelationshipGraphSupportsFilterAndDepth);
        Run("MSAGL relationship graph layout positions nodes", MsaglRelationshipGraphLayoutPositionsNodes);
        Run("native window layout store persists sanitized layout", NativeWindowLayoutStorePersistsSanitizedLayout);
        Run("native window layout store persists AvalonDock XML", NativeWindowLayoutStorePersistsAvalonDockXml);
        Run("draft session gates export until apply/discard", DraftSessionGatesExport);
        Run("draft session supports applied undo redo history", DraftSessionSupportsUndoRedoHistory);
    }

    private void Run(string name, Action test)
    {
        try
        {
            test();
            Passed++;
            Console.WriteLine($"PASS {name}");
        }
        catch (Exception exception)
        {
            throw new InvalidOperationException($"FAIL {name}: {exception.Message}", exception);
        }
    }

    private static void SampleParserBuildsCoreIndexes()
    {
        var document = IfcStepParser.CreateSample();

        Equal("IFC4X3_ADD2", document.Schema, "schema");
        True(document.EntityById.ContainsKey(40), "sample proxy missing");
        True(document.RelationshipById.ContainsKey(53), "containment relationship missing");
        True(document.PropertySetsByEntity.TryGetValue(40, out var propertySets) && propertySets.Count == 1, "proxy property set not indexed");
        True(document.SpatialPathByEntity.TryGetValue(40, out var path) && path.Contains("Sample Inspection Block"), "spatial path not indexed");
        True(document.Diagnostics.Messages.Any(message => message.Contains("Loaded") && message.Contains("STEP entities")), "load diagnostic missing");
    }

    private static void IfcFileLoaderReadsIfcZipArchives()
    {
        var tempPath = Path.Combine(Path.GetTempPath(), $"ifcnative-test-{Guid.NewGuid():N}.ifczip");
        try
        {
            using (var archive = ZipFile.Open(tempPath, ZipArchiveMode.Create))
            {
                var ignored = archive.CreateEntry("notes.txt");
                using (var ignoredWriter = new StreamWriter(ignored.Open()))
                {
                    ignoredWriter.Write("not an IFC file");
                }

                var entry = archive.CreateEntry("models/zipped-sample.ifc");
                using var writer = new StreamWriter(entry.Open());
                writer.Write(UnorderedFixture);
            }

            var loaded = IfcFileLoader.ReadAsync(tempPath).GetAwaiter().GetResult();
            Equal("zipped-sample.ifc", loaded.FileName, "ifcZIP entry filename");
            True(loaded.Text.Contains("IFCPROJECT", StringComparison.Ordinal), "ifcZIP text should contain IFC content");

            var document = IfcStepParser.Parse(loaded.Text, loaded.FileName);
            Equal("IFC4X3_ADD2", document.Schema, "ifcZIP parsed schema");
        }
        finally
        {
            if (File.Exists(tempPath))
            {
                File.Delete(tempPath);
            }
        }
    }

    private static void IfcFileLoaderWritesIfcZipArchives()
    {
        var tempPath = Path.Combine(Path.GetTempPath(), $"ifcnative-export-{Guid.NewGuid():N}.ifczip");
        try
        {
            IfcFileLoader.WriteText(tempPath, UnorderedFixture, "source-model.step");

            using var archive = ZipFile.OpenRead(tempPath);
            Equal(1, archive.Entries.Count, "ifcZIP should contain one IFC entry");
            Equal("source-model.ifc", archive.Entries[0].Name, "ifcZIP export entry filename");

            using var reader = new StreamReader(archive.Entries[0].Open());
            var exported = reader.ReadToEnd();
            True(exported.Contains("IFCPROJECT", StringComparison.Ordinal), "ifcZIP export should contain STEP text");
        }
        finally
        {
            if (File.Exists(tempPath))
            {
                File.Delete(tempPath);
            }
        }
    }

    private static void NativeDependencyCatalogExposesPlannedLibraries()
    {
        var statuses = NativeDependencyCatalog.GetStatuses();

        True(statuses.Any(status => status.Name == "xBIM Essentials" && status.Version == "6.0.587"), "xBIM Essentials dependency status missing");
        True(statuses.Any(status => status.Name == "xBIM Geometry" && status.Version == "6.3.873-netcore"), "xBIM Geometry dependency status missing");
        True(statuses.Any(status => status.Name == "HelixToolkit WPF SharpDX" && status.Version == "3.1.2"), "HelixToolkit dependency status missing");
        True(statuses.Any(status => status.Name == "Xceed AvalonDock" && status.Version == "5.1.26166.7861"), "AvalonDock dependency status missing");
        True(statuses.Any(status => status.Name == "MSAGL WPF GraphControl" && status.Version == "1.2.1"), "MSAGL dependency status missing");
        True(statuses.Any(status => status.CanResolve), "at least one planned native dependency should resolve at runtime");
    }

    private static void IfcFileLoaderRoundtripsIfcXmlPayloads()
    {
        var tempPath = Path.Combine(Path.GetTempPath(), $"ifcnative-export-{Guid.NewGuid():N}.ifcxml");
        try
        {
            IfcFileLoader.WriteText(tempPath, UnorderedFixture, "source-model.ifc");

            var xml = File.ReadAllText(tempPath);
            True(xml.Contains("<stepText>", StringComparison.Ordinal), "ifcXML export should contain a stepText payload");
            True(xml.Contains("IFCnative-stepText", StringComparison.Ordinal), "ifcXML export should mark the safe roundtrip format");

            var loaded = IfcFileLoader.ReadAsync(tempPath).GetAwaiter().GetResult();
            True(loaded.Text.Contains("IFCPROJECT", StringComparison.Ordinal), "ifcXML import should recover STEP text");

            var document = IfcStepParser.Parse(loaded.Text, loaded.FileName);
            Equal("IFC4X3_ADD2", document.Schema, "ifcXML parsed schema");
        }
        finally
        {
            if (File.Exists(tempPath))
            {
                File.Delete(tempPath);
            }
        }
    }

    private static void XbimDocumentAdapterOpensIfcXmlPayloads()
    {
        var tempPath = Path.Combine(Path.GetTempPath(), $"ifcnative-adapter-{Guid.NewGuid():N}.ifcxml");
        try
        {
            IfcFileLoader.WriteText(tempPath, UnorderedFixture, "adapter-source.ifc");

            var result = new XbimDocumentAdapter().LoadAsync(tempPath).GetAwaiter().GetResult();

            True(result.IsIfcXml, "adapter should mark ifcXML inputs");
            Equal("IFC4X3_ADD2", result.Document.Schema, "adapter parsed schema");
            True(result.Document.Diagnostics.Messages.Any(message => message.Contains("xBIM adapter bridge", StringComparison.OrdinalIgnoreCase)), "adapter should add xBIM diagnostics");
        }
        finally
        {
            if (File.Exists(tempPath))
            {
                File.Delete(tempPath);
            }
        }
    }

    private static void StepExportPreservesParsedEntityOrder()
    {
        var document = IfcStepParser.Parse(UnorderedFixture, "unordered-fixture.ifc");
        var exported = document.ToStepText();

        True(exported.IndexOf("#40=", StringComparison.Ordinal) < exported.IndexOf("#1=", StringComparison.Ordinal), "export should preserve original #40 before #1 order");

        var edited = IfcDocumentEditor.UpdateEntity(document, 1, "Edited Project", string.Empty, string.Join(",", document.EntityById[1].Arguments));
        var editedExport = edited.ToStepText();

        True(editedExport.IndexOf("#40=", StringComparison.Ordinal) < editedExport.IndexOf("#1=", StringComparison.Ordinal), "edited export should preserve original entity order");

        var expanded = IfcDocumentEditor.AddCommonPropertySet(document, 40);
        var expandedExport = expanded.ToStepText();
        var newPropertySetId = expanded.Entities.Max(entity => entity.Id);

        True(expandedExport.IndexOf("#20=", StringComparison.Ordinal) < expandedExport.IndexOf($"#{newPropertySetId}=", StringComparison.Ordinal), "newly created entities should append after original rows");
    }

    private static void StepWriterExposesCanonicalEntityHelpers()
    {
        var document = IfcStepParser.Parse(UnorderedFixture, "unordered-fixture.ifc");
        var entity = document.EntityById[1];

        Equal(41, IfcStepWriter.NextEntityId(document), "next STEP id should follow highest parsed id");
        Equal(entity.ToStepLine(), IfcStepWriter.SerializeEntity(entity), "entity model should delegate to writer helper");

        entity.Name = "Writer Canonical Name";
        Equal("#1= IFCPROJECT('2XQ2f8a9b2ff4l$IFCnative',$,'Writer Canonical Name',$,$,$,$,$,$);", IfcStepWriter.SerializeEntity(entity), "edited entity should serialize canonically");
    }

    private static void StepExportPreservesUntouchedEntityText()
    {
        var document = IfcStepParser.Parse(FormattedEntityFixture, "formatted-entity.ifc");
        var exported = document.ToStepText();

        True(exported.Contains("#40 =\n  IFCBUILDINGELEMENTPROXY", StringComparison.Ordinal), "untouched multiline entity formatting should be preserved");

        var edited = IfcDocumentEditor.UpdateEntity(document, 1, "Edited Project", string.Empty, string.Join(",", document.EntityById[1].Arguments));
        var editedExport = edited.ToStepText();

        True(editedExport.Contains("#40 =\n  IFCBUILDINGELEMENTPROXY", StringComparison.Ordinal), "unrelated entity formatting should survive targeted edits");
        True(editedExport.Contains("#1= IFCPROJECT", StringComparison.Ordinal), "edited entity should be serialized canonically");
    }

    private static void ParserRecoversAfterMalformedEntityArguments()
    {
        var document = IfcStepParser.Parse(MalformedEntityFixture, "malformed-entity.ifc");

        True(document.Diagnostics.Messages.Any(message => message.Contains("Skipped #40") && message.Contains("unterminated argument list")), "unterminated entity diagnostic missing");
        True(!document.EntityById.ContainsKey(40), "malformed entity should be skipped");
        True(document.EntityById.TryGetValue(41, out var recovered) && recovered.Name == "Recovered Proxy", "parser should recover following valid entity");
        Equal(2, document.Entities.Count, "parser should preserve valid entities around malformed row");
    }

    private static void ParserRecoversValidEntityMissingSemicolon()
    {
        var document = IfcStepParser.Parse(MissingSemicolonFixture, "missing-semicolon.ifc");

        True(document.Diagnostics.Messages.Any(message => message.Contains("Parsed #40") && message.Contains("missing terminating ';'", StringComparison.OrdinalIgnoreCase)), "missing semicolon diagnostic missing");
        True(document.EntityById.TryGetValue(40, out var missingTerminator) && missingTerminator.Name == "Missing Semicolon Proxy", "entity before missing semicolon should still parse");
        True(document.EntityById.TryGetValue(41, out var recovered) && recovered.Name == "Recovered After Missing Semicolon", "parser should recover following entity after missing semicolon");
        Equal(3, document.Entities.Count, "parser should keep valid entities around missing semicolon");

        var exported = document.ToStepText();
        True(exported.Contains("#40= IFCBUILDINGELEMENTPROXY", StringComparison.Ordinal), "missing-semicolon entity should export canonically");
        True(exported.Contains("#40= IFCBUILDINGELEMENTPROXY('1Proxy8a9b2ff4l$IFCnative',$,'Missing Semicolon Proxy',$,$,$,$,$,$);", StringComparison.Ordinal), "export should repair the missing semicolon");
    }

    private static void ParserKeepsFirstEntityWhenStepIdsDuplicate()
    {
        var document = IfcStepParser.Parse(DuplicateStepIdFixture, "duplicate-step-id.ifc");

        True(document.Diagnostics.Messages.Any(message => message.Contains("duplicate STEP entity #41", StringComparison.OrdinalIgnoreCase)), "duplicate STEP id diagnostic missing");
        True(document.EntityById.TryGetValue(41, out var duplicate) && duplicate.Name == "First Proxy", "first parsed duplicate id should be kept");
        True(document.EntityById.TryGetValue(42, out var recovered) && recovered.Name == "Recovered After Duplicate", "parser should continue after duplicate STEP id");
        Equal(3, document.Entities.Count, "duplicate row should be skipped without dropping following valid entities");

        var exported = document.ToStepText();
        Equal(exported.IndexOf("#41=", StringComparison.Ordinal), exported.LastIndexOf("#41=", StringComparison.Ordinal), "export should contain only one #41 row");
    }

    private static void ParserRecoversAfterEntityMissingType()
    {
        var document = IfcStepParser.Parse(MissingEntityTypeFixture, "missing-entity-type.ifc");

        True(document.Diagnostics.Messages.Any(message => message.Contains("Skipped #40") && message.Contains("missing entity type")), "missing entity type diagnostic missing");
        True(!document.EntityById.ContainsKey(40), "entity with missing type should be skipped");
        True(document.EntityById.TryGetValue(41, out var recovered) && recovered.Name == "Recovered After Missing Type", "parser should recover following valid entity after missing type");
        Equal(2, document.Entities.Count, "parser should skip malformed row without dropping surrounding entities");
    }

    private static void ParserRecoversAfterUnterminatedString()
    {
        var document = IfcStepParser.Parse(UnterminatedStringFixture, "unterminated-string.ifc");

        True(document.Diagnostics.Messages.Any(message => message.Contains("Skipped #40") && message.Contains("unterminated argument list")), "unterminated string diagnostic missing");
        True(!document.EntityById.ContainsKey(40), "entity with unterminated string should be skipped");
        True(document.EntityById.TryGetValue(41, out var recovered) && recovered.Name == "Recovered After Unterminated String", "parser should recover following valid entity after unterminated string");
        Equal(2, document.Entities.Count, "parser should skip unterminated string row without swallowing following entities");
    }

    private static void ParserRepairsUnexpectedTextBeforeEntityTerminator()
    {
        var document = IfcStepParser.Parse(UnexpectedTrailingTextFixture, "unexpected-trailing-text.ifc");

        True(document.Diagnostics.Messages.Any(message => message.Contains("Parsed #40") && message.Contains("unexpected text", StringComparison.OrdinalIgnoreCase)), "unexpected trailing text diagnostic missing");
        True(document.EntityById.TryGetValue(40, out var repaired) && repaired.Name == "Trailing Junk Proxy", "entity with trailing junk should still parse");
        True(document.EntityById.TryGetValue(41, out var recovered) && recovered.Name == "Recovered After Trailing Junk", "parser should recover following valid entity after trailing junk");
        Equal(3, document.Entities.Count, "parser should keep valid entities around trailing junk");

        var exported = document.ToStepText();
        True(exported.Contains("#40= IFCBUILDINGELEMENTPROXY('1Proxy8a9b2ff4l$IFCnative',$,'Trailing Junk Proxy',$,$,$,$,$,$);", StringComparison.Ordinal), "export should omit unexpected trailing text and serialize canonically");
        True(!exported.Contains("BROKEN_TRAILING_TOKEN", StringComparison.Ordinal), "export should not preserve unexpected trailing text");
    }

    private static void EditsCreateTargetedDiffs()
    {
        var document = IfcStepParser.CreateSample();

        var renamed = IfcDocumentEditor.UpdateEntity(document, 40, "Renamed Proxy", "Edited description", string.Join(",", document.EntityById[40].Arguments));
        Equal("Renamed Proxy", renamed.EntityById[40].Name, "entity name edit");
        True(IfcDiffService.Summarize(document, renamed).Any(line => line.Contains("#40") && line.Contains("arg 3")), "entity diff did not include #40 arg change");

        var propertyEdited = IfcDocumentEditor.UpdatePropertyValue(document, 61, "'Reviewed'");
        Equal("'Reviewed'", propertyEdited.EntityById[61].Arguments[2], "property value edit");

        var relationshipEdited = IfcDocumentEditor.UpdateRelationshipEndpoints(document, 63, "#60", "#40");
        Equal("(#40)", relationshipEdited.EntityById[63].Arguments[4], "relationship related objects edit");
        Equal("#60", relationshipEdited.EntityById[63].Arguments[5], "relationship relating property definition edit");
    }

    private static void SpatialReparentUpdatesContainmentParent()
    {
        var document = IfcStepParser.CreateSample();

        var moved = IfcDocumentEditor.UpdateSpatialParent(document, 40, "#20");

        Equal("#20", moved.EntityById[53].Arguments[5], "containment parent edit");
        True(moved.SpatialPathByEntity.TryGetValue(40, out var path) && path.Contains("Sample Building") && !path.Contains("Level 0"), "spatial path did not refresh after reparent");
    }

    private static void SpatialDetachRemovesContainmentLink()
    {
        var document = IfcStepParser.CreateSample();

        var detached = IfcDocumentEditor.RemoveFromSpatialParent(document, 40);

        True(!detached.RelationshipById.ContainsKey(53), "empty containment relationship should be removed");
        True(!detached.SpatialPathByEntity.ContainsKey(40), "detached product should no longer have a spatial path");
        True(IfcDiffService.Summarize(document, detached).Any(line => line.Contains("- #53 IFCRELCONTAINEDINSPATIALSTRUCTURE")), "detach diff should show removed containment relationship");
    }

    private static void RelationshipDeleteRemovesSelectedLink()
    {
        var document = IfcStepParser.CreateSample();

        var deleted = IfcDocumentEditor.RemoveRelationship(document, 63);

        True(!deleted.RelationshipById.ContainsKey(63), "relationship should be removed from relationship index");
        True(!deleted.PropertySetsByEntity.ContainsKey(40), "property assignment should no longer project to related object");
        True(IfcDiffService.Summarize(document, deleted).Any(line => line.Contains("- #63 IFCRELDEFINESBYPROPERTIES")), "delete diff should show removed relationship");
    }

    private static void RelationshipCreateAddsIndexedLink()
    {
        var document = IfcStepParser.CreateSample();

        var created = IfcDocumentEditor.AddRelationship(document, "IFCRELDEFINESBYPROPERTIES", "#60", "#40", "Assign native properties");
        var relationship = created.RelationshipById.Values.OrderByDescending(relationship => relationship.Id).FirstOrDefault(relationship => relationship.Type == "IFCRELDEFINESBYPROPERTIES");

        True(relationship is not null, "relationship should be added to relationship index");
        True(relationship!.SourceIds.Contains(60), "created relationship should index source id");
        True(relationship.TargetIds.Contains(40), "created relationship should index target id");
        Equal("Assign native properties", created.EntityById[relationship.Id].Name, "created relationship name");
        True(IfcDiffService.Summarize(document, created).Any(line => line.Contains("+ #") && line.Contains("IFCRELDEFINESBYPROPERTIES")), "create diff should show added relationship");
    }

    private static void ElementConnectionCreateIndexesConnectedEndpoints()
    {
        var document = IfcStepParser.Parse(ConnectionFixture, "connection-fixture.ifc");

        var connected = IfcDocumentEditor.AddElementConnection(document, 40, "#41", "Native connection");
        var relationship = connected.RelationshipById.Values.OrderByDescending(relationship => relationship.Id).FirstOrDefault(relationship => relationship.Type == "IFCRELCONNECTSELEMENTS");

        True(relationship is not null, "connection relationship should be added");
        Equal(40, relationship!.SourceIds.Single(), "connection source endpoint");
        Equal(41, relationship.TargetIds.Single(), "connection target endpoint");
        Equal("$", connected.EntityById[relationship.Id].Arguments[4], "connection geometry should remain unset");
        Equal("#40", connected.EntityById[relationship.Id].Arguments[5], "relating element argument");
        Equal("#41", connected.EntityById[relationship.Id].Arguments[6], "related element argument");
    }

    private static void ElementDisconnectRemovesConnectionRelationship()
    {
        var document = IfcStepParser.Parse(ConnectionFixture, "connection-fixture.ifc");
        var connected = IfcDocumentEditor.AddElementConnection(document, 40, "#41", "Native connection");

        var disconnected = IfcDocumentEditor.RemoveElementConnections(connected, 40, "#41");

        True(!disconnected.RelationshipById.Values.Any(relationship => relationship.Type == "IFCRELCONNECTSELEMENTS"), "connection relationship should be removed");
        True(IfcDiffService.Summarize(connected, disconnected).Any(line => line.Contains("- #") && line.Contains("IFCRELCONNECTSELEMENTS")), "disconnect diff should show removed connection");
    }

    private static void PlacementEditUpdatesCartesianPoint()
    {
        var document = IfcStepParser.Parse(PlacementFixture, "placement-fixture.ifc");

        var edited = IfcDocumentEditor.UpdatePlacement(document, 40, "1.25", "-2", "3");

        Equal("(1.25,-2.,3.)", edited.EntityById[72].Arguments[0], "placement point edit");
        True(edited.PlacementsByEntity.TryGetValue(40, out var placement) && placement.X == 1.25 && placement.Y == -2 && placement.Z == 3, "placement index did not refresh");
    }

    private static void OpeningVoidPresetCreatesVoidRelationshipAndBody()
    {
        var document = IfcStepParser.CreateSample();

        var edited = IfcDocumentEditor.AddOpeningVoidWithBodyRepresentation(document, 40, "Native Opening", "1.2", "0.2", "2.1", "rectangle");
        var opening = edited.Entities.FirstOrDefault(entity => entity.Type == "IFCOPENINGELEMENT" && entity.Name == "Native Opening");

        True(opening is not null, "opening element not created");
        True(edited.RelationshipById.Values.Any(relationship => relationship.Type == "IFCRELVOIDSELEMENT"
            && relationship.SourceIds.Contains(40)
            && relationship.TargetIds.Contains(opening!.Id)), "void relationship not indexed");
        True(edited.PlacementsByEntity.ContainsKey(opening!.Id), "opening placement not indexed");
        True(edited.RepresentationsByEntity.TryGetValue(opening.Id, out var representation), "opening body representation not indexed");
        var solid = edited.EntityById[representation!.GeometryItemIds[0]];
        Equal("IFCEXTRUDEDAREASOLID", solid.Type, "opening body solid type");
        Equal("2.1", solid.Arguments[3], "opening body height");
        True(IfcDiffService.Summarize(document, edited).Any(line => line.Contains("IFCRELVOIDSELEMENT")), "opening diff should show void relationship");
    }

    private static void OpeningFillingPresetCreatesFillRelationshipAndBody()
    {
        var document = IfcStepParser.CreateSample();
        var withOpening = IfcDocumentEditor.AddOpeningVoidWithBodyRepresentation(document, 40, "Native Opening", "1.2", "0.2", "2.1", "rectangle");
        var opening = withOpening.Entities.First(entity => entity.Type == "IFCOPENINGELEMENT" && entity.Name == "Native Opening");

        var edited = IfcDocumentEditor.AddFillingElementWithBodyRepresentation(withOpening, opening.Id, "IFCDOOR", "Native Door", "1", "0.12", "2", "rectangle");
        var filling = edited.Entities.FirstOrDefault(entity => entity.Type == "IFCDOOR" && entity.Name == "Native Door");

        True(filling is not null, "filling element not created");
        True(edited.RelationshipById.Values.Any(relationship => relationship.Type == "IFCRELFILLSELEMENT"
            && relationship.SourceIds.Contains(opening.Id)
            && relationship.TargetIds.Contains(filling!.Id)), "fill relationship not indexed");
        True(edited.PlacementsByEntity.TryGetValue(filling!.Id, out var placement) && placement.RelativeToId == edited.PlacementsByEntity[opening.Id].PlacementId, "filling placement should be relative to opening");
        True(edited.RepresentationsByEntity.TryGetValue(filling.Id, out var representation), "filling body representation not indexed");
        var solid = edited.EntityById[representation!.GeometryItemIds[0]];
        Equal("IFCEXTRUDEDAREASOLID", solid.Type, "filling body solid type");
        Equal("2.", solid.Arguments[3], "filling body height");
        True(IfcDiffService.Summarize(withOpening, edited).Any(line => line.Contains("IFCRELFILLSELEMENT")), "filling diff should show fill relationship");
    }

    private static void BodyAssignmentCreatesSweptSolidRepresentation()
    {
        var document = IfcStepParser.CreateSample();

        var assigned = IfcDocumentEditor.AssignBodyRepresentation(document, 40, "5", "2.5", "3", "rectangle");

        True(assigned.RepresentationsByEntity.TryGetValue(40, out var representation), "body representation was not indexed for product");
        True(representation!.GeometryItemIds.Count == 1, "body representation should contain one solid item");
        var solid = assigned.EntityById[representation.GeometryItemIds[0]];
        Equal("IFCEXTRUDEDAREASOLID", solid.Type, "assigned body solid type");
        Equal("3.", solid.Arguments[3], "assigned body height");
        var profileId = int.Parse(solid.Arguments[0].TrimStart('#'));
        var profile = assigned.EntityById[profileId];
        Equal("IFCRECTANGLEPROFILEDEF", profile.Type, "assigned body profile type");
        Equal("5.", profile.Arguments[3], "assigned body width");
        Equal("2.5", profile.Arguments[4], "assigned body depth");
        True(IfcDiffService.Summarize(document, assigned).Any(line => line.Contains("IFCPRODUCTDEFINITIONSHAPE") || line.Contains("IFCEXTRUDEDAREASOLID")), "body assignment diff missing geometry additions");

        var cylinder = IfcDocumentEditor.AssignBodyRepresentation(document, 40, "2", "2", "4", "cylinder");
        var cylinderSolid = cylinder.EntityById[cylinder.RepresentationsByEntity[40].GeometryItemIds[0]];
        var cylinderProfileId = int.Parse(cylinderSolid.Arguments[0].TrimStart('#'));
        Equal("IFCCIRCLEPROFILEDEF", cylinder.EntityById[cylinderProfileId].Type, "assigned cylinder profile type");
        Equal("1.", cylinder.EntityById[cylinderProfileId].Arguments[3], "assigned cylinder radius");
    }

    private static void GeometryBackendProjectsBodyDimensions()
    {
        var document = IfcStepParser.CreateSample();
        var assigned = IfcDocumentEditor.AssignBodyRepresentation(document, 40, "5", "2.5", "3", "rectangle");
        var backend = new StepReferenceGeometryBackend();

        var preview = backend.ProjectDocument(assigned).Single(item => item.EntityId == 40);

        Equal("box", preview.Shape, "rectangle body preview shape");
        Equal(5d, preview.Width, "rectangle body preview width");
        Equal(2.5d, preview.Depth, "rectangle body preview depth");
        Equal(3d, preview.Height, "rectangle body preview height");
        Equal(1.5d, preview.CenterZ, "rectangle body preview center height");

        var cylinder = IfcDocumentEditor.AssignBodyRepresentation(document, 40, "2", "2", "4", "cylinder");
        var cylinderPreview = backend.ProjectDocument(cylinder).Single(item => item.EntityId == 40);

        Equal("cylinder", cylinderPreview.Shape, "cylinder body preview shape");
        Equal(2d, cylinderPreview.Width, "cylinder body preview diameter");
        Equal(4d, cylinderPreview.Height, "cylinder body preview height");
    }

    private static void PropertyTemplatesCreateIndexedPsetAndQto()
    {
        var document = IfcStepParser.CreateSample();

        var withPset = IfcDocumentEditor.AddCommonPropertySet(document, 40, "Native Ref", "Reviewed");
        var pset = withPset.PropertySetsByEntity[40].FirstOrDefault(set => set.Name == "Pset_NativeCommon");

        True(pset is not null, "common pset not assigned to product");
        True(pset!.Values.Any(value => value.Name == "Reference" && value.Value.Contains("Native Ref")), "reference property not indexed");
        True(pset.Values.Any(value => value.Name == "Status" && value.Value.Contains("Reviewed")), "status property not indexed");
        True(withPset.RelationshipById.Values.Any(relationship => relationship.Type == "IFCRELDEFINESBYPROPERTIES"
            && relationship.SourceIds.Contains(pset.Id)
            && relationship.TargetIds.Contains(40)), "common pset assignment relationship not indexed");

        var withQto = IfcDocumentEditor.AddBaseQuantitySet(document, 40, "3", "4.5", "6");
        var qto = withQto.PropertySetsByEntity[40].FirstOrDefault(set => set.Name == "Qto_NativeBaseQuantities");

        True(qto is not null, "base qto not assigned to product");
        True(qto!.Values.Any(value => value.Type == "IFCQUANTITYLENGTH" && value.Value == "3."), "length quantity not indexed");
        True(qto.Values.Any(value => value.Type == "IFCQUANTITYAREA" && value.Value == "4.5"), "area quantity not indexed");
        True(qto.Values.Any(value => value.Type == "IFCQUANTITYVOLUME" && value.Value == "6."), "volume quantity not indexed");
        True(IfcDiffService.Summarize(document, withQto).Any(line => line.Contains("IFCELEMENTQUANTITY")), "qto diff should show quantity set addition");
    }

    private static void ResourceAssignmentsCreateIndexedReferences()
    {
        var document = IfcStepParser.CreateSample();

        var assigned = IfcDocumentEditor.AddSimpleMaterialAssignment(document, 40, "Native Concrete");
        var material = assigned.Entities.FirstOrDefault(entity => entity.Type == "IFCMATERIAL" && entity.Arguments.FirstOrDefault() == "'Native Concrete'");

        True(material is not null, "material not created");
        True(assigned.ResourcesByEntity.TryGetValue(40, out var materialResources) && materialResources.Any(resource => resource.Contains("Native Concrete")), "material resource not indexed for product");
        True(assigned.RelationshipById.Values.Any(relationship => relationship.Type == "IFCRELASSOCIATESMATERIAL"
            && relationship.SourceIds.Contains(material!.Id)
            && relationship.TargetIds.Contains(40)), "material assignment relationship not indexed");

        assigned = IfcDocumentEditor.AddSimpleClassificationAssignment(assigned, 40, "Native Class", "NATIVE-42");
        var classification = assigned.Entities.FirstOrDefault(entity => entity.Type == "IFCCLASSIFICATIONREFERENCE" && entity.Arguments.Contains("'Native Class'"));

        True(classification is not null, "classification reference not created");
        True(assigned.ResourcesByEntity[40].Any(resource => resource.Contains("Native Class")), "classification resource not indexed for product");
        True(assigned.RelationshipById.Values.Any(relationship => relationship.Type == "IFCRELASSOCIATESCLASSIFICATION"
            && relationship.SourceIds.Contains(classification!.Id)
            && relationship.TargetIds.Contains(40)), "classification assignment relationship not indexed");

        assigned = IfcDocumentEditor.AddSimpleDocumentAssignment(assigned, 40, "Native Manual", "DOC-1");
        var documentReference = assigned.Entities.FirstOrDefault(entity => entity.Type == "IFCDOCUMENTREFERENCE" && entity.Arguments.Contains("'Native Manual'"));

        True(documentReference is not null, "document reference not created");
        True(assigned.ResourcesByEntity[40].Any(resource => resource.Contains("Native Manual")), "document resource not indexed for product");
        True(assigned.RelationshipById.Values.Any(relationship => relationship.Type == "IFCRELASSOCIATESDOCUMENT"
            && relationship.SourceIds.Contains(documentReference!.Id)
            && relationship.TargetIds.Contains(40)), "document assignment relationship not indexed");

        assigned = IfcDocumentEditor.AddSimpleLibraryAssignment(assigned, 40, "Native Library Item", "LIB-1");
        var libraryReference = assigned.Entities.FirstOrDefault(entity => entity.Type == "IFCLIBRARYREFERENCE" && entity.Arguments.Contains("'Native Library Item'"));

        True(libraryReference is not null, "library reference not created");
        True(assigned.ResourcesByEntity[40].Any(resource => resource.Contains("Native Library Item")), "library resource not indexed for product");
        True(assigned.RelationshipById.Values.Any(relationship => relationship.Type == "IFCRELASSOCIATESLIBRARY"
            && relationship.SourceIds.Contains(libraryReference!.Id)
            && relationship.TargetIds.Contains(40)), "library assignment relationship not indexed");
        True(IfcDiffService.Summarize(document, assigned).Any(line => line.Contains("IFCRELASSOCIATESLIBRARY")), "resource diff should show final assignment relationship");
    }

    private static void ProductPresetCreatesContainedPlacedBody()
    {
        var document = IfcStepParser.CreateSample();

        var edited = IfcDocumentEditor.AddProductWithBodyRepresentation(document, 30, "IFCBUILDINGELEMENTPROXY", "Native Child", "2", "1", "3", "rectangle");
        var product = edited.Entities.FirstOrDefault(entity => entity.Type == "IFCBUILDINGELEMENTPROXY" && entity.Name == "Native Child");

        True(product is not null, "new product not created");
        True(edited.PlacementsByEntity.ContainsKey(product!.Id), "new product placement not indexed");
        True(edited.RepresentationsByEntity.TryGetValue(product.Id, out var representation), "new product body representation not indexed");
        True(edited.RelationshipById.Values.Any(relationship => relationship.Type == "IFCRELCONTAINEDINSPATIALSTRUCTURE"
            && relationship.SourceIds.Contains(30)
            && relationship.TargetIds.Contains(product.Id)), "new product containment relationship not indexed");
        True(edited.SpatialPathByEntity.TryGetValue(product.Id, out var path) && path.Contains("Level 0") && path.Contains("Native Child"), "new product spatial path not indexed");

        var solid = edited.EntityById[representation!.GeometryItemIds[0]];
        Equal("IFCEXTRUDEDAREASOLID", solid.Type, "new product body solid type");
        Equal("3.", solid.Arguments[3], "new product body height");
    }

    private static void BodyAssignmentCanBeStagedAsDraft()
    {
        var saved = IfcStepParser.CreateSample();
        var draft = IfcDocumentEditor.AssignBodyRepresentation(saved, 40, "4", "2", "3", "rectangle");
        var session = new IfcDraftSession();

        session.Reset(saved);
        session.Stage(saved, draft);

        True(session.HasDraft, "body draft not staged");
        True(!session.CanExport, "body draft should block export");
        True(session.Summarize().Any(line => line.Contains("IFCPRODUCTDEFINITIONSHAPE") || line.Contains("IFCEXTRUDEDAREASOLID")), "body draft summary missing geometry additions");
    }

    private static void ExportValidationReparsesDocumentBeforeSave()
    {
        var valid = IfcExportValidator.Validate(IfcStepParser.CreateSample());
        True(valid.CanExport, "sample export should validate");
        True(valid.EntityCount > 0, "validation should report reparsed entity count");

        var invalid = IfcExportValidator.Validate(new IfcDocument { FileName = "invalid.ifc" });
        True(!invalid.CanExport, "invalid export should be blocked");
        True(invalid.Errors.Any(error => error.Contains("HEADER section is missing", StringComparison.OrdinalIgnoreCase)), "validation should surface parser errors");

        var geometryInvalid = IfcExportValidator.Validate(IfcStepParser.Parse(MissingGeometryFixture, "missing-geometry.ifc"), new StepReferenceGeometryBackend());
        True(!geometryInvalid.CanExport, "missing geometry references should be blocked by geometry backend validation");
        True(geometryInvalid.Errors.Any(error => error.Contains("missing geometry item #999", StringComparison.OrdinalIgnoreCase)), "geometry validation should surface missing item references");
    }

    private static void DiagnosticsProjectorSupportsFilters()
    {
        var messages = new[]
        {
            "Info: Loaded 3 STEP entities.",
            "Warning: #40 has no ObjectPlacement.",
            "Error: #80 references missing entity #999.",
        };

        var errors = IfcDiagnosticsProjector.Project(messages, "error");
        Equal(1, errors.Count, "severity filter should return only errors");
        Equal("Error", errors[0].Severity, "severity filter result");

        var placement = IfcDiagnosticsProjector.Project(messages, "placement");
        Equal(1, placement.Count, "message/suggestion filter should return placement warning");
        Equal("Warning", placement[0].Severity, "placement filter result");
        Equal(40, placement[0].EntityId, "diagnostic navigation target should parse first STEP id");
        True(placement[0].CanNavigate, "diagnostic row with STEP id should be navigable");

        var empty = IfcDiagnosticsProjector.Project(messages, "not-present");
        Equal(1, empty.Count, "empty filter should show a single placeholder");
        True(empty[0].Message.Contains("No diagnostics match", StringComparison.OrdinalIgnoreCase), "empty filter placeholder missing");
    }

    private static void DuplicateGlobalIdDiagnosticsCanBeRepaired()
    {
        var document = IfcStepParser.Parse(DuplicateGlobalIdFixture, "duplicate-globalid.ifc");
        var duplicateDiagnostic = IfcDiagnosticsProjector.Project(document.Diagnostics.Messages, "Duplicate GlobalId").Single();

        True(duplicateDiagnostic.CanRepair, "duplicate GlobalId diagnostic should expose a repair action");
        Equal(40, duplicateDiagnostic.EntityId, "duplicate GlobalId diagnostic should navigate to first duplicate entity");

        var repaired = IfcDocumentEditor.RegenerateDuplicateGlobalIds(document, duplicateDiagnostic.Message);

        Equal("DUPLICATE-GLOBALID", repaired.EntityById[40].GlobalId, "first duplicate GlobalId should remain stable");
        True(repaired.EntityById[41].GlobalId != "DUPLICATE-GLOBALID", "second duplicate GlobalId should be regenerated");
        True(!repaired.Diagnostics.Messages.Any(message => message.Contains("Duplicate GlobalId", StringComparison.OrdinalIgnoreCase)), "duplicate GlobalId warning should clear after repair");
        True(IfcDiffService.Summarize(document, repaired).Any(line => line.Contains("#41") && line.Contains("arg 1")), "repair diff should show the regenerated GlobalId argument");
    }

    private static void MissingGlobalIdDiagnosticsCanBeRepaired()
    {
        var fixture = MissingRelationshipReferenceFixture.Replace(
            "#40= IFCBUILDINGELEMENTPROXY('0Proxy8a9b2ff4l$IFCnative'",
            "#40= IFCBUILDINGELEMENTPROXY($",
            StringComparison.Ordinal);
        var document = IfcStepParser.Parse(fixture, "missing-globalid.ifc");
        var missingGlobalIdDiagnostic = IfcDiagnosticsProjector.Project(document.Diagnostics.Messages, "has no GlobalId").Single();

        True(missingGlobalIdDiagnostic.CanRepair, "missing GlobalId diagnostic should expose a repair action");
        True(missingGlobalIdDiagnostic.CanRepairMissingGlobalId, "missing GlobalId diagnostic should expose missing-GlobalId repair kind");
        Equal(40, missingGlobalIdDiagnostic.EntityId, "missing GlobalId diagnostic should navigate to affected entity");

        var repaired = IfcDocumentEditor.GenerateMissingGlobalIdFromDiagnostic(document, missingGlobalIdDiagnostic.Message);

        True(!string.IsNullOrWhiteSpace(repaired.EntityById[40].GlobalId), "repair should generate a GlobalId");
        True(!repaired.Diagnostics.Messages.Any(message => message.Contains("has no GlobalId", StringComparison.OrdinalIgnoreCase)), "missing GlobalId warning should clear after repair");
        True(IfcDiffService.Summarize(document, repaired).Any(line => line.Contains("#40") && line.Contains("arg 1")), "repair diff should show generated GlobalId argument");
    }

    private static void MissingRelationshipReferenceDiagnosticsCanBeRepaired()
    {
        var document = IfcStepParser.Parse(MissingRelationshipReferenceFixture, "missing-relationship-reference.ifc");
        var missingDiagnostic = IfcDiagnosticsProjector.Project(document.Diagnostics.Messages, "references missing entity").Single();

        True(missingDiagnostic.CanRepair, "missing reference diagnostic should expose a repair action");
        True(missingDiagnostic.CanRepairMissingReference, "missing reference diagnostic should expose missing-reference repair kind");
        Equal(53, missingDiagnostic.EntityId, "missing reference diagnostic should navigate to relationship");

        var repaired = IfcDocumentEditor.RemoveMissingRelationshipReferences(document, missingDiagnostic.Message);

        Equal("(#40)", repaired.EntityById[53].Arguments[4], "repair should remove dangling related object from relationship list");
        True(!repaired.Diagnostics.Messages.Any(message => message.Contains("references missing entity", StringComparison.OrdinalIgnoreCase)), "missing reference warning should clear after repair");
        True(IfcDiffService.Summarize(document, repaired).Any(line => line.Contains("#53") && line.Contains("arg 5")), "repair diff should show edited relationship endpoint list");
    }

    private static void SpatialContainmentDiagnosticsCanBeRepaired()
    {
        var document = IfcStepParser.Parse(MultipleContainmentFixture, "multiple-containment.ifc");
        var containmentDiagnostic = IfcDiagnosticsProjector.Project(document.Diagnostics.Messages, "multiple primary spatial containment").Single();

        True(containmentDiagnostic.CanRepair, "multiple containment diagnostic should expose a repair action");
        True(containmentDiagnostic.CanRepairSpatialContainment, "multiple containment diagnostic should expose spatial containment repair kind");
        Equal(40, containmentDiagnostic.EntityId, "multiple containment diagnostic should navigate to affected product");

        var repaired = IfcDocumentEditor.KeepFirstPrimarySpatialContainment(document, containmentDiagnostic.Message);

        True(repaired.RelationshipById.ContainsKey(53), "first containment relationship should be preserved");
        True(!repaired.RelationshipById.ContainsKey(54), "duplicate empty containment relationship should be removed");
        True(!repaired.Diagnostics.Messages.Any(message => message.Contains("multiple primary spatial containment", StringComparison.OrdinalIgnoreCase)), "multiple containment warning should clear after repair");
        True(IfcDiffService.Summarize(document, repaired).Any(line => line.StartsWith("- #54", StringComparison.Ordinal)), "repair diff should show removed duplicate containment relationship");
    }

    private static void PlacementAndRepresentationDiagnosticsCanBeRepaired()
    {
        var document = IfcStepParser.Parse(MissingRelationshipReferenceFixture, "missing-placement-representation.ifc");
        var placementDiagnostic = IfcDiagnosticsProjector.Project(document.Diagnostics.Messages, "has no ObjectPlacement").Single();
        var representationDiagnostic = IfcDiagnosticsProjector.Project(document.Diagnostics.Messages, "has no Representation").Single();

        True(placementDiagnostic.CanRepair, "missing placement diagnostic should expose a repair action");
        True(placementDiagnostic.CanRepairPlacement, "missing placement diagnostic should expose placement repair kind");
        True(representationDiagnostic.CanRepair, "missing representation diagnostic should expose a repair action");
        True(representationDiagnostic.CanRepairRepresentation, "missing representation diagnostic should expose representation repair kind");

        var withPlacement = IfcDocumentEditor.AssignDefaultPlacementFromDiagnostic(document, placementDiagnostic.Message);
        True(withPlacement.PlacementsByEntity.ContainsKey(40), "placement repair should index the generated placement");
        True(!withPlacement.Diagnostics.Messages.Any(message => message.Contains("#40 IFCBUILDINGELEMENTPROXY has no ObjectPlacement", StringComparison.OrdinalIgnoreCase)), "missing placement warning should clear after repair");
        True(IfcDiffService.Summarize(document, withPlacement).Any(line => line.Contains("#40") && line.Contains("arg 6")), "placement repair diff should show edited ObjectPlacement argument");

        var withRepresentation = IfcDocumentEditor.AssignDefaultRepresentationFromDiagnostic(document, representationDiagnostic.Message);
        True(withRepresentation.RepresentationsByEntity.ContainsKey(40), "representation repair should index the generated body representation");
        True(!withRepresentation.Diagnostics.Messages.Any(message => message.Contains("#40 IFCBUILDINGELEMENTPROXY has no Representation", StringComparison.OrdinalIgnoreCase)), "missing representation warning should clear after repair");
        True(IfcDiffService.Summarize(document, withRepresentation).Any(line => line.Contains("#40") && line.Contains("arg 7")), "representation repair diff should show edited Representation argument");
    }

    private static void IdsValidationReportsEntityRequirements()
    {
        var document = IfcStepParser.CreateSample();
        var passing = """
<ids>
  <specifications>
    <specification>
      <requirements>
        <entity>
          <name><simpleValue>IFCBUILDINGELEMENTPROXY</simpleValue></name>
        </entity>
      </requirements>
    </specification>
  </specifications>
</ids>
""";
        var failing = passing.Replace("IFCBUILDINGELEMENTPROXY", "IFCWALL", StringComparison.Ordinal);

        var passingResult = IdsValidationService.Validate(document, passing);
        True(passingResult.IsValid, "matching IDS entity requirement should pass");
        True(passingResult.Issues.Any(issue => issue.EntityId == 40), "passing IDS result should navigate to a matching entity");

        var failingResult = IdsValidationService.Validate(document, failing);
        True(!failingResult.IsValid, "missing IDS entity requirement should fail");
        True(failingResult.Issues.Any(issue => issue.Severity == "Error" && issue.Message.Contains("IFCWALL", StringComparison.Ordinal)), "failing IDS result should name missing entity type");

        IdsValidationService.AppendDiagnostics(document, failingResult);
        True(document.Diagnostics.Messages.Any(message => message.Contains("IFCWALL", StringComparison.Ordinal)), "IDS diagnostics should append to document diagnostics");
    }

    private static void AdvancedSearchFiltersModelIndexes()
    {
        var document = IfcDocumentEditor.AddSimpleMaterialAssignment(IfcStepParser.CreateSample(), 40, "Native Concrete");

        var propertyMatches = IfcAdvancedSearch.Search(
            document,
            new IfcAdvancedSearchQuery(
                Text: "Inspection",
                Type: "IFCBUILDINGELEMENTPROXY",
                RelationshipKind: "IFCRELDEFINESBYPROPERTIES",
                HasProperties: true));

        True(propertyMatches.Any(entity => entity.Id == 40), "advanced search should find proxy by text/type/relationship/properties");

        var resourceMatches = IfcAdvancedSearch.Search(
            document,
            new IfcAdvancedSearchQuery(Text: "Concrete", HasResources: true));

        True(resourceMatches.Any(entity => entity.Id == 40), "advanced search should find resource-backed product");

        var diagnosticDocument = IfcStepParser.Parse(MissingRelationshipReferenceFixture, "missing-reference.ifc");
        var diagnosticMatches = IfcAdvancedSearch.Search(
            diagnosticDocument,
            new IfcAdvancedSearchQuery(DiagnosticSeverity: "Warning"));

        True(diagnosticMatches.Any(entity => entity.Id == 40 || entity.Id == 53), "advanced search should find entities mentioned in warning diagnostics");
    }

    private static void RelationshipGraphSupportsFilterAndDepth()
    {
        var document = IfcStepParser.CreateSample();
        var proxy = document.EntityById[40];

        var depthTwo = IfcSelectionProjector.ProjectRelationshipGraph(document, proxy, null, 2);
        True(depthTwo.Any(item => item.EntityId == 20 && item.Depth == 2), "depth-two graph should include parent building through the storey");

        var filtered = IfcSelectionProjector.ProjectRelationshipGraph(document, proxy, "IFCPROPERTYSET", 2);
        True(filtered.Any(item => item.EntityId == 60), "filtered graph should keep matching property set neighbor");
        True(filtered.All(item => item.EntityId is not 30), "filtered graph should hide non-matching spatial neighbor");
    }

    private static void MsaglRelationshipGraphLayoutPositionsNodes()
    {
        var document = IfcStepParser.CreateSample();
        var proxy = document.EntityById[40];
        var graphItems = IfcSelectionProjector.ProjectRelationshipGraph(document, proxy, null, 2);

        var layout = MsaglRelationshipGraphLayout.Project(document, proxy, graphItems, "LR");

        True(layout.Nodes.Any(node => node.IsSelected && node.EntityId == 40), "MSAGL layout should include selected entity node");
        True(layout.Nodes.Any(node => node.RelationshipId == 53), "MSAGL layout should include relationship hub node");
        True(layout.Nodes.Any(node => node.EntityId == 30), "MSAGL layout should include neighbor entity node");
        True(layout.Edges.Count > 0, "MSAGL layout should create edges");
        True(layout.Width >= 420 && layout.Height >= 260, "MSAGL layout should report usable canvas bounds");
        True(layout.Nodes.All(node => double.IsFinite(node.X) && double.IsFinite(node.Y)), "MSAGL layout should return finite node positions");
    }

    private static void NativeWindowLayoutStorePersistsSanitizedLayout()
    {
        var path = Path.Combine(Path.GetTempPath(), $"ifcnative-layout-{Guid.NewGuid():N}.json");
        try
        {
            var store = new NativeWindowLayoutStore(path);
            var lastIfcPath = Path.Combine(Path.GetTempPath(), "model.ifc");
            store.Save(new(false, false, false, 40, 40, 10, 10, lastIfcPath));
            var loaded = store.Load();

            True(!loaded.ShowModelPane, "model pane visibility should persist");
            True(loaded.ShowViewportPane, "viewport pane should be forced visible when all panes were hidden");
            True(!loaded.ShowInspectorPane, "inspector pane visibility should persist");
            Equal(260d, loaded.ModelPaneWidth, "model width should be clamped to minimum");
            Equal(320d, loaded.InspectorPaneWidth, "inspector width should be clamped to minimum");
            Equal(1100d, loaded.WindowWidth, "window width should be clamped to minimum");
            Equal(700d, loaded.WindowHeight, "window height should be clamped to minimum");
            Equal(Path.GetFullPath(lastIfcPath), loaded.LastOpenedIfcPath, "last opened IFC path should persist as a full path");
        }
        finally
        {
            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }
    }

    private static void NativeWindowLayoutStorePersistsAvalonDockXml()
    {
        var path = Path.Combine(Path.GetTempPath(), $"ifcnative-avalondock-layout-{Guid.NewGuid():N}.json");
        try
        {
            var store = new NativeWindowLayoutStore(path);
            const string xml = "<LayoutRoot><RootPanel Orientation=\"Horizontal\" /></LayoutRoot>";

            store.Save(new(AvalonDockLayoutXml: xml));
            var loaded = store.Load();

            Equal(xml, loaded.AvalonDockLayoutXml, "AvalonDock XML should persist");

            store.Save(new(AvalonDockLayoutXml: "not xml"));
            var sanitized = store.Load();
            Equal<string?>(null, sanitized.AvalonDockLayoutXml, "invalid AvalonDock XML should be ignored");
        }
        finally
        {
            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }
    }

    private static void DraftSessionGatesExport()
    {
        var saved = IfcStepParser.CreateSample();
        var draft = IfcDocumentEditor.UpdateEntity(saved, 40, "Draft Proxy", string.Empty, string.Join(",", saved.EntityById[40].Arguments));
        var session = new IfcDraftSession();

        session.Reset(saved);
        True(session.CanExport, "fresh document should export");

        session.Stage(saved, draft);
        True(session.HasDraft, "draft not staged");
        True(!session.CanExport, "export should be blocked while draft is pending");
        True(session.Summarize().Any(line => line.Contains("#40")), "draft summary missing edited entity");

        var applied = session.Apply();
        True(applied is not null && applied.EntityById[40].Name == "Draft Proxy", "draft not applied");
        True(session.CanExport, "export should be enabled after apply");
    }

    private static void DraftSessionSupportsUndoRedoHistory()
    {
        var saved = IfcStepParser.CreateSample();
        var firstDraft = IfcDocumentEditor.UpdateEntity(saved, 40, "First Draft Proxy", string.Empty, string.Join(",", saved.EntityById[40].Arguments));
        var session = new IfcDraftSession();

        session.Reset(saved);
        session.Stage(saved, firstDraft);
        var firstApplied = session.Apply("Rename proxy");

        True(firstApplied is not null && firstApplied.EntityById[40].Name == "First Draft Proxy", "first draft not applied");
        True(session.CanUndo, "applied draft should create undo checkpoint");
        True(!session.CanRedo, "redo should be empty after new apply");
        Equal("Rename proxy", session.NextUndoName, "named changeset should label next undo");
        True(session.GetHistoryLines().Any(line => line.Contains("Rename proxy")), "history lines should include named changeset");

        var undone = session.Undo();
        True(undone is not null && undone.EntityById[40].Name == "Sample Inspection Block", "undo should restore original document");
        True(!session.CanUndo, "undo stack should be empty after returning to original");
        True(session.CanRedo, "undo should create redo checkpoint");
        Equal("Rename proxy", session.NextRedoName, "named changeset should label next redo");
        True(session.Summarize().Any(line => line.Contains("redo checkpoint")), "history summary should mention redo checkpoint");
        True(session.Summarize().Any(line => line.Contains("Rename proxy")), "history summary should include next redo changeset name");

        var redone = session.Redo();
        True(redone is not null && redone.EntityById[40].Name == "First Draft Proxy", "redo should restore applied draft");
        True(session.CanUndo, "redo should restore undo checkpoint");

        var redoneDocument = redone!;
        var secondDraft = IfcDocumentEditor.UpdateEntity(redoneDocument, 40, "Second Draft Proxy", string.Empty, string.Join(",", redoneDocument.EntityById[40].Arguments));
        session.Stage(redoneDocument, secondDraft);
        session.Apply("Rename proxy again");
        Equal("Rename proxy again", session.NextUndoName, "latest named changeset should be first undo");
        True(!session.CanRedo, "new apply should clear redo history");
    }

    private static void True(bool condition, string message)
    {
        if (!condition)
        {
            throw new InvalidOperationException(message);
        }
    }

    private static void Equal<T>(T expected, T actual, string message)
    {
        if (!EqualityComparer<T>.Default.Equals(expected, actual))
        {
            throw new InvalidOperationException($"{message}: expected {expected}, got {actual}");
        }
    }

    private const string UnorderedFixture = """
ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');
FILE_NAME('unordered-fixture.ifc','2026-05-24T00:00:00',('IFCnative'),('IFCnative'),'IFCnative Native Windows','IFCnative','');
FILE_SCHEMA(('IFC4X3_ADD2'));
ENDSEC;
DATA;
#40= IFCBUILDINGELEMENTPROXY('0Proxy8a9b2ff4l$IFCnative',$,'Sample Inspection Block',$,$,$,$,$,$);
#1= IFCPROJECT('2XQ2f8a9b2ff4l$IFCnative',$,'IFCnative Native Sample',$,$,$,$,$,$);
#20= IFCBUILDING('0Build8a9b2ff4l$IFCnative',$,'Sample Building',$,$,$,$,$,$);
ENDSEC;
END-ISO-10303-21;
""";

    private const string FormattedEntityFixture = """
ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');
FILE_NAME('formatted-entity.ifc','2026-05-24T00:00:00',('IFCnative'),('IFCnative'),'IFCnative Native Windows','IFCnative','');
FILE_SCHEMA(('IFC4X3_ADD2'));
ENDSEC;
DATA;
#1= IFCPROJECT('2XQ2f8a9b2ff4l$IFCnative',$,'IFCnative Native Sample',$,$,$,$,$,$);
#40 =
  IFCBUILDINGELEMENTPROXY('0Proxy8a9b2ff4l$IFCnative',$,'Sample Inspection Block',$,$,$,$,$,$);
ENDSEC;
END-ISO-10303-21;
""";

    private const string MalformedEntityFixture = """
ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');
FILE_NAME('malformed-entity.ifc','2026-05-24T00:00:00',('IFCnative'),('IFCnative'),'IFCnative Native Windows','IFCnative','');
FILE_SCHEMA(('IFC4X3_ADD2'));
ENDSEC;
DATA;
#1= IFCPROJECT('2XQ2f8a9b2ff4l$IFCnative',$,'IFCnative Native Sample',$,$,$,$,$,$);
#40= IFCBUILDINGELEMENTPROXY('0Proxy8a9b2ff4l$IFCnative',$,'Broken Proxy',$,$,$,$,$,$;
#41= IFCBUILDINGELEMENTPROXY('1Proxy8a9b2ff4l$IFCnative',$,'Recovered Proxy',$,$,$,$,$,$);
ENDSEC;
END-ISO-10303-21;
""";

    private const string MissingSemicolonFixture = """
ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');
FILE_NAME('missing-semicolon.ifc','2026-05-24T00:00:00',('IFCnative'),('IFCnative'),'IFCnative Native Windows','IFCnative','');
FILE_SCHEMA(('IFC4X3_ADD2'));
ENDSEC;
DATA;
#1= IFCPROJECT('2XQ2f8a9b2ff4l$IFCnative',$,'IFCnative Native Sample',$,$,$,$,$,$);
#40= IFCBUILDINGELEMENTPROXY('1Proxy8a9b2ff4l$IFCnative',$,'Missing Semicolon Proxy',$,$,$,$,$,$)
#41= IFCBUILDINGELEMENTPROXY('2Proxy8a9b2ff4l$IFCnative',$,'Recovered After Missing Semicolon',$,$,$,$,$,$);
ENDSEC;
END-ISO-10303-21;
""";

    private const string DuplicateStepIdFixture = """
ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');
FILE_NAME('duplicate-step-id.ifc','2026-05-24T00:00:00',('IFCnative'),('IFCnative'),'IFCnative Native Windows','IFCnative','');
FILE_SCHEMA(('IFC4X3_ADD2'));
ENDSEC;
DATA;
#1= IFCPROJECT('2XQ2f8a9b2ff4l$IFCnative',$,'IFCnative Native Sample',$,$,$,$,$,$);
#41= IFCBUILDINGELEMENTPROXY('1Proxy8a9b2ff4l$IFCnative',$,'First Proxy',$,$,$,$,$,$);
#41= IFCBUILDINGELEMENTPROXY('2Proxy8a9b2ff4l$IFCnative',$,'Second Proxy',$,$,$,$,$,$);
#42= IFCBUILDINGELEMENTPROXY('3Proxy8a9b2ff4l$IFCnative',$,'Recovered After Duplicate',$,$,$,$,$,$);
ENDSEC;
END-ISO-10303-21;
""";

    private const string MissingEntityTypeFixture = """
ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');
FILE_NAME('missing-entity-type.ifc','2026-05-24T00:00:00',('IFCnative'),('IFCnative'),'IFCnative Native Windows','IFCnative','');
FILE_SCHEMA(('IFC4X3_ADD2'));
ENDSEC;
DATA;
#1= IFCPROJECT('2XQ2f8a9b2ff4l$IFCnative',$,'IFCnative Native Sample',$,$,$,$,$,$);
#40= ('1Proxy8a9b2ff4l$IFCnative',$,'Missing Entity Type',$,$,$,$,$,$);
#41= IFCBUILDINGELEMENTPROXY('2Proxy8a9b2ff4l$IFCnative',$,'Recovered After Missing Type',$,$,$,$,$,$);
ENDSEC;
END-ISO-10303-21;
""";

    private const string UnterminatedStringFixture = """
ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');
FILE_NAME('unterminated-string.ifc','2026-05-24T00:00:00',('IFCnative'),('IFCnative'),'IFCnative Native Windows','IFCnative','');
FILE_SCHEMA(('IFC4X3_ADD2'));
ENDSEC;
DATA;
#1= IFCPROJECT('2XQ2f8a9b2ff4l$IFCnative',$,'IFCnative Native Sample',$,$,$,$,$,$);
#40= IFCBUILDINGELEMENTPROXY('1Proxy8a9b2ff4l$IFCnative',$,'Unterminated Proxy,$,$,$,$,$,$);
#41= IFCBUILDINGELEMENTPROXY('2Proxy8a9b2ff4l$IFCnative',$,'Recovered After Unterminated String',$,$,$,$,$,$);
ENDSEC;
END-ISO-10303-21;
""";

    private const string UnexpectedTrailingTextFixture = """
ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');
FILE_NAME('unexpected-trailing-text.ifc','2026-05-24T00:00:00',('IFCnative'),('IFCnative'),'IFCnative Native Windows','IFCnative','');
FILE_SCHEMA(('IFC4X3_ADD2'));
ENDSEC;
DATA;
#1= IFCPROJECT('2XQ2f8a9b2ff4l$IFCnative',$,'IFCnative Native Sample',$,$,$,$,$,$);
#40= IFCBUILDINGELEMENTPROXY('1Proxy8a9b2ff4l$IFCnative',$,'Trailing Junk Proxy',$,$,$,$,$,$) BROKEN_TRAILING_TOKEN;
#41= IFCBUILDINGELEMENTPROXY('2Proxy8a9b2ff4l$IFCnative',$,'Recovered After Trailing Junk',$,$,$,$,$,$);
ENDSEC;
END-ISO-10303-21;
""";

    private const string PlacementFixture = """
ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');
FILE_NAME('placement-fixture.ifc','2026-05-24T00:00:00',('IFCnative'),('IFCnative'),'IFCnative Native Windows','IFCnative','');
FILE_SCHEMA(('IFC4X3_ADD2'));
ENDSEC;
DATA;
#1= IFCPROJECT('2XQ2f8a9b2ff4l$IFCnative',$,'IFCnative Native Sample',$,$,$,$,$,$);
#30= IFCBUILDINGSTOREY('0Level8a9b2ff4l$IFCnative',$,'Level 0',$,$,$,$,$,$);
#40= IFCBUILDINGELEMENTPROXY('0Proxy8a9b2ff4l$IFCnative',$,'Placed Proxy',$,$,#70,#80,$,$);
#53= IFCRELCONTAINEDINSPATIALSTRUCTURE('1ContLevelProxy0000000',$,'Level Contains Proxy',$,(#40),#30);
#70= IFCLOCALPLACEMENT($,#71);
#71= IFCAXIS2PLACEMENT3D(#72,$,$);
#72= IFCCARTESIANPOINT((0.,0.,0.));
#80= IFCPRODUCTDEFINITIONSHAPE($,$,(#81));
#81= IFCSHAPEREPRESENTATION($,'Body','SweptSolid',(#82));
#82= IFCEXTRUDEDAREASOLID(#83,$,#84,1.);
#83= IFCRECTANGLEPROFILEDEF(.AREA.,$,$,1.,1.);
#84= IFCDIRECTION((0.,0.,1.));
ENDSEC;
END-ISO-10303-21;
""";

    private const string MissingGeometryFixture = """
ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');
FILE_NAME('missing-geometry.ifc','2026-05-24T00:00:00',('IFCnative'),('IFCnative'),'IFCnative Native Windows','IFCnative','');
FILE_SCHEMA(('IFC4X3_ADD2'));
ENDSEC;
DATA;
#1= IFCPROJECT('2XQ2f8a9b2ff4l$IFCnative',$,'IFCnative Native Sample',$,$,$,$,$,$);
#40= IFCBUILDINGELEMENTPROXY('0Proxy8a9b2ff4l$IFCnative',$,'Sample Inspection Block',$,$,$,#70,$,$);
#70= IFCPRODUCTDEFINITIONSHAPE($,$,(#71));
#71= IFCSHAPEREPRESENTATION($,'Body','SweptSolid',(#999));
ENDSEC;
END-ISO-10303-21;
""";

    private const string ConnectionFixture = """
ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');
FILE_NAME('connection-fixture.ifc','2026-05-24T00:00:00',('IFCnative'),('IFCnative'),'IFCnative Native Windows','IFCnative','');
FILE_SCHEMA(('IFC4X3_ADD2'));
ENDSEC;
DATA;
#1= IFCPROJECT('2XQ2f8a9b2ff4l$IFCnative',$,'IFCnative Native Sample',$,$,$,$,$,$);
#30= IFCBUILDINGSTOREY('0Level8a9b2ff4l$IFCnative',$,'Level 0',$,$,$,$,$,$);
#40= IFCBUILDINGELEMENTPROXY('0Proxy8a9b2ff4l$IFCnative',$,'Connected A',$,$,#70,#80,$,$);
#41= IFCBUILDINGELEMENTPROXY('1Proxy8a9b2ff4l$IFCnative',$,'Connected B',$,$,#71,#81,$,$);
#53= IFCRELCONTAINEDINSPATIALSTRUCTURE('1ContLevelProxy0000000',$,'Level Contains Proxy',$,(#40,#41),#30);
#70= IFCLOCALPLACEMENT($,#72);
#71= IFCLOCALPLACEMENT($,#73);
#72= IFCAXIS2PLACEMENT3D(#74,$,$);
#73= IFCAXIS2PLACEMENT3D(#75,$,$);
#74= IFCCARTESIANPOINT((0.,0.,0.));
#75= IFCCARTESIANPOINT((1.,0.,0.));
#80= IFCPRODUCTDEFINITIONSHAPE($,$,());
#81= IFCPRODUCTDEFINITIONSHAPE($,$,());
ENDSEC;
END-ISO-10303-21;
""";

    private const string DuplicateGlobalIdFixture = """
ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');
FILE_NAME('duplicate-globalid.ifc','2026-05-24T00:00:00',('IFCnative'),('IFCnative'),'IFCnative Native Windows','IFCnative','');
FILE_SCHEMA(('IFC4X3_ADD2'));
ENDSEC;
DATA;
#1= IFCPROJECT('2XQ2f8a9b2ff4l$IFCnative',$,'IFCnative Native Sample',$,$,$,$,$,$);
#40= IFCBUILDINGELEMENTPROXY('DUPLICATE-GLOBALID',$,'Duplicate A',$,$,$,$,$,$);
#41= IFCBUILDINGELEMENTPROXY('DUPLICATE-GLOBALID',$,'Duplicate B',$,$,$,$,$,$);
ENDSEC;
END-ISO-10303-21;
""";

    private const string MultipleContainmentFixture = """
ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');
FILE_NAME('multiple-containment.ifc','2026-05-24T00:00:00',('IFCnative'),('IFCnative'),'IFCnative Native Windows','IFCnative','');
FILE_SCHEMA(('IFC4X3_ADD2'));
ENDSEC;
DATA;
#1= IFCPROJECT('2XQ2f8a9b2ff4l$IFCnative',$,'IFCnative Native Sample',$,$,$,$,$,$);
#20= IFCBUILDING('2Building000000000000000',$,'Building A',$,$,$,$,$,$,$,$,$,$);
#30= IFCBUILDINGSTOREY('2Storey0000000000000000',$,'Storey A',$,$,$,$,$,$,$);
#31= IFCBUILDINGSTOREY('2Storey0000000000000001',$,'Storey B',$,$,$,$,$,$,$);
#40= IFCBUILDINGELEMENTPROXY('2Proxy00000000000000000',$,'Duplicate containment proxy',$,$,$,$,$,$);
#52= IFCRELAGGREGATES('1AggLevel00000000000000',$,'Building aggregates storeys',$,#20,(#30,#31));
#53= IFCRELCONTAINEDINSPATIALSTRUCTURE('1ContLevelProxy0000000',$,'Storey A Contains Proxy',$,(#40),#30);
#54= IFCRELCONTAINEDINSPATIALSTRUCTURE('1ContLevelProxy0000001',$,'Storey B Also Contains Proxy',$,(#40),#31);
ENDSEC;
END-ISO-10303-21;
""";

    private const string MissingRelationshipReferenceFixture = """
ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');
FILE_NAME('missing-relationship-reference.ifc','2026-05-24T00:00:00',('IFCnative'),('IFCnative'),'IFCnative Native Windows','IFCnative','');
FILE_SCHEMA(('IFC4X3_ADD2'));
ENDSEC;
DATA;
#1= IFCPROJECT('2XQ2f8a9b2ff4l$IFCnative',$,'IFCnative Native Sample',$,$,$,$,$,$);
#30= IFCBUILDINGSTOREY('0Level8a9b2ff4l$IFCnative',$,'Level 0',$,$,$,$,$,$);
#40= IFCBUILDINGELEMENTPROXY('0Proxy8a9b2ff4l$IFCnative',$,'Referenced Proxy',$,$,$,$,$,$);
#53= IFCRELCONTAINEDINSPATIALSTRUCTURE('1ContLevelProxy0000000',$,'Level Contains Proxy',$,(#40,#999),#30);
ENDSEC;
END-ISO-10303-21;
""";
}
