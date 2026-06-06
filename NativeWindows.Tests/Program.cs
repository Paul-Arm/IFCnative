using IFCnative.NativeWindows.Models;
using IFCnative.NativeWindows.Services;
using IFCnative.NativeWindows.ViewModels;

XbimIfcDocumentService.ConfigureToolkit();
var tests = new NativeTestRunner();
tests.RunAll();
Console.WriteLine($"xBIM native app tests passed: {tests.Passed}");

internal sealed class NativeTestRunner
{
    public int Passed { get; private set; }

    public void RunAll()
    {
        Run("xBIM sample projects tree inspector psets relations placement and refs", XbimSampleProjectsTreeInspectorPsetsRelationsPlacementAndRefs);
        Run("xBIM editor updates entity property and placement", XbimEditorUpdatesEntityPropertyAndPlacement);
        Run("xBIM editor creates psets quantities resources and products", XbimEditorCreatesPsetsQuantitiesResourcesAndProducts);
        Run("xBIM editor updates spatial parents and relationships", XbimEditorUpdatesSpatialParentsAndRelationships);
        Run("xBIM geometry backend projects sample meshes", XbimGeometryBackendProjectsSampleMeshes);
        Run("xBIM GeometryStore builds finite render scene", XbimGeometryStoreBuildsFiniteRenderScene);
        Run("viewport selection highlights without scene rebuild", ViewportSelectionHighlightsWithoutSceneRebuild);
        Run("xBIM geometry dirty handling preserves pset edits only", XbimGeometryDirtyHandlingPreservesPsetEditsOnly);
        Run("product id picking color roundtrips", ProductIdPickingColorRoundtrips);
        Run("viewport camera supports blender style frame pan and dolly", ViewportCameraSupportsBlenderStyleFramePanAndDolly);
        Run("xBIM export validation roundtrips the store", XbimExportValidationRoundtripsStore);
        Run("IFC file loader reads and writes ifcZIP archives", IfcFileLoaderReadsAndWritesIfcZipArchives);
        Run("xBIM editor commits directly to the in-memory store", XbimEditorCommitsDirectlyToInMemoryStore);
        Run("main window commits inspector edits through xBIM", MainWindowCommitsInspectorEditsThroughXbim);
        Run("relationship graph supports filter and depth", RelationshipGraphSupportsFilterAndDepth);
        Run("diagnostics projector supports text and severity filters", DiagnosticsProjectorSupportsFilters);
        Run("main window commits diagnostic repairs through xBIM", MainWindowCommitsDiagnosticRepairsThroughXbim);
        Run("status log command activates copyable console", StatusLogCommandActivatesCopyableConsole);
        Run("native stores persist sanitized settings", NativeStoresPersistSanitizedSettings);
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

    private static void XbimSampleProjectsTreeInspectorPsetsRelationsPlacementAndRefs()
    {
        var document = Sample();

        True(document.XbimStore is not null, "sample should keep the xBIM store");
        Equal("IFC4X3", document.Schema, "sample schema");
        True(document.EntityById.TryGetValue(40, out var proxy), "sample proxy missing");
        True(document.SpatialRoots.Count == 1, "sample spatial tree should have one project root");
        True(document.EntitiesByType.TryGetValue("IFCBUILDINGELEMENTPROXY", out var proxies) && proxies.Count == 1, "proxy type count missing");

        var details = IfcSelectionProjector.Project(document, proxy!);
        True(details.SpatialPath.Contains("Sample Inspection Block", StringComparison.OrdinalIgnoreCase), "spatial path should include selected product");
        True(details.PropertySetTables.Any(table => table.Name == "Pset_IFCnative"
            && table.Rows.Any(row => row.Name == "ReviewStatus" && row.CanEdit)), "pset table should expose editable ReviewStatus");
        True(details.PropertySets.Any(item => item.Label.Contains("Native editable shell", StringComparison.OrdinalIgnoreCase)), "flat pset list should include property value");
        True(details.Relationships.Any(item => item.Label.Contains("IFCRELDEFINESBYPROPERTIES", StringComparison.OrdinalIgnoreCase)), "property relationship missing");
        True(details.Relationships.Any(item => item.Label.Contains("IFCRELCONTAINEDINSPATIALSTRUCTURE", StringComparison.OrdinalIgnoreCase)), "spatial relationship missing");
        True(details.IncomingReferences.Any(item => item.Contains("#53", StringComparison.OrdinalIgnoreCase)), "incoming refs should include spatial relationship");
        True(details.Placement.CanEdit && details.Placement.X == "0" && details.Placement.Y == "0" && details.Placement.Z == "0", "placement should be editable");
        True(details.Representations.Any(item => item.Contains("Product shape", StringComparison.OrdinalIgnoreCase)), "representation summary missing");
    }

    private static void XbimEditorUpdatesEntityPropertyAndPlacement()
    {
        var document = Sample();
        var propertyId = ReviewStatusPropertyId(document);

        var renamed = XbimDocumentEditor.UpdateEntity(document, 40, "Renamed xBIM Proxy", "Edited through xBIM");
        Equal("Renamed xBIM Proxy", renamed.EntityById[40].Name, "entity name should update");
        Equal("Edited through xBIM", renamed.EntityById[40].Description, "entity description should update");

        var propertyEdited = XbimDocumentEditor.UpdatePropertyValue(renamed, propertyId, "'Reviewed'");
        var reviewStatus = PropertyRows(propertyEdited, 40).Single(row => row.Label.Contains("ReviewStatus", StringComparison.OrdinalIgnoreCase));
        Equal("Reviewed", reviewStatus.Value, "property value should update");

        var placed = XbimDocumentEditor.UpdatePlacement(propertyEdited, 40, "1.25", "-2", "3");
        var placement = placed.PlacementsByEntity[40];
        Equal(1.25d, placement.X, "placement X should update");
        Equal(-2d, placement.Y, "placement Y should update");
        Equal(3d, placement.Z, "placement Z should update");

        var withBody = XbimDocumentEditor.AssignBodyRepresentation(placed, 40, "5", "2.5", "3", "rectangle");
        True(withBody.RepresentationsByEntity.TryGetValue(40, out var representation)
            && representation.GeometryItemIds.Count > 0, "body assignment should create xBIM representation items");
    }

    private static void XbimEditorCreatesPsetsQuantitiesResourcesAndProducts()
    {
        var document = Sample();

        var withPset = XbimDocumentEditor.AddCommonPropertySet(document, 40, "XBIM-REF", "Reviewed");
        True(withPset.PropertySetsByEntity[40].Any(set => set.Name == "Pset_NativeCommon"
            && set.Values.Any(value => value.Name == "Reference" && value.Value == "XBIM-REF")), "common pset should be projected from xBIM");

        var withQto = XbimDocumentEditor.AddBaseQuantitySet(withPset, 40, "3", "4.5", "6");
        True(withQto.PropertySetsByEntity[40].Any(set => set.Name == "Qto_NativeBaseQuantities"
            && set.Values.Any(value => value.Type == "IFCQUANTITYLENGTH" && value.Value == "6")), "base qto should be projected from xBIM");

        var withMaterial = XbimDocumentEditor.AddResource(withQto, 40, "material", "xBIM Concrete", "MAT-1");
        True(withMaterial.ResourcesByEntity.TryGetValue(40, out var resources)
            && resources.Any(resource => resource.Contains("MATERIAL", StringComparison.OrdinalIgnoreCase)), "material resource should be indexed");

        var beforeIds = withMaterial.EntityById.Keys.ToHashSet();
        var withProduct = XbimDocumentEditor.AddProductWithBodyRepresentation(withMaterial, 30, "IFCBUILDINGELEMENTPROXY", "xBIM Child", "2", "1", "3", "rectangle");
        var productId = withProduct.EntityById.Keys.Except(beforeIds).OrderBy(id => id).First(id => withProduct.EntityById[id].Type == "IFCBUILDINGELEMENTPROXY");
        True(withProduct.EntityById[productId].Name == "xBIM Child", "new product should be named");
        True(withProduct.RelationshipById.Values.Any(relationship => relationship.Type == "IFCRELCONTAINEDINSPATIALSTRUCTURE"
            && relationship.SourceIds.Contains(30)
            && relationship.TargetIds.Contains(productId)), "new product should be spatially contained");
        True(withProduct.RepresentationsByEntity.ContainsKey(productId), "new product should have xBIM body representation");
        True(withProduct.SpatialPathByEntity.TryGetValue(productId, out var path)
            && path.Contains("xBIM Child", StringComparison.OrdinalIgnoreCase), "new product should appear in spatial tree");
    }

    private static void XbimEditorUpdatesSpatialParentsAndRelationships()
    {
        var document = Sample();

        var moved = XbimDocumentEditor.UpdateSpatialParent(document, 40, "#20");
        var movedSpatial = IfcSelectionProjector.Project(moved, moved.EntityById[40]).Spatial;
        Equal("#20", movedSpatial.ParentId, "spatial parent should move to building");

        var detached = XbimDocumentEditor.RemoveFromSpatialParent(moved, 40);
        var detachedSpatial = IfcSelectionProjector.Project(detached, detached.EntityById[40]).Spatial;
        True(!detachedSpatial.CanEdit, "detached product should have no primary spatial relation");

        var beforeIds = document.RelationshipById.Keys.ToHashSet();
        var added = XbimDocumentEditor.AddRelationship(document, "IFCRELDEFINESBYPROPERTIES", "#60", "#40", "xBIM pset link");
        var relationshipId = added.RelationshipById.Keys.Except(beforeIds).Single();
        True(added.RelationshipById[relationshipId].SourceIds.Contains(60), "created relationship should keep source pset");
        True(added.RelationshipById[relationshipId].TargetIds.Contains(40), "created relationship should keep target product");

        var deleted = XbimDocumentEditor.DeleteRelationship(added, relationshipId);
        True(!deleted.RelationshipById.ContainsKey(relationshipId), "relationship should delete through xBIM transaction");
    }

    private static void XbimGeometryBackendProjectsSampleMeshes()
    {
        var document = Sample();
        var backend = new XbimGeometryBackend();
        var validation = backend.ValidateDocument(document);
        True(validation.Errors.Count == 0, string.Join(Environment.NewLine, validation.Errors));

        var items = backend.ProjectSelection(document, 40);
        var meshes = backend.BuildPreviewMeshes(document, items);
        True(items.Any(item => item.Label.Contains("xBIM shape", StringComparison.OrdinalIgnoreCase)), "selection should list xBIM shape instances");
        True(meshes.Any(mesh => mesh.IsRenderable), "xBIM geometry backend should build renderable meshes");
    }

    private static void XbimGeometryStoreBuildsFiniteRenderScene()
    {
        var document = Sample();
        var backend = new XbimGeometryBackend();
        var scene = backend.BuildRenderSceneAsync(document, IfcRenderSceneRequest.FullModel).GetAwaiter().GetResult();

        True(!scene.IsEmpty, "render scene should contain geometry");
        True(scene.Meshes.Any(mesh => mesh.ProductId == 40), "scene should contain sample product #40");
        True(scene.TriangleCount > 0, "scene should contain triangles");
        True(IsFinite(scene.Bounds.MinX) && IsFinite(scene.Bounds.MaxX), "scene bounds should be finite");

        var mesh = scene.Meshes.First(mesh => mesh.ProductId == 40 && mesh.IsRenderable);
        True(mesh.Indices.All(index => index >= 0 && index < mesh.Vertices.Count), "mesh indices should address vertices");
        True(mesh.Vertices.All(vertex =>
            IsFinite(vertex.X)
            && IsFinite(vertex.Y)
            && IsFinite(vertex.Z)
            && IsFinite(vertex.NormalX)
            && IsFinite(vertex.NormalY)
            && IsFinite(vertex.NormalZ)), "mesh vertices and normals should be finite");

        var selectedScene = backend.BuildRenderSceneAsync(document, IfcRenderSceneRequest.ForProduct(40)).GetAwaiter().GetResult();
        True(!selectedScene.IsEmpty && selectedScene.Meshes.All(value => value.ProductId == 40), "product scene should use ShapeInstancesOfEntity filtering");
    }

    private static void ViewportSelectionHighlightsWithoutSceneRebuild()
    {
        WithTempDirectory(temp =>
        {
            var document = Sample();
            var backend = new CountingGeometryBackend();
            var owner = new MainWindowViewModel(new TestFileDialogs(), new NativeUserPreferencesStore(Path.Combine(temp, "preferences.json")));
            var viewport = new ViewportPanelViewModel(owner, backend);

            viewport.SetDocument(document);
            Equal(1, backend.SceneBuilds, "document load should request one render scene");
            viewport.SetSelection(document, document.EntityById[40]);

            Equal(40, viewport.SelectedProductId, "selection should set highlighted product id");
            Equal(1, backend.SceneBuilds, "selection highlight should not rebuild geometry");
        });
    }

    private static void XbimGeometryDirtyHandlingPreservesPsetEditsOnly()
    {
        var document = Sample();
        var backend = new XbimGeometryBackend();
        _ = backend.BuildRenderSceneAsync(document, IfcRenderSceneRequest.FullModel).GetAwaiter().GetResult();
        var context = XbimIfcDocumentService.TryGetGeometryContext(document);
        True(context is not null, "render scene build should create an xBIM geometry context");

        var withPset = XbimDocumentEditor.AddCommonPropertySet(document, 40, "NO-GEOM", "Reviewed");
        True(ReferenceEquals(context, XbimIfcDocumentService.TryGetGeometryContext(withPset)), "pset edit should preserve geometry context");

        var moved = XbimDocumentEditor.UpdatePlacement(withPset, 40, "2", "0", "0");
        True(XbimIfcDocumentService.TryGetGeometryContext(moved) is null, "placement edit should invalidate geometry context");
    }

    private static void ProductIdPickingColorRoundtrips()
    {
        var ids = new[] { 0, 1, 40, 65_535, 1_048_576, 0x00FFFFFE };
        foreach (var id in ids)
        {
            var color = IfcRenderPicking.EncodeProductId(id);
            var decoded = IfcRenderPicking.DecodeProductId(
                (byte)Math.Round(color.R * 255),
                (byte)Math.Round(color.G * 255),
                (byte)Math.Round(color.B * 255));
            Equal(id, decoded, $"product id {id} should roundtrip through RGB picking color");
        }
    }

    private static void ViewportCameraSupportsBlenderStyleFramePanAndDolly()
    {
        var bounds = IfcRenderBounds.Empty
            .Include(-2, -1, 0)
            .Include(4, 3, 5);
        var framed = NativeViewportCameraController.FitBounds(bounds, -30, 20);

        Equal(1d, Math.Round(framed.Target.X, 6), "framed camera should target bounds center X");
        Equal(1d, Math.Round(framed.Target.Y, 6), "framed camera should target bounds center Y");
        Equal(2.5d, Math.Round(framed.Target.Z, 6), "framed camera should target bounds center Z");
        True(framed.Distance > framed.SceneRadius, "framed camera should stand away from the object");

        var panned = NativeViewportCameraController.Pan(framed, 40, -20, 1200, 800);
        True(panned.Target != framed.Target, "pan should move the camera target");
        Equal(framed.Distance, panned.Distance, "pan should preserve camera distance");

        var closer = NativeViewportCameraController.Dolly(framed, -80);
        var farther = NativeViewportCameraController.Dolly(framed, 80);
        True(closer.Distance < framed.Distance, "negative dolly should move closer");
        True(farther.Distance > framed.Distance, "positive dolly should move farther");
    }

    private static void XbimExportValidationRoundtripsStore()
    {
        var document = XbimDocumentEditor.UpdateEntity(Sample(), 40, "Exported xBIM Proxy", string.Empty);
        var validation = IfcExportValidator.Validate(document, new XbimGeometryBackend());
        True(validation.CanExport, string.Join(Environment.NewLine, validation.Errors));

        var exportedStep = XbimIfcDocumentService.NormalizeForExport(document);
        True(exportedStep.Contains("IFCBUILDINGELEMENTPROXY", StringComparison.OrdinalIgnoreCase), "export should contain product");
        True(exportedStep.Contains("Exported xBIM Proxy", StringComparison.OrdinalIgnoreCase), "export should contain edited name");

        var reopened = XbimIfcDocumentService.OpenText(exportedStep, "roundtrip.ifc");
        Equal("Exported xBIM Proxy", reopened.EntityById[40].Name, "roundtrip should keep edited name");
    }

    private static void IfcFileLoaderReadsAndWritesIfcZipArchives()
    {
        WithTempDirectory(temp =>
        {
            var document = Sample();
            var step = XbimIfcDocumentService.NormalizeForExport(document);
            var path = Path.Combine(temp, "model.ifczip");

            IfcFileLoader.WriteText(path, step, document.FileName);
            var loaded = IfcFileLoader.ReadAsync(path).GetAwaiter().GetResult();

            True(loaded.FileName.EndsWith(".ifc", StringComparison.OrdinalIgnoreCase), "ifcZIP entry should expose an IFC file name");
            True(loaded.Text.Contains("ISO-10303-21", StringComparison.OrdinalIgnoreCase), "ifcZIP should contain STEP text");
        });
    }

    private static void XbimEditorCommitsDirectlyToInMemoryStore()
    {
        var document = Sample();
        var store = document.XbimStore;
        var edited = XbimDocumentEditor.UpdateEntity(document, 40, "Committed xBIM Proxy", string.Empty);

        True(store is not null && ReferenceEquals(store, edited.XbimStore), "edit should keep the same xBIM store instance");
        Equal("Committed xBIM Proxy", edited.EntityById[40].Name, "projection should reflect committed transaction");

        var exportedStep = XbimIfcDocumentService.NormalizeForExport(edited);
        True(exportedStep.Contains("Committed xBIM Proxy", StringComparison.OrdinalIgnoreCase), "committed xBIM transaction should export");
    }

    private static void MainWindowCommitsInspectorEditsThroughXbim()
    {
        WithTempDirectory(temp =>
        {
            var preferences = new NativeUserPreferencesStore(Path.Combine(temp, "preferences.json"));
            var owner = new MainWindowViewModel(new TestFileDialogs(), preferences);
            owner.SelectEntityById(40);
            owner.AddCommonPropertySet();

            True(owner.ActiveSession?.DraftSession.HasDraft == false, "inspector pset command should commit without pending draft");
            True(owner.ActiveSession?.IsDirty == true, "committed xBIM edit should mark the session modified");
            True(owner.ActiveSession!.Document.XbimStore is not null, "committed document should be xBIM-backed");
            True(owner.ActiveSession.Document.PropertySetsByEntity[40].Any(set => set.Name == "Pset_NativeCommon"), "committed pset should be visible in inspector projection");

            owner.OpenLog();
            True(owner.Console.LogText.Contains("status:", StringComparison.OrdinalIgnoreCase), "log panel should contain copyable status text");
        });
    }

    private static void RelationshipGraphSupportsFilterAndDepth()
    {
        var document = Sample();
        var entity = document.EntityById[40];

        var all = IfcSelectionProjector.ProjectRelationshipGraph(document, entity, null, 2);
        True(all.Any(item => item.EntityId == 30), "relationship graph should include spatial parent");

        var filtered = IfcSelectionProjector.ProjectRelationshipGraph(document, entity, "Pset", 2);
        True(filtered.Any(item => item.Label.Contains("IFCRELDEFINESBYPROPERTIES", StringComparison.OrdinalIgnoreCase)), "filtered graph should include pset relation");
    }

    private static void DiagnosticsProjectorSupportsFilters()
    {
        var diagnostics = IfcDiagnosticsProjector.Project([
            "Info: Loaded xBIM document.",
            "Warning: #40 IFCBUILDINGELEMENTPROXY has no Representation.",
            "Error: Relationship #53 IFCRELCONTAINEDINSPATIALSTRUCTURE references missing entity #999.",
        ], "missing");

        Equal("Error", diagnostics[0].Severity, "error should sort first");
        True(diagnostics[0].CanRepairMissingReference, "missing reference diagnostic should be repairable");

        var empty = IfcDiagnosticsProjector.Project(["Info: ok"], "no-match");
        True(empty.Single().Message.Contains("No diagnostics match", StringComparison.OrdinalIgnoreCase), "empty filter result should explain itself");
    }

    private static void MainWindowCommitsDiagnosticRepairsThroughXbim()
    {
        WithTempDirectory(temp =>
        {
            var document = XbimDocumentEditor.AddProduct(Sample(), 30, "IFCBUILDINGELEMENTPROXY", "No Body Yet");
            var productId = document.EntityById.Values.Single(entity => entity.Name == "No Body Yet").Id;
            var diagnostic = IfcDiagnosticsProjector.Project(document.Diagnostics.Messages)
                .Single(item => item.EntityId == productId && item.CanRepairRepresentation);
            var owner = new MainWindowViewModel(new TestFileDialogs(), new NativeUserPreferencesStore(Path.Combine(temp, "preferences.json")))
            {
                ActiveSession = new IfcDocumentSessionViewModel(document, null),
            };
            owner.SelectEntityById(productId);
            owner.RepairDiagnostic(diagnostic);

            True(!owner.ActiveSession!.DraftSession.HasDraft, "diagnostic repair should commit without pending draft");
            True(owner.ActiveSession.IsDirty, "diagnostic repair should mark the session modified");
            True(owner.ActiveSession.Document.RepresentationsByEntity.ContainsKey(productId), "representation repair should add xBIM body");
        });
    }

    private static void StatusLogCommandActivatesCopyableConsole()
    {
        WithTempDirectory(temp =>
        {
            var owner = new MainWindowViewModel(new TestFileDialogs(), new NativeUserPreferencesStore(Path.Combine(temp, "preferences.json")));
            owner.OpenLog();
            True(owner.Console.LogText.Contains("status:", StringComparison.OrdinalIgnoreCase), "console should receive current status line");
        });
    }

    private static void NativeStoresPersistSanitizedSettings()
    {
        WithTempDirectory(temp =>
        {
            var layoutStore = new NativeWindowLayoutStore(Path.Combine(temp, "layout.json"));
            layoutStore.Save(new NativeWindowLayout(WindowWidth: 10, WindowHeight: double.NaN, ModelPaneWidth: 1, InspectorPaneWidth: 9999));
            var layout = layoutStore.Load();
            Equal(1100d, layout.WindowWidth, "layout width should be clamped");
            Equal(900d, layout.WindowHeight, "layout height should fall back");
            Equal(260d, layout.ModelPaneWidth, "model pane width should be clamped");
            Equal(900d, layout.InspectorPaneWidth, "inspector pane width should be clamped");

            var preferencesStore = new NativeUserPreferencesStore(Path.Combine(temp, "preferences.json"));
            preferencesStore.Save(new NativeUserPreferences(TextScale: 20));
            Equal(1.8d, preferencesStore.Load().TextScale, "text scale should be clamped");
        });
    }

    private static IfcDocument Sample()
    {
        return XbimIfcDocumentService.CreateSample();
    }

    private static int ReviewStatusPropertyId(IfcDocument document)
    {
        return PropertyRows(document, 40).Single(row => row.Label.Contains("ReviewStatus", StringComparison.OrdinalIgnoreCase)).EntityId!.Value;
    }

    private static IReadOnlyList<IfcPropertyDetails> PropertyRows(IfcDocument document, int entityId)
    {
        return IfcSelectionProjector.Project(document, document.EntityById[entityId])
            .PropertySets
            .Where(property => property.EntityId is not null)
            .ToList();
    }

    private static void WithTempDirectory(Action<string> action)
    {
        var temp = Path.Combine(Path.GetTempPath(), "ifcnative-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(temp);
        try
        {
            action(temp);
        }
        finally
        {
            var tempRoot = Path.GetFullPath(Path.Combine(Path.GetTempPath(), "ifcnative-tests")).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
                + Path.DirectorySeparatorChar;
            var resolved = Path.GetFullPath(temp);
            if (resolved.StartsWith(tempRoot, StringComparison.OrdinalIgnoreCase))
            {
                Directory.Delete(resolved, recursive: true);
            }
        }
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

    private static bool IsFinite(float value)
    {
        return !float.IsNaN(value) && !float.IsInfinity(value);
    }

    private sealed class CountingGeometryBackend : IIfcGeometryBackend
    {
        public int SceneBuilds { get; private set; }

        public string Name => "counting geometry";

        public string Status => "counting";

        public IfcGeometryValidationResult ValidateDocument(IfcDocument document)
        {
            return new IfcGeometryValidationResult(Name, [], []);
        }

        public IReadOnlyList<IfcViewportItem> ProjectDocument(IfcDocument document, int limit = 250)
        {
            return [new IfcViewportItem(40, "sample")];
        }

        public IReadOnlyList<IfcViewportItem> ProjectSelection(IfcDocument document, int entityId, int limit = 80)
        {
            return [new IfcViewportItem(entityId, $"selected #{entityId}")];
        }

        public IReadOnlyList<IfcPreviewMesh> BuildPreviewMeshes(IfcDocument document, IReadOnlyList<IfcViewportItem> items, int limit = 48)
        {
            return [];
        }

        public Task<IfcRenderScene> BuildRenderSceneAsync(
            IfcDocument document,
            IfcRenderSceneRequest request,
            CancellationToken cancellationToken = default,
            IProgress<string>? progress = null)
        {
            SceneBuilds++;
            return Task.FromResult(IfcRenderScene.Empty("counted"));
        }
    }

    private sealed class TestFileDialogs : IFileDialogService
    {
        public Task<IReadOnlyList<string>> OpenIfcFilesAsync(bool allowMultiple, CancellationToken cancellationToken = default)
        {
            return Task.FromResult<IReadOnlyList<string>>([]);
        }

        public Task<string?> SaveIfcFileAsync(string suggestedFileName, CancellationToken cancellationToken = default)
        {
            return Task.FromResult<string?>(null);
        }
    }
}
