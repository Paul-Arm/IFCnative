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
        Run("STEP export preserves parsed entity order", StepExportPreservesParsedEntityOrder);
        Run("STEP export preserves untouched entity text", StepExportPreservesUntouchedEntityText);
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
        Run("body assignment creates swept solid representation", BodyAssignmentCreatesSweptSolidRepresentation);
        Run("body assignment can be staged as draft", BodyAssignmentCanBeStagedAsDraft);
        Run("export validation reparses document before save", ExportValidationReparsesDocumentBeforeSave);
        Run("diagnostics projector supports text and severity filters", DiagnosticsProjectorSupportsFilters);
        Run("relationship graph supports filter and depth", RelationshipGraphSupportsFilterAndDepth);
        Run("native window layout store persists sanitized layout", NativeWindowLayoutStorePersistsSanitizedLayout);
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
        var solid = edited.EntityById[representation.GeometryItemIds[0]];
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
        var solid = edited.EntityById[representation.GeometryItemIds[0]];
        Equal("IFCEXTRUDEDAREASOLID", solid.Type, "filling body solid type");
        Equal("2.", solid.Arguments[3], "filling body height");
        True(IfcDiffService.Summarize(withOpening, edited).Any(line => line.Contains("IFCRELFILLSELEMENT")), "filling diff should show fill relationship");
    }

    private static void BodyAssignmentCreatesSweptSolidRepresentation()
    {
        var document = IfcStepParser.CreateSample();

        var assigned = IfcDocumentEditor.AssignBodyRepresentation(document, 40, "5", "2.5", "3", "rectangle");

        True(assigned.RepresentationsByEntity.TryGetValue(40, out var representation), "body representation was not indexed for product");
        True(representation.GeometryItemIds.Count == 1, "body representation should contain one solid item");
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

        var solid = edited.EntityById[representation.GeometryItemIds[0]];
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

    private static void NativeWindowLayoutStorePersistsSanitizedLayout()
    {
        var path = Path.Combine(Path.GetTempPath(), $"ifcnative-layout-{Guid.NewGuid():N}.json");
        try
        {
            var store = new NativeWindowLayoutStore(path);
            store.Save(new(false, false, false, 40, 40, 10, 10));
            var loaded = store.Load();

            True(!loaded.ShowModelPane, "model pane visibility should persist");
            True(loaded.ShowViewportPane, "viewport pane should be forced visible when all panes were hidden");
            True(!loaded.ShowInspectorPane, "inspector pane visibility should persist");
            Equal(260d, loaded.ModelPaneWidth, "model width should be clamped to minimum");
            Equal(320d, loaded.InspectorPaneWidth, "inspector width should be clamped to minimum");
            Equal(1100d, loaded.WindowWidth, "window width should be clamped to minimum");
            Equal(700d, loaded.WindowHeight, "window height should be clamped to minimum");
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

        var secondDraft = IfcDocumentEditor.UpdateEntity(redone, 40, "Second Draft Proxy", string.Empty, string.Join(",", redone.EntityById[40].Arguments));
        session.Stage(redone, secondDraft);
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
}
