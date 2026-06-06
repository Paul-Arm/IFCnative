using System.IO.Compression;
using IFCnative.NativeWindows.Models;
using IFCnative.NativeWindows.Services;
using IFCnative.NativeWindows.ViewModels;

var tests = new NativeTestRunner();
tests.RunAll();
Console.WriteLine($"Native service tests passed: {tests.Passed}");

internal sealed class NativeTestRunner
{
    public int Passed { get; private set; }

    public void RunAll()
    {
        Run("sample parser builds core indexes", SampleParserBuildsCoreIndexes);
        Run("native memory model imports properties and geometry", NativeMemoryModelImportsPropertiesAndGeometry);
        Run("native memory geometry backend tessellates rectangle preview mesh", NativeMemoryGeometryBackendTessellatesRectanglePreviewMesh);
        Run("native memory geometry backend tessellates cylinder preview mesh", NativeMemoryGeometryBackendTessellatesCylinderPreviewMesh);
        Run("native memory geometry resolves relative placement and local offsets", NativeMemoryGeometryResolvesRelativePlacementAndLocalOffsets);
        Run("native memory geometry applies axis ref direction rotations", NativeMemoryGeometryAppliesAxisRefDirectionRotations);
        Run("native memory geometry expands mapped item previews without rewriting mapped STEP", NativeMemoryGeometryExpandsMappedItemPreviewsWithoutRewritingMappedStep);
        Run("native viewport camera fits and moves preview meshes", NativeViewportCameraFitsAndMovesPreviewMeshes);
        Run("native viewport selection resolves mesh hits from memory model", NativeViewportSelectionResolvesMeshHitsFromMemoryModel);
        Run("native memory edits patch export without reparsing live state", NativeMemoryEditsPatchExportWithoutReparsingLiveState);
        Run("IFC file loader reads ifcZIP archives", IfcFileLoaderReadsIfcZipArchives);
        Run("IFC file loader writes ifcZIP archives", IfcFileLoaderWritesIfcZipArchives);
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
        Run("body assignment can be staged as draft", BodyAssignmentCanBeStagedAsDraft);
        Run("export validation reparses document before save", ExportValidationReparsesDocumentBeforeSave);
        Run("missing relationship reference diagnostics can be repaired", MissingRelationshipReferenceDiagnosticsCanBeRepaired);
        Run("duplicate GlobalId diagnostics can be repaired", DuplicateGlobalIdDiagnosticsCanBeRepaired);
        Run("missing GlobalId diagnostics can be repaired", MissingGlobalIdDiagnosticsCanBeRepaired);
        Run("spatial containment diagnostics can be repaired", SpatialContainmentDiagnosticsCanBeRepaired);
        Run("placement and representation diagnostics can be repaired", PlacementAndRepresentationDiagnosticsCanBeRepaired);
        Run("diagnostics projector supports text and severity filters", DiagnosticsProjectorSupportsFilters);
        Run("relationship graph supports filter and depth", RelationshipGraphSupportsFilterAndDepth);
        Run("native window layout store persists sanitized layout", NativeWindowLayoutStorePersistsSanitizedLayout);
        Run("native user preferences persist text zoom", NativeUserPreferencesPersistTextZoom);
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

    private static void NativeMemoryModelImportsPropertiesAndGeometry()
    {
        var document = IfcStepParser.CreateSample();
        var model = document.MemoryModel;

        Equal("IFC4X3_ADD2", model.Schema, "memory model schema");
        True(model.ObjectsBySourceId.TryGetValue(40, out var product), "memory model product missing");
        True(product!.IsPhysicalProduct, "sample proxy should be a native physical product");
        True(product.PropertySets.Any(set => set.Name == "Pset_IFCnative"), "native product property set missing");

        var reviewStatus = product.PropertySets
            .SelectMany(set => set.Values)
            .Single(value => value.Name == "ReviewStatus");
        Equal(IfcPropertyValueKind.String, reviewStatus.Value.Kind, "review status should be a native string value");
        Equal("Native editable shell", reviewStatus.Value.Text, "review status native value");

        True(product.Geometry is not null, "native product geometry missing");
        var primitive = product.Geometry!.Primitives.Single(value => value.Kind == "ExtrudedAreaSolid");
        Equal("Rectangle", primitive.Profile?.Kind, "native geometry profile kind");
        Equal(2.6d, Math.Round(primitive.SizeX ?? 0, 1), "native rectangle width");
        Equal(1.4d, Math.Round(primitive.SizeY ?? 0, 1), "native rectangle depth");
        Equal(2.4d, Math.Round(primitive.SizeZ ?? 0, 1), "native extrusion depth");
        True(product.Placement is not null && product.Placement.X == 0 && product.Placement.Y == 0 && product.Placement.Z == 0, "native placement missing");

        var backend = new NativeMemoryGeometryBackend();
        var selected = backend.ProjectSelection(document, 40);
        True(selected.Any(item => item.Label.Contains("extruded rectangle", StringComparison.OrdinalIgnoreCase)), "native memory backend should describe the product primitive");
    }

    private static void NativeMemoryGeometryBackendTessellatesRectanglePreviewMesh()
    {
        var document = IfcStepParser.CreateSample();
        var backend = new NativeMemoryGeometryBackend();

        var meshes = backend.BuildPreviewMeshes(document, backend.ProjectSelection(document, 40));
        var mesh = meshes.Single(value => value.ProductSourceId == 40 && value.PrimitiveSourceId == 140);

        Equal(8, mesh.Vertices.Count, "rectangle mesh vertex count");
        Equal(36, mesh.TriangleIndices.Count, "rectangle mesh index count");
        Equal(2.6d, Math.Round(mesh.Vertices.Max(vertex => vertex.X) - mesh.Vertices.Min(vertex => vertex.X), 1), "rectangle mesh width");
        Equal(1.4d, Math.Round(mesh.Vertices.Max(vertex => vertex.Y) - mesh.Vertices.Min(vertex => vertex.Y), 1), "rectangle mesh depth");
        Equal(2.4d, Math.Round(mesh.Vertices.Max(vertex => vertex.Z) - mesh.Vertices.Min(vertex => vertex.Z), 1), "rectangle mesh height");
    }

    private static void NativeMemoryGeometryBackendTessellatesCylinderPreviewMesh()
    {
        var document = IfcStepParser.CreateSample();
        var cylinder = IfcDocumentEditor.AssignBodyRepresentation(document, 40, "2", "2", "4", "cylinder");
        var backend = new NativeMemoryGeometryBackend();

        var mesh = backend.BuildPreviewMeshes(cylinder, backend.ProjectSelection(cylinder, 40)).Single(value => value.ProductSourceId == 40);

        Equal(66, mesh.Vertices.Count, "cylinder mesh vertex count");
        Equal(384, mesh.TriangleIndices.Count, "cylinder mesh index count");
        Equal(2d, Math.Round(mesh.Vertices.Max(vertex => vertex.X) - mesh.Vertices.Min(vertex => vertex.X), 3), "cylinder mesh diameter");
        Equal(4d, Math.Round(mesh.Vertices.Max(vertex => vertex.Z) - mesh.Vertices.Min(vertex => vertex.Z), 3), "cylinder mesh height");
    }

    private static void NativeMemoryGeometryResolvesRelativePlacementAndLocalOffsets()
    {
        var document = IfcStepParser.Parse(RelativeGeometryFixture, "relative-geometry.ifc");
        var product = document.MemoryModel.ObjectsBySourceId[40];
        var primitive = product.Geometry!.Primitives.Single(value => value.Kind == "ExtrudedAreaSolid");

        Equal(0.5d, primitive.PositionX, "solid local x");
        Equal(0.25d, primitive.PositionY, "solid local y");
        Equal(0.5d, primitive.PositionZ, "solid local z");
        Equal(0.2d, primitive.Profile!.PositionX, "profile local x");
        Equal(0.1d, primitive.Profile.PositionY, "profile local y");

        var backend = new NativeMemoryGeometryBackend();
        var mesh = backend.BuildPreviewMeshes(document, backend.ProjectSelection(document, 40)).Single(value => value.ProductSourceId == 40);

        Equal(11.2d, Math.Round(mesh.Vertices.Min(vertex => vertex.X), 3), "relative mesh min x");
        Equal(12.2d, Math.Round(mesh.Vertices.Max(vertex => vertex.X), 3), "relative mesh max x");
        Equal(21.85d, Math.Round(mesh.Vertices.Min(vertex => vertex.Y), 3), "relative mesh min y");
        Equal(22.85d, Math.Round(mesh.Vertices.Max(vertex => vertex.Y), 3), "relative mesh max y");
        Equal(3.5d, Math.Round(mesh.Vertices.Min(vertex => vertex.Z), 3), "relative mesh min z");
        Equal(5.5d, Math.Round(mesh.Vertices.Max(vertex => vertex.Z), 3), "relative mesh max z");

        var patched = IfcMemoryModelExporter.ApplyToDocument(document, document.MemoryModel);
        Equal("(0.5,0.25,0.5)", patched.EntityById[91].Arguments[0], "solid local point should survive export");
        Equal("(0.2,0.1)", patched.EntityById[96].Arguments[0], "profile local point should survive export");
    }

    private static void NativeMemoryGeometryAppliesAxisRefDirectionRotations()
    {
        var document = IfcStepParser.Parse(RotatedPlacementFixture, "rotated-placement.ifc");
        var placement = document.MemoryModel.ObjectsBySourceId[40].Placement!;

        Equal(0d, placement.RefDirection.X, "placement ref direction x");
        Equal(1d, placement.RefDirection.Y, "placement ref direction y");
        Equal(0d, placement.Axis.X, "placement axis x");
        Equal(0d, placement.Axis.Y, "placement axis y");
        Equal(1d, placement.Axis.Z, "placement axis z");

        var backend = new NativeMemoryGeometryBackend();
        var mesh = backend.BuildPreviewMeshes(document, backend.ProjectSelection(document, 40)).Single(value => value.ProductSourceId == 40);

        Equal(1d, Math.Round(mesh.Vertices.Max(vertex => vertex.X) - mesh.Vertices.Min(vertex => vertex.X), 3), "rotated mesh world width");
        Equal(2d, Math.Round(mesh.Vertices.Max(vertex => vertex.Y) - mesh.Vertices.Min(vertex => vertex.Y), 3), "rotated mesh world depth");
        Equal(-0.5d, Math.Round(mesh.Vertices.Min(vertex => vertex.X), 3), "rotated mesh min x");
        Equal(1d, Math.Round(mesh.Vertices.Max(vertex => vertex.Y), 3), "rotated mesh max y");

        var patched = IfcMemoryModelExporter.ApplyToDocument(document, document.MemoryModel);
        Equal("#73", patched.EntityById[71].Arguments[1], "placement axis direction reference should survive export");
        Equal("#74", patched.EntityById[71].Arguments[2], "placement ref direction reference should survive export");
        Equal("(0.,1.,0.)", patched.EntityById[74].Arguments[0], "placement ref direction vector should survive export");
    }

    private static void NativeMemoryGeometryExpandsMappedItemPreviewsWithoutRewritingMappedStep()
    {
        var document = IfcStepParser.Parse(MappedGeometryFixture, "mapped-geometry.ifc");
        var geometry = document.MemoryModel.ProductGeometryByProductId[40];
        var primitive = geometry.Primitives.Single();

        Equal(90, primitive.SourceId, "mapped preview source id");
        Equal(90, primitive.MappedItemSourceId, "mapped item source id");
        Equal(120, primitive.MappedGeometrySourceId, "mapped source geometry id");
        Equal(5d, primitive.MappingX, "mapping origin x");
        Equal(6d, primitive.MappingY, "mapping origin y");
        Equal(2d, primitive.MappingScale, "mapping scale");
        Equal(0d, primitive.MappingRefDirection.X, "mapping x axis x");
        Equal(1d, primitive.MappingRefDirection.Y, "mapping x axis y");

        var backend = new NativeMemoryGeometryBackend();
        var mesh = backend.BuildPreviewMeshes(document, backend.ProjectSelection(document, 40)).Single(value => value.ProductSourceId == 40);

        Equal(4d, Math.Round(mesh.Vertices.Min(vertex => vertex.X), 3), "mapped mesh min x");
        Equal(6d, Math.Round(mesh.Vertices.Max(vertex => vertex.X), 3), "mapped mesh max x");
        Equal(4d, Math.Round(mesh.Vertices.Min(vertex => vertex.Y), 3), "mapped mesh min y");
        Equal(8d, Math.Round(mesh.Vertices.Max(vertex => vertex.Y), 3), "mapped mesh max y");
        Equal(0d, Math.Round(mesh.Vertices.Min(vertex => vertex.Z), 3), "mapped mesh min z");
        Equal(2d, Math.Round(mesh.Vertices.Max(vertex => vertex.Z), 3), "mapped mesh max z");

        var resized = IfcMemoryModelEditor.UpdateExtrudedBodyDimensions(document.MemoryModel, 40, "5", "5", "5");
        Equal(2d, resized.ProductGeometryByProductId[40].Primitives.Single().SizeX ?? 0, "mapped body should not be resized as direct solid");

        var patched = IfcMemoryModelExporter.ApplyToDocument(document, document.MemoryModel);
        Equal("IFCMAPPEDITEM", patched.EntityById[90].Type, "mapped item should remain mapped STEP");
        Equal("#100", patched.EntityById[90].Arguments[0], "mapped item representation map should survive export");
        Equal("#110", patched.EntityById[90].Arguments[1], "mapped item transform should survive export");
    }

    private static void NativeViewportCameraFitsAndMovesPreviewMeshes()
    {
        var document = IfcStepParser.CreateSample();
        var backend = new NativeMemoryGeometryBackend();
        var meshes = backend.BuildPreviewMeshes(document, backend.ProjectSelection(document, 40));

        var camera = NativeViewportCameraController.FitMeshes(meshes);
        Equal(0d, Math.Round(camera.Target.X, 3), "fit target x");
        Equal(0d, Math.Round(camera.Target.Y, 3), "fit target y");
        Equal(1.2d, Math.Round(camera.Target.Z, 1), "fit target z");
        True(camera.Distance > camera.SceneRadius, "camera should sit outside fitted scene bounds");

        var pose = camera.ToPose();
        var resolvedTarget = NativeViewportCameraController.Add(pose.Position, pose.LookDirection);
        Equal(0d, Math.Round(resolvedTarget.X, 3), "camera pose should look at target x");
        Equal(0d, Math.Round(resolvedTarget.Y, 3), "camera pose should look at target y");
        Equal(1.2d, Math.Round(resolvedTarget.Z, 1), "camera pose should look at target z");

        var orbited = NativeViewportCameraController.Orbit(camera, 100, -1000);
        True(orbited.YawDegrees != camera.YawDegrees, "orbit should change yaw");
        Equal(-80d, orbited.PitchDegrees, "orbit should clamp pitch");

        var zoomedIn = NativeViewportCameraController.Zoom(camera, 120);
        var zoomedOut = NativeViewportCameraController.Zoom(camera, -120);
        True(zoomedIn.Distance < camera.Distance, "positive wheel delta should zoom in");
        True(zoomedOut.Distance > camera.Distance, "negative wheel delta should zoom out");

        var panned = NativeViewportCameraController.Pan(camera, 80, -40, 800, 600);
        True(panned.Target != camera.Target, "pan should move the camera target");
    }

    private static void NativeViewportSelectionResolvesMeshHitsFromMemoryModel()
    {
        var document = IfcStepParser.CreateSample();
        var backend = new NativeMemoryGeometryBackend();
        var mesh = backend.BuildPreviewMeshes(document, backend.ProjectSelection(document, 40)).Single(value => value.ProductSourceId == 40);

        var selection = NativeViewportSelectionService.ResolveMeshSelection(document, mesh, backend.Status);

        True(selection is not null, "mesh selection should resolve from memory model");
        Equal(40, selection!.ProductSourceId, "selected mesh product id");
        Equal(140, selection.PrimitiveSourceId, "selected mesh primitive id");
        True(selection.Status.Contains("native mesh #140", StringComparison.OrdinalIgnoreCase), "selection status should mention native mesh");

        var missingProductMesh = mesh with { ProductSourceId = 999 };
        True(NativeViewportSelectionService.ResolveMeshSelection(document, missingProductMesh, backend.Status) is null, "unknown mesh product should not resolve");
    }

    private static void NativeMemoryEditsPatchExportWithoutReparsingLiveState()
    {
        var document = IfcStepParser.CreateSample();
        var originalStepText = document.ToStepText();

        var memoryEdited = IfcMemoryModelEditor.UpdatePropertyValue(document.MemoryModel, 61, "IFCLABEL('Reviewed')");
        True(!ReferenceEquals(document.MemoryModel, memoryEdited), "memory property edit should return a draft memory model");
        Equal("Native editable shell", document.MemoryModel.PropertySetsByObjectId[40][0].Values[0].Value.Text, "imported memory model should stay unchanged");
        Equal("Reviewed", memoryEdited.PropertySetsByObjectId[40][0].Values[0].Value.Text, "memory property value should update without document reparse");
        Equal(originalStepText, document.ToStepText(), "memory-only edit should not mutate imported STEP text");

        var propertyPatched = IfcMemoryModelExporter.ApplyToDocument(document, memoryEdited);
        Equal("IFCLABEL('Reviewed')", propertyPatched.EntityById[61].Arguments[2], "export patch should write edited property value");
        Equal("Reviewed", propertyPatched.MemoryModel.PropertySetsByObjectId[40][0].Values[0].Value.Text, "patched document should carry edited memory model");
        Equal("'Native editable shell'", document.EntityById[61].Arguments[2], "source import entity should remain unchanged");

        var placed = IfcDocumentEditor.UpdatePlacement(document, 40, "1.25", "-2", "3");
        Equal("(1.25,-2.,3.)", placed.EntityById[102].Arguments[0], "memory placement edit should patch export point");
        True(placed.MemoryModel.ObjectsBySourceId[40].Placement is { X: 1.25, Y: -2, Z: 3 }, "memory placement should update");
        Equal("(0.,0.,0.)", document.EntityById[102].Arguments[0], "source import placement should remain unchanged");

        var resized = IfcDocumentEditor.UpdateBodyDimensions(document, 40, "5", "2.5", "3");
        Equal("3.", resized.EntityById[140].Arguments[3], "memory geometry edit should patch extrusion depth");
        Equal("5.", resized.EntityById[150].Arguments[3], "memory geometry edit should patch rectangle width");
        Equal("2.5", resized.EntityById[150].Arguments[4], "memory geometry edit should patch rectangle depth");
        var primitive = resized.MemoryModel.ProductGeometryByProductId[40].Primitives.Single(value => value.Kind == "ExtrudedAreaSolid");
        Equal(5d, primitive.SizeX ?? 0, "memory geometry width should update");
        Equal(2.5d, primitive.SizeY ?? 0, "memory geometry depth should update");
        Equal(3d, primitive.SizeZ ?? 0, "memory geometry height should update");
        Equal("2.4", document.EntityById[140].Arguments[3], "source import geometry should remain unchanged");

        var removedRelationModel = IfcMemoryModelEditor.RemoveRelation(document.MemoryModel, 63);
        True(!removedRelationModel.Relations.Any(relation => relation.SourceId == 63), "memory relation delete should remove the relation");
        True(!removedRelationModel.PropertySetsByObjectId.ContainsKey(40), "memory relation delete should remove projected property assignment");
        Equal(originalStepText, document.ToStepText(), "memory relation delete should not mutate imported STEP text");
        var removedRelationDocument = IfcMemoryModelExporter.ApplyToDocument(document, removedRelationModel);
        True(!removedRelationDocument.RelationshipById.ContainsKey(63), "relation export patch should remove relationship index row");
        True(!removedRelationDocument.PropertySetsByEntity.ContainsKey(40), "relation export patch should remove projected property set");
        True(!removedRelationDocument.ToStepText().Contains("#63=", StringComparison.Ordinal), "relation export patch should remove STEP relationship row");

        var newRelationshipId = IfcStepWriter.NextEntityId(document);
        var addedRelationModel = IfcMemoryModelEditor.AddRelation(document.MemoryModel, newRelationshipId, "IFCRELDEFINESBYPROPERTIES", "Memory property relation", [60], [40]);
        True(addedRelationModel.Relations.Any(relation => relation.SourceId == newRelationshipId), "memory relation create should add the relation");
        var addedRelationDocument = IfcMemoryModelExporter.ApplyToDocument(document, addedRelationModel);
        True(addedRelationDocument.RelationshipById.ContainsKey(newRelationshipId), "relation export patch should index created relationship");
        Equal("(#40)", addedRelationDocument.EntityById[newRelationshipId].Arguments[4], "created relationship related objects argument");
        Equal("#60", addedRelationDocument.EntityById[newRelationshipId].Arguments[5], "created relationship property definition argument");

        var movedSpatialModel = IfcMemoryModelEditor.UpdateRelationEndpoints(document.MemoryModel, 53, [20], [40]);
        var movedSpatialDocument = IfcMemoryModelExporter.ApplyToDocument(document, movedSpatialModel);
        Equal("#20", movedSpatialDocument.EntityById[53].Arguments[5], "memory spatial edit should patch containment parent");
        True(movedSpatialDocument.SpatialPathByEntity.TryGetValue(40, out var movedPath) && movedPath.Contains("Sample Building") && !movedPath.Contains("Level 0"), "memory spatial edit should refresh spatial path");
        Equal("#30", document.EntityById[53].Arguments[5], "source import spatial relationship should remain unchanged");
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

    private static void StepExportPreservesParsedEntityOrder()
    {
        var document = IfcStepParser.Parse(UnorderedFixture, "unordered-fixture.ifc");
        var exported = NormalizeNewlines(document.ToStepText());

        True(exported.IndexOf("#40=", StringComparison.Ordinal) < exported.IndexOf("#1=", StringComparison.Ordinal), "export should preserve original #40 before #1 order");

        var edited = IfcDocumentEditor.UpdateEntity(document, 1, "Edited Project", string.Empty, string.Join(",", document.EntityById[1].Arguments));
        var editedExport = NormalizeNewlines(edited.ToStepText());

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
        var exported = NormalizeNewlines(document.ToStepText());

        True(exported.Contains("#40 =\n  IFCBUILDINGELEMENTPROXY", StringComparison.Ordinal), "untouched multiline entity formatting should be preserved");

        var edited = IfcDocumentEditor.UpdateEntity(document, 1, "Edited Project", string.Empty, string.Join(",", document.EntityById[1].Arguments));
        var editedExport = NormalizeNewlines(edited.ToStepText());

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
        Equal("Sample Inspection Block", document.EntityById[40].Name, "source import should not gain raw entity edit");
        True(renamed.MemoryModel.ObjectsBySourceId[40].HasRawArgumentOverride, "raw entity edit should be stored as memory override");
        Equal("Renamed Proxy", renamed.MemoryModel.ObjectsBySourceId[40].Name, "raw entity memory override should store edited name");
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
        True(!document.EntityById.Values.Any(entity => entity.Type == "IFCOPENINGELEMENT"), "source import should not gain the staged opening");
        True(edited.MemoryModel.ObjectsBySourceId.TryGetValue(opening!.Id, out var memoryOpening)
            && memoryOpening.IfcClass == "IFCOPENINGELEMENT"
            && memoryOpening.Name == "Native Opening"
            && memoryOpening.PredefinedType == ".OPENING.", "opening should be stored in memory model");
        True(edited.MemoryModel.Relations.Any(relationship => relationship.IfcClass == "IFCRELVOIDSELEMENT"
            && relationship.SourceObjectIds.Contains(40)
            && relationship.TargetObjectIds.Contains(opening.Id)), "void relationship should be stored in memory model");
        True(edited.RelationshipById.Values.Any(relationship => relationship.Type == "IFCRELVOIDSELEMENT"
            && relationship.SourceIds.Contains(40)
            && relationship.TargetIds.Contains(opening!.Id)), "void relationship not indexed");
        True(edited.PlacementsByEntity.ContainsKey(opening!.Id), "opening placement not indexed");
        True(edited.RepresentationsByEntity.TryGetValue(opening.Id, out var representation), "opening body representation not indexed");
        True(edited.MemoryModel.ProductGeometryByProductId.ContainsKey(opening.Id), "opening geometry should be stored in memory model");
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
        True(!withOpening.EntityById.Values.Any(entity => entity.Type == "IFCDOOR" && entity.Name == "Native Door"), "source opening draft should not gain the staged filling");
        True(edited.MemoryModel.ObjectsBySourceId.TryGetValue(filling!.Id, out var memoryFilling)
            && memoryFilling.IfcClass == "IFCDOOR"
            && memoryFilling.Name == "Native Door", "filling should be stored in memory model");
        True(edited.MemoryModel.Relations.Any(relationship => relationship.IfcClass == "IFCRELFILLSELEMENT"
            && relationship.SourceObjectIds.Contains(opening.Id)
            && relationship.TargetObjectIds.Contains(filling.Id)), "fill relationship should be stored in memory model");
        True(edited.RelationshipById.Values.Any(relationship => relationship.Type == "IFCRELFILLSELEMENT"
            && relationship.SourceIds.Contains(opening.Id)
            && relationship.TargetIds.Contains(filling!.Id)), "fill relationship not indexed");
        True(edited.PlacementsByEntity.TryGetValue(filling!.Id, out var placement) && placement.RelativeToId == edited.PlacementsByEntity[opening.Id].PlacementId, "filling placement should be relative to opening");
        True(edited.RepresentationsByEntity.TryGetValue(filling.Id, out var representation), "filling body representation not indexed");
        True(edited.MemoryModel.ProductGeometryByProductId.ContainsKey(filling.Id), "filling geometry should be stored in memory model");
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
        Equal("#110", document.EntityById[40].Arguments[6], "source import representation should remain unchanged");
        True(assigned.MemoryModel.ProductGeometryByProductId.TryGetValue(40, out var memoryGeometry), "assigned body should be stored in memory model");
        Equal(representation!.ProductDefinitionShapeId, memoryGeometry!.ProductDefinitionShapeSourceId, "memory geometry should own the assigned product definition shape");
        var memoryPrimitive = memoryGeometry.Primitives.Single(primitive => primitive.Kind == "ExtrudedAreaSolid");
        Equal(5.0, memoryPrimitive.SizeX ?? 0, "memory body width");
        Equal(2.5, memoryPrimitive.SizeY ?? 0, "memory body depth");
        Equal(3.0, memoryPrimitive.SizeZ ?? 0, "memory body height");
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

    private static void PropertyTemplatesCreateIndexedPsetAndQto()
    {
        var document = IfcStepParser.CreateSample();

        var withPset = IfcDocumentEditor.AddCommonPropertySet(document, 40, "Native Ref", "Reviewed");
        var pset = withPset.PropertySetsByEntity[40].FirstOrDefault(set => set.Name == "Pset_NativeCommon");

        True(pset is not null, "common pset not assigned to product");
        True(pset!.Values.Any(value => value.Name == "Reference" && value.Value.Contains("Native Ref")), "reference property not indexed");
        True(pset.Values.Any(value => value.Name == "Status" && value.Value.Contains("Reviewed")), "status property not indexed");
        True(!document.PropertySetsByEntity[40].Any(set => set.Name == "Pset_NativeCommon"), "source import should not gain the staged pset");
        True(withPset.MemoryModel.PropertySetsByObjectId[40].Any(set => set.Name == "Pset_NativeCommon"), "common pset should be stored in memory model");
        True(withPset.ToStepText().Contains("IFCPROPERTYSET", StringComparison.Ordinal), "common pset should be exported as STEP only in patched draft");
        True(withPset.RelationshipById.Values.Any(relationship => relationship.Type == "IFCRELDEFINESBYPROPERTIES"
            && relationship.SourceIds.Contains(pset.Id)
            && relationship.TargetIds.Contains(40)), "common pset assignment relationship not indexed");

        var withQto = IfcDocumentEditor.AddBaseQuantitySet(document, 40, "3", "4.5", "6");
        var qto = withQto.PropertySetsByEntity[40].FirstOrDefault(set => set.Name == "Qto_NativeBaseQuantities");

        True(qto is not null, "base qto not assigned to product");
        True(qto!.Values.Any(value => value.Type == "IFCQUANTITYLENGTH" && value.Value == "3."), "length quantity not indexed");
        True(qto.Values.Any(value => value.Type == "IFCQUANTITYAREA" && value.Value == "4.5"), "area quantity not indexed");
        True(qto.Values.Any(value => value.Type == "IFCQUANTITYVOLUME" && value.Value == "6."), "volume quantity not indexed");
        True(!document.PropertySetsByEntity[40].Any(set => set.Name == "Qto_NativeBaseQuantities"), "source import should not gain the staged qto");
        True(withQto.MemoryModel.PropertySetsByObjectId[40].Any(set => set.Name == "Qto_NativeBaseQuantities"), "base qto should be stored in memory model");
        True(IfcDiffService.Summarize(document, withQto).Any(line => line.Contains("IFCELEMENTQUANTITY")), "qto diff should show quantity set addition");
    }

    private static void ResourceAssignmentsCreateIndexedReferences()
    {
        var document = IfcStepParser.CreateSample();

        var assigned = IfcDocumentEditor.AddSimpleMaterialAssignment(document, 40, "Native Concrete");
        var material = assigned.Entities.FirstOrDefault(entity => entity.Type == "IFCMATERIAL" && entity.Arguments.FirstOrDefault() == "'Native Concrete'");

        True(material is not null, "material not created");
        True(assigned.ResourcesByEntity.TryGetValue(40, out var materialResources) && materialResources.Any(resource => resource.Contains("Native Concrete")), "material resource not indexed for product");
        True(!document.ResourcesByEntity.TryGetValue(40, out var sourceResources) || !sourceResources.Any(resource => resource.Contains("Native Concrete")), "source import should not gain the staged material");
        True(assigned.MemoryModel.ResourcesByObjectId.TryGetValue(40, out var memoryResources)
            && memoryResources.Any(resource => resource.IfcClass == "IFCMATERIAL" && resource.Name == "Native Concrete"), "material should be stored in memory model");
        True(assigned.RelationshipById.Values.Any(relationship => relationship.Type == "IFCRELASSOCIATESMATERIAL"
            && relationship.SourceIds.Contains(material!.Id)
            && relationship.TargetIds.Contains(40)), "material assignment relationship not indexed");

        assigned = IfcDocumentEditor.AddSimpleClassificationAssignment(assigned, 40, "Native Class", "NATIVE-42");
        var classification = assigned.Entities.FirstOrDefault(entity => entity.Type == "IFCCLASSIFICATIONREFERENCE" && entity.Arguments.Contains("'Native Class'"));

        True(classification is not null, "classification reference not created");
        True(assigned.ResourcesByEntity[40].Any(resource => resource.Contains("Native Class")), "classification resource not indexed for product");
        True(assigned.MemoryModel.ResourcesByObjectId[40].Any(resource => resource.IfcClass == "IFCCLASSIFICATIONREFERENCE"
            && resource.Name == "Native Class"
            && resource.Identification == "NATIVE-42"), "classification should be stored in memory model");
        True(assigned.RelationshipById.Values.Any(relationship => relationship.Type == "IFCRELASSOCIATESCLASSIFICATION"
            && relationship.SourceIds.Contains(classification!.Id)
            && relationship.TargetIds.Contains(40)), "classification assignment relationship not indexed");

        assigned = IfcDocumentEditor.AddSimpleDocumentAssignment(assigned, 40, "Native Manual", "DOC-1");
        var documentReference = assigned.Entities.FirstOrDefault(entity => entity.Type == "IFCDOCUMENTREFERENCE" && entity.Arguments.Contains("'Native Manual'"));

        True(documentReference is not null, "document reference not created");
        True(assigned.ResourcesByEntity[40].Any(resource => resource.Contains("Native Manual")), "document resource not indexed for product");
        True(assigned.MemoryModel.ResourcesByObjectId[40].Any(resource => resource.IfcClass == "IFCDOCUMENTREFERENCE"
            && resource.Name == "Native Manual"
            && resource.Identification == "DOC-1"), "document reference should be stored in memory model");
        True(assigned.RelationshipById.Values.Any(relationship => relationship.Type == "IFCRELASSOCIATESDOCUMENT"
            && relationship.SourceIds.Contains(documentReference!.Id)
            && relationship.TargetIds.Contains(40)), "document assignment relationship not indexed");

        assigned = IfcDocumentEditor.AddSimpleLibraryAssignment(assigned, 40, "Native Library Item", "LIB-1");
        var libraryReference = assigned.Entities.FirstOrDefault(entity => entity.Type == "IFCLIBRARYREFERENCE" && entity.Arguments.Contains("'Native Library Item'"));

        True(libraryReference is not null, "library reference not created");
        True(assigned.ResourcesByEntity[40].Any(resource => resource.Contains("Native Library Item")), "library resource not indexed for product");
        True(assigned.MemoryModel.ResourcesByObjectId[40].Any(resource => resource.IfcClass == "IFCLIBRARYREFERENCE"
            && resource.Name == "Native Library Item"
            && resource.Identification == "LIB-1"), "library reference should be stored in memory model");
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
        True(!document.EntityById.Values.Any(entity => entity.Type == "IFCBUILDINGELEMENTPROXY" && entity.Name == "Native Child"), "source import should not gain the staged product");
        True(edited.MemoryModel.ObjectsBySourceId.TryGetValue(product!.Id, out var memoryProduct)
            && memoryProduct.IfcClass == "IFCBUILDINGELEMENTPROXY"
            && memoryProduct.Name == "Native Child", "new product should be stored in memory model");
        True(edited.MemoryModel.Relations.Any(relationship => relationship.IfcClass == "IFCRELCONTAINEDINSPATIALSTRUCTURE"
            && relationship.SourceObjectIds.Contains(30)
            && relationship.TargetObjectIds.Contains(product.Id)), "new containment should be stored in memory model");
        True(edited.PlacementsByEntity.ContainsKey(product!.Id), "new product placement not indexed");
        True(edited.RepresentationsByEntity.TryGetValue(product.Id, out var representation), "new product body representation not indexed");
        True(edited.MemoryModel.ProductGeometryByProductId.ContainsKey(product.Id), "new product geometry should be stored in memory model");
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
        Equal("DUPLICATE-GLOBALID", document.EntityById[41].GlobalId, "source import should not gain regenerated duplicate GlobalId");
        Equal(repaired.EntityById[41].GlobalId, repaired.MemoryModel.ObjectsBySourceId[41].GlobalId, "regenerated duplicate GlobalId should be stored in memory model");
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
        Equal(string.Empty, document.EntityById[40].GlobalId, "source import should not gain generated missing GlobalId");
        Equal(repaired.EntityById[40].GlobalId, repaired.MemoryModel.ObjectsBySourceId[40].GlobalId, "generated missing GlobalId should be stored in memory model");
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
        Equal("(#40,#999)", document.EntityById[53].Arguments[4], "source import should not lose dangling relationship reference");
        True(repaired.MemoryModel.Relations.First(relationship => relationship.SourceId == 53).TargetObjectIds.SequenceEqual([40]), "missing relationship reference should be removed from memory relation");
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
        True(document.RelationshipById.ContainsKey(54), "source import should keep duplicate containment relationship");
        True(!repaired.MemoryModel.Relations.Any(relationship => relationship.SourceId == 54), "duplicate containment relationship should be removed from memory model");
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
        True(!document.PlacementsByEntity.ContainsKey(40), "source import should not gain default placement");
        True(withPlacement.MemoryModel.ObjectsBySourceId[40].Placement is not null, "default placement should be stored in memory model");
        True(!withPlacement.Diagnostics.Messages.Any(message => message.Contains("#40 IFCBUILDINGELEMENTPROXY has no ObjectPlacement", StringComparison.OrdinalIgnoreCase)), "missing placement warning should clear after repair");
        True(IfcDiffService.Summarize(document, withPlacement).Any(line => line.Contains("#40") && line.Contains("arg 6")), "placement repair diff should show edited ObjectPlacement argument");

        var withRepresentation = IfcDocumentEditor.AssignDefaultRepresentationFromDiagnostic(document, representationDiagnostic.Message);
        True(withRepresentation.RepresentationsByEntity.ContainsKey(40), "representation repair should index the generated body representation");
        True(!withRepresentation.Diagnostics.Messages.Any(message => message.Contains("#40 IFCBUILDINGELEMENTPROXY has no Representation", StringComparison.OrdinalIgnoreCase)), "missing representation warning should clear after repair");
        True(IfcDiffService.Summarize(document, withRepresentation).Any(line => line.Contains("#40") && line.Contains("arg 7")), "representation repair diff should show edited Representation argument");
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

    private static void NativeUserPreferencesPersistTextZoom()
    {
        var path = Path.Combine(Path.GetTempPath(), $"ifcnative-user-preferences-{Guid.NewGuid():N}.json");
        try
        {
            var store = new NativeUserPreferencesStore(path);
            var viewModel = new MainWindowViewModel(new EmptyFileDialogService(), store);

            Equal(1.0d, viewModel.TextScale, "default text zoom");
            viewModel.IncreaseTextScale();
            Equal(1.1d, viewModel.TextScale, "increased text zoom");
            Equal(1.1d, store.Load().TextScale, "increased text zoom should persist");

            viewModel.DecreaseTextScale();
            viewModel.DecreaseTextScale();
            Equal(0.9d, viewModel.TextScale, "decreased text zoom");
            Equal(0.9d, store.Load().TextScale, "decreased text zoom should persist");

            viewModel.ResetTextScale();
            Equal(1.0d, store.Load().TextScale, "reset text zoom should persist");

            store.Save(new NativeUserPreferences(10));
            Equal(1.8d, store.Load().TextScale, "text zoom should be clamped");
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

        var secondDraft = IfcDocumentEditor.UpdateEntity(redone!, 40, "Second Draft Proxy", string.Empty, string.Join(",", redone!.EntityById[40].Arguments));
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

    private sealed class EmptyFileDialogService : IFileDialogService
    {
        public Task<IReadOnlyList<string>> OpenIfcFilesAsync(bool allowMultiple, CancellationToken cancellationToken = default)
        {
            return Task.FromResult<IReadOnlyList<string>>(Array.Empty<string>());
        }

        public Task<string?> SaveIfcFileAsync(string suggestedFileName, CancellationToken cancellationToken = default)
        {
            return Task.FromResult<string?>(null);
        }
    }

    private static string NormalizeNewlines(string value)
    {
        return value.Replace("\r\n", "\n", StringComparison.Ordinal).Replace("\r", "\n", StringComparison.Ordinal);
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

    private const string RelativeGeometryFixture = """
ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');
FILE_NAME('relative-geometry.ifc','2026-05-24T00:00:00',('IFCnative'),('IFCnative'),'IFCnative Native Windows','IFCnative','');
FILE_SCHEMA(('IFC4X3_ADD2'));
ENDSEC;
DATA;
#1= IFCPROJECT('2XQ2f8a9b2ff4l$IFCnative',$,'IFCnative Native Sample',$,$,$,$,$,$);
#30= IFCBUILDINGSTOREY('0Level8a9b2ff4l$IFCnative',$,'Offset Level',$,$,#60,$,$,$);
#40= IFCBUILDINGELEMENTPROXY('0Proxy8a9b2ff4l$IFCnative',$,'Offset Proxy',$,$,#70,#80,$,$);
#53= IFCRELCONTAINEDINSPATIALSTRUCTURE('1ContLevelProxy0000000',$,'Level Contains Proxy',$,(#40),#30);
#60= IFCLOCALPLACEMENT($,#61);
#61= IFCAXIS2PLACEMENT3D(#62,$,$);
#62= IFCCARTESIANPOINT((10.,20.,0.));
#70= IFCLOCALPLACEMENT(#60,#71);
#71= IFCAXIS2PLACEMENT3D(#72,$,$);
#72= IFCCARTESIANPOINT((1.,2.,3.));
#80= IFCPRODUCTDEFINITIONSHAPE($,$,(#81));
#81= IFCSHAPEREPRESENTATION($,'Body','SweptSolid',(#82));
#82= IFCEXTRUDEDAREASOLID(#83,#90,#84,2.);
#83= IFCRECTANGLEPROFILEDEF(.AREA.,'Offset profile',#95,1.,1.);
#84= IFCDIRECTION((0.,0.,1.));
#90= IFCAXIS2PLACEMENT3D(#91,$,$);
#91= IFCCARTESIANPOINT((0.5,0.25,0.5));
#95= IFCAXIS2PLACEMENT2D(#96,$);
#96= IFCCARTESIANPOINT((0.2,0.1));
ENDSEC;
END-ISO-10303-21;
""";

    private const string RotatedPlacementFixture = """
ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');
FILE_NAME('rotated-placement.ifc','2026-05-24T00:00:00',('IFCnative'),('IFCnative'),'IFCnative Native Windows','IFCnative','');
FILE_SCHEMA(('IFC4X3_ADD2'));
ENDSEC;
DATA;
#1= IFCPROJECT('2XQ2f8a9b2ff4l$IFCnative',$,'IFCnative Native Sample',$,$,$,$,$,$);
#30= IFCBUILDINGSTOREY('0Level8a9b2ff4l$IFCnative',$,'Rotated Level',$,$,$,$,$,$);
#40= IFCBUILDINGELEMENTPROXY('0Proxy8a9b2ff4l$IFCnative',$,'Rotated Proxy',$,$,#70,#80,$,$);
#53= IFCRELCONTAINEDINSPATIALSTRUCTURE('1ContLevelProxy0000000',$,'Level Contains Proxy',$,(#40),#30);
#70= IFCLOCALPLACEMENT($,#71);
#71= IFCAXIS2PLACEMENT3D(#72,#73,#74);
#72= IFCCARTESIANPOINT((0.,0.,0.));
#73= IFCDIRECTION((0.,0.,1.));
#74= IFCDIRECTION((0.,1.,0.));
#80= IFCPRODUCTDEFINITIONSHAPE($,$,(#81));
#81= IFCSHAPEREPRESENTATION($,'Body','SweptSolid',(#82));
#82= IFCEXTRUDEDAREASOLID(#83,$,#84,1.);
#83= IFCRECTANGLEPROFILEDEF(.AREA.,$,$,2.,1.);
#84= IFCDIRECTION((0.,0.,1.));
ENDSEC;
END-ISO-10303-21;
""";

    private const string MappedGeometryFixture = """
ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');
FILE_NAME('mapped-geometry.ifc','2026-05-24T00:00:00',('IFCnative'),('IFCnative'),'IFCnative Native Windows','IFCnative','');
FILE_SCHEMA(('IFC4X3_ADD2'));
ENDSEC;
DATA;
#1= IFCPROJECT('2XQ2f8a9b2ff4l$IFCnative',$,'IFCnative Native Sample',$,$,$,$,$,$);
#30= IFCBUILDINGSTOREY('0Level8a9b2ff4l$IFCnative',$,'Mapped Level',$,$,$,$,$,$);
#40= IFCBUILDINGELEMENTPROXY('0Proxy8a9b2ff4l$IFCnative',$,'Mapped Proxy',$,$,#70,#80,$,$);
#53= IFCRELCONTAINEDINSPATIALSTRUCTURE('1ContLevelProxy0000000',$,'Level Contains Proxy',$,(#40),#30);
#70= IFCLOCALPLACEMENT($,#71);
#71= IFCAXIS2PLACEMENT3D(#72,$,$);
#72= IFCCARTESIANPOINT((0.,0.,0.));
#80= IFCPRODUCTDEFINITIONSHAPE($,$,(#81));
#81= IFCSHAPEREPRESENTATION($,'Body','MappedRepresentation',(#90));
#90= IFCMAPPEDITEM(#100,#110);
#100= IFCREPRESENTATIONMAP(#101,#102);
#101= IFCAXIS2PLACEMENT3D(#103,$,$);
#102= IFCSHAPEREPRESENTATION($,'Body','SweptSolid',(#120));
#103= IFCCARTESIANPOINT((0.,0.,0.));
#110= IFCCARTESIANTRANSFORMATIONOPERATOR3D(#111,$,#112,2.,$);
#111= IFCDIRECTION((0.,1.,0.));
#112= IFCCARTESIANPOINT((5.,6.,0.));
#120= IFCEXTRUDEDAREASOLID(#121,$,#122,1.);
#121= IFCRECTANGLEPROFILEDEF(.AREA.,'Mapped profile',$,2.,1.);
#122= IFCDIRECTION((0.,0.,1.));
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
