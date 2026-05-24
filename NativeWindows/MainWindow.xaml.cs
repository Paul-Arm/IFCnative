using System.IO;
using System.Windows;
using System.Windows.Controls;
using IFCnative.NativeWindows.Models;
using IFCnative.NativeWindows.Services;
using IFCnative.NativeWindows.ViewModels;
using Microsoft.Win32;

namespace IFCnative.NativeWindows;

public partial class MainWindow : Window
{
    private readonly string[] capabilities =
    [
        "Done: Native Windows shell",
        "Done: flexible native panels",
        "Done: IFC/STEP preflight",
        "Done: header/schema extraction",
        "Done: typed entity index",
        "Done: relationship index",
        "Done: property/resource/type/unit indexes",
        "Done: product placement index/editor",
        "Done: product representation index",
        "Done: rectangle/cylinder body preset draft workflows",
        "Done: opening/void draft workflow with body presets",
        "Done: opening filling draft workflow with body presets",
        "Done: common Pset/base Qto template draft workflows",
        "Done: geometry backend abstraction and STEP-reference viewport preview",
        "Done: cancellable async IFC file loading",
        "Done: duplicate GlobalId and containment diagnostics",
        "Done: grouped diagnostics with repair suggestions",
        "Done: spatial containment tree",
        "Done: spatial reparent draft editor",
        "Done: native relationship create/edit/delete workflows",
        "Done: relationship neighborhood graph panel",
        "Done: pinned entity bookmarks",
        "Done: persisted recent files",
        "Done: entity inspector",
        "Done: basic entity editing/export",
        "Next: web-ifc WASM mesh/tessellation bridge",
        "Next: richer psets/quantities normalization",
        "Next: native writer helpers",
        "Unsupported: IDS/MVD validation",
        "Unsupported: ifcZIP/ifcXML",
    ];

    private IfcDocument? document;
    private IfcEntity? selectedEntity;
    private IfcRelationshipDetails selectedRelationship = IfcRelationshipDetails.Empty;
    private IfcSpatialDetails selectedSpatial = IfcSpatialDetails.None;
    private IfcPropertyDetails selectedProperty = IfcPropertyDetails.Empty;
    private CancellationTokenSource? openCancellation;
    private readonly RecentFileStore recentFileStore = new();
    private readonly IfcDraftSession draftSession = new();
    private readonly IIfcGeometryBackend geometryBackend = new StepReferenceGeometryBackend();
    private readonly HashSet<int> bookmarkedEntityIds = [];
    private bool updatingUi;

    public MainWindow()
    {
        InitializeComponent();
        CapabilityList.ItemsSource = capabilities;
        RefreshRecentFiles();
        LoadDocument(IfcStepParser.CreateSample());
    }

    private async void OpenIfc_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFileDialog
        {
            Filter = "IFC files (*.ifc)|*.ifc|STEP files (*.stp;*.step)|*.stp;*.step|All files (*.*)|*.*",
            Title = "Open IFC file",
        };

        if (dialog.ShowDialog(this) != true)
        {
            return;
        }

        await OpenIfcFileAsync(dialog.FileName);
    }

    private async Task OpenIfcFileAsync(string path)
    {
        openCancellation?.Cancel();
        openCancellation = new CancellationTokenSource();
        SetOpenInProgress(true);

        try
        {
            var progress = new Progress<string>(message => StatusText.Text = message);
            var text = await IfcFileLoader.ReadTextAsync(path, progress, openCancellation.Token);
            StatusText.Text = $"Parsing {Path.GetFileName(path)}…";
            var parsed = await Task.Run(() => IfcStepParser.Parse(text, Path.GetFileName(path)), openCancellation.Token);
            LoadDocument(parsed);
            recentFileStore.Add(path);
            RefreshRecentFiles();
        }
        catch (OperationCanceledException)
        {
            StatusText.Text = "Open cancelled.";
        }
        catch (Exception exception)
        {
            StatusText.Text = $"Open failed: {exception.Message}";
        }
        finally
        {
            SetOpenInProgress(false);
            openCancellation?.Dispose();
            openCancellation = null;
        }
    }

    private void CancelOpen_Click(object sender, RoutedEventArgs e)
    {
        openCancellation?.Cancel();
    }

    private void SetOpenInProgress(bool inProgress)
    {
        OpenButton.IsEnabled = !inProgress;
        LoadSampleButton.IsEnabled = !inProgress;
        CancelOpenButton.IsEnabled = inProgress;
    }

    private void LoadSample_Click(object sender, RoutedEventArgs e)
    {
        LoadDocument(IfcStepParser.CreateSample());
    }

    private void ExportIfc_Click(object sender, RoutedEventArgs e)
    {
        if (document is null)
        {
            return;
        }

        if (!draftSession.CanExport)
        {
            StatusText.Text = "Apply or discard the pending draft before exporting.";
            return;
        }

        var dialog = new SaveFileDialog
        {
            Filter = "IFC files (*.ifc)|*.ifc|All files (*.*)|*.*",
            FileName = document.FileName,
            Title = "Export IFC file",
        };

        if (dialog.ShowDialog(this) != true)
        {
            return;
        }

        var validation = IfcExportValidator.Validate(document, geometryBackend);
        if (!validation.CanExport)
        {
            StatusText.Text = validation.Summary;
            MessageBox.Show(
                this,
                string.Join(Environment.NewLine, validation.Errors.Take(8)),
                "IFC export validation failed",
                MessageBoxButton.OK,
                MessageBoxImage.Warning);
            return;
        }

        File.WriteAllText(dialog.FileName, document.ToStepText());
        var warningSuffix = validation.Warnings.Count == 0 ? string.Empty : $" with {validation.Warnings.Count:N0} warning(s)";
        StatusText.Text = $"Exported {Path.GetFileName(dialog.FileName)} after validation{warningSuffix}.";
    }

    private void SaveEdit_Click(object sender, RoutedEventArgs e)
    {
        if (document is null || selectedEntity is null)
        {
            return;
        }

        var selectedId = selectedEntity.Id;
        StageDraft(
            IfcDocumentEditor.UpdateEntity(document, selectedId, EntityNameBox.Text, EntityDescriptionBox.Text, RawArgsBox.Text),
            selectedId,
            $"Staged entity edit for #{selectedId}");
    }

    private void SaveSpatialParent_Click(object sender, RoutedEventArgs e)
    {
        if (document is null || selectedEntity is null || selectedSpatial.RelationshipId is null || !selectedSpatial.CanEdit)
        {
            return;
        }

        var selectedId = selectedEntity.Id;
        StageDraft(IfcDocumentEditor.UpdateSpatialParent(document, selectedId, SpatialParentBox.Text), selectedId, $"Staged spatial parent edit for #{selectedId}");
    }

    private void DetachSpatialParent_Click(object sender, RoutedEventArgs e)
    {
        if (document is null || selectedEntity is null || selectedSpatial.RelationshipId is null || !selectedSpatial.CanEdit)
        {
            return;
        }

        var selectedId = selectedEntity.Id;
        StageDraft(IfcDocumentEditor.RemoveFromSpatialParent(document, selectedId), selectedId, $"Staged spatial detach for #{selectedId}");
    }

    private void SavePlacement_Click(object sender, RoutedEventArgs e)
    {
        if (document is null || selectedEntity is null)
        {
            return;
        }

        var selectedId = selectedEntity.Id;
        StageDraft(IfcDocumentEditor.UpdatePlacement(document, selectedId, PlacementXBox.Text, PlacementYBox.Text, PlacementZBox.Text), selectedId, $"Staged placement edit for #{selectedId}");
    }

    private void SaveProperty_Click(object sender, RoutedEventArgs e)
    {
        if (document is null || selectedEntity is null || selectedProperty.EntityId is null || !selectedProperty.CanEdit)
        {
            return;
        }

        var selectedId = selectedEntity.Id;
        StageDraft(IfcDocumentEditor.UpdatePropertyValue(document, selectedProperty.EntityId.Value, PropertyValueBox.Text), selectedId, $"Staged property edit for #{selectedProperty.EntityId.Value}");
    }

    private void AddCommonPset_Click(object sender, RoutedEventArgs e)
    {
        if (document is null || selectedEntity is null || !CanAttachPropertyTemplates(selectedEntity))
        {
            return;
        }

        var beforeIds = document.PropertySetById.Keys.ToHashSet();
        var selectedId = selectedEntity.Id;
        var draft = IfcDocumentEditor.AddCommonPropertySet(document, selectedId, selectedEntity.DisplayName, "New");
        var propertySetId = draft.PropertySetById.Keys.Except(beforeIds).OrderBy(id => id).Select(id => (int?)id).FirstOrDefault();
        if (propertySetId is null)
        {
            StatusText.Text = "No common property set created for this selection.";
            return;
        }

        StageDraft(draft, selectedId, $"Staged common property set #{propertySetId.Value} for #{selectedId}");
    }

    private void AddBaseQto_Click(object sender, RoutedEventArgs e)
    {
        if (document is null || selectedEntity is null || !CanAttachPropertyTemplates(selectedEntity))
        {
            return;
        }

        var beforeIds = document.PropertySetById.Keys.ToHashSet();
        var selectedId = selectedEntity.Id;
        var draft = IfcDocumentEditor.AddBaseQuantitySet(document, selectedId, BodyHeightBox.Text, BodyWidthBox.Text, BodyDepthBox.Text);
        var quantitySetId = draft.PropertySetById.Keys.Except(beforeIds).OrderBy(id => id).Select(id => (int?)id).FirstOrDefault();
        if (quantitySetId is null)
        {
            StatusText.Text = "No base quantity set created for this selection.";
            return;
        }

        StageDraft(draft, selectedId, $"Staged base quantity set #{quantitySetId.Value} for #{selectedId}");
    }

    private void SaveRelationship_Click(object sender, RoutedEventArgs e)
    {
        if (document is null || selectedEntity is null || selectedRelationship.RelationshipId is null || !selectedRelationship.CanEdit)
        {
            return;
        }

        var selectedId = selectedEntity.Id;
        StageDraft(
            IfcDocumentEditor.UpdateRelationshipEndpoints(document, selectedRelationship.RelationshipId.Value, RelationshipSourceBox.Text, RelationshipTargetBox.Text),
            selectedId,
            $"Staged relationship endpoint edit for #{selectedRelationship.RelationshipId.Value}");
    }

    private void CreateRelationship_Click(object sender, RoutedEventArgs e)
    {
        if (document is null || selectedEntity is null)
        {
            return;
        }

        var selectedId = selectedEntity.Id;
        var beforeIds = document.RelationshipById.Keys.ToHashSet();
        var draft = IfcDocumentEditor.AddRelationship(document, RelationshipTypeBox.Text, RelationshipSourceBox.Text, RelationshipTargetBox.Text, RelationshipNameBox.Text);
        var relationshipId = draft.RelationshipById.Keys.Except(beforeIds).OrderBy(id => id).Select(id => (int?)id).FirstOrDefault();
        if (relationshipId is null)
        {
            StatusText.Text = "No relationship created. Check type/source/target ids.";
            return;
        }

        StageDraft(draft, selectedId, $"Staged relationship create for #{relationshipId.Value}");
    }

    private void DeleteRelationship_Click(object sender, RoutedEventArgs e)
    {
        if (document is null || selectedEntity is null || selectedRelationship.RelationshipId is null)
        {
            return;
        }

        var relationshipId = selectedRelationship.RelationshipId.Value;
        StageDraft(
            IfcDocumentEditor.RemoveRelationship(document, relationshipId),
            selectedEntity.Id,
            $"Staged relationship delete for #{relationshipId}");
    }

    private void ConnectElement_Click(object sender, RoutedEventArgs e)
    {
        if (document is null || selectedEntity is null)
        {
            return;
        }

        var selectedId = selectedEntity.Id;
        var beforeIds = document.RelationshipById.Keys.ToHashSet();
        var draft = IfcDocumentEditor.AddElementConnection(document, selectedId, RelationshipTargetBox.Text, RelationshipNameBox.Text);
        var relationshipId = draft.RelationshipById.Keys.Except(beforeIds).OrderBy(id => id).Select(id => (int?)id).FirstOrDefault();
        if (relationshipId is null)
        {
            StatusText.Text = "No element connection created. Enter a valid target product id.";
            return;
        }

        StageDraft(draft, selectedId, $"Staged element connection #{relationshipId.Value}");
    }

    private void DisconnectElement_Click(object sender, RoutedEventArgs e)
    {
        if (document is null || selectedEntity is null)
        {
            return;
        }

        var selectedId = selectedEntity.Id;
        var draft = IfcDocumentEditor.RemoveElementConnections(document, selectedId, RelationshipTargetBox.Text);
        if (draft.ToStepText() == document.ToStepText())
        {
            StatusText.Text = "No element connections removed. Select a connected product or leave target blank to remove all selected connections.";
            return;
        }

        StageDraft(draft, selectedId, $"Staged element disconnect for #{selectedId}");
    }

    private void AssignRectangleBody_Click(object sender, RoutedEventArgs e)
    {
        AssignBodyPreset("rectangle");
    }

    private void AssignCylinderBody_Click(object sender, RoutedEventArgs e)
    {
        AssignBodyPreset("cylinder");
    }

    private void CreateOpeningVoid_Click(object sender, RoutedEventArgs e)
    {
        if (document is null || selectedEntity is null || !CanCreateOpeningVoid(selectedEntity))
        {
            return;
        }

        var beforeIds = document.EntityById.Keys.ToHashSet();
        var hostId = selectedEntity.Id;
        var draft = IfcDocumentEditor.AddOpeningVoidWithBodyRepresentation(
            document,
            hostId,
            $"Opening in {selectedEntity.DisplayName}",
            BodyWidthBox.Text,
            BodyDepthBox.Text,
            BodyHeightBox.Text,
            "rectangle");
        var openingId = draft.Entities
            .Where(entity => !beforeIds.Contains(entity.Id) && entity.Type == "IFCOPENINGELEMENT")
            .OrderBy(entity => entity.Id)
            .Select(entity => (int?)entity.Id)
            .FirstOrDefault() ?? hostId;

        StageDraft(draft, openingId, $"Staged opening void for #{hostId}");
    }

    private void CreateFillingElement_Click(object sender, RoutedEventArgs e)
    {
        if (document is null || selectedEntity is null || !CanCreateFillingElement(selectedEntity))
        {
            return;
        }

        var beforeIds = document.EntityById.Keys.ToHashSet();
        var openingId = selectedEntity.Id;
        var draft = IfcDocumentEditor.AddFillingElementWithBodyRepresentation(
            document,
            openingId,
            string.IsNullOrWhiteSpace(NewProductTypeBox.Text) ? "IFCBUILDINGELEMENTPROXY" : NewProductTypeBox.Text,
            string.IsNullOrWhiteSpace(NewProductNameBox.Text) ? $"Filling for {selectedEntity.DisplayName}" : NewProductNameBox.Text,
            BodyWidthBox.Text,
            BodyDepthBox.Text,
            BodyHeightBox.Text,
            "rectangle");
        var fillingId = draft.Entities
            .Where(entity => !beforeIds.Contains(entity.Id) && IsCommonPhysicalProductType(entity.Type))
            .OrderBy(entity => entity.Id)
            .Select(entity => (int?)entity.Id)
            .FirstOrDefault() ?? openingId;

        StageDraft(draft, fillingId, $"Staged filling element for opening #{openingId}");
    }

    private void CreateRectangleProduct_Click(object sender, RoutedEventArgs e)
    {
        CreateProductPreset("rectangle");
    }

    private void CreateCylinderProduct_Click(object sender, RoutedEventArgs e)
    {
        CreateProductPreset("cylinder");
    }

    private void CreateProductPreset(string profile)
    {
        if (document is null || selectedEntity is null || !CanCreateProductUnder(selectedEntity))
        {
            return;
        }

        var beforeIds = document.EntityById.Keys.ToHashSet();
        var draft = IfcDocumentEditor.AddProductWithBodyRepresentation(
            document,
            selectedEntity.Id,
            NewProductTypeBox.Text,
            NewProductNameBox.Text,
            BodyWidthBox.Text,
            BodyDepthBox.Text,
            BodyHeightBox.Text,
            profile);
        var newProductId = draft.Entities
            .Where(entity => !beforeIds.Contains(entity.Id) && IsCommonPhysicalProductType(entity.Type))
            .OrderBy(entity => entity.Id)
            .Select(entity => (int?)entity.Id)
            .FirstOrDefault() ?? selectedEntity.Id;

        StageDraft(draft, newProductId, $"Staged new {profile} product under #{selectedEntity.Id}");
    }

    private void AssignBodyPreset(string profile)
    {
        if (document is null || selectedEntity is null || !CanAssignBodyRepresentation(document, selectedEntity))
        {
            return;
        }

        var selectedId = selectedEntity.Id;
        StageDraft(
            IfcDocumentEditor.AssignBodyRepresentation(document, selectedId, BodyWidthBox.Text, BodyDepthBox.Text, BodyHeightBox.Text, profile),
            selectedId,
            $"Staged {profile} body representation for #{selectedId}");
    }

    private static bool CanAssignBodyRepresentation(IfcDocument document, IfcEntity entity)
    {
        if (entity.Arguments.Count <= 6 || entity.Type.StartsWith("IFCREL", StringComparison.OrdinalIgnoreCase) || IsNonBodyProductContainer(entity.Type))
        {
            return false;
        }

        return document.PlacementsByEntity.ContainsKey(entity.Id)
            || document.SpatialPathByEntity.ContainsKey(entity.Id)
            || document.RepresentationsByEntity.ContainsKey(entity.Id)
            || IsCommonPhysicalProductType(entity.Type);
    }

    private static bool CanCreateOpeningVoid(IfcEntity entity)
    {
        return entity.Arguments.Count > 6
            && !entity.Type.StartsWith("IFCREL", StringComparison.OrdinalIgnoreCase)
            && !IsNonBodyProductContainer(entity.Type)
            && entity.Type != "IFCOPENINGELEMENT";
    }

    private static bool CanCreateFillingElement(IfcEntity entity)
    {
        return entity.Type == "IFCOPENINGELEMENT";
    }

    private static bool IsNonBodyProductContainer(string entityType)
    {
        return entityType is "IFCPROJECT" or "IFCPROJECTLIBRARY" or "IFCSITE" or "IFCBUILDING" or "IFCBUILDINGSTOREY" or "IFCSPACE"
            or "IFCFACILITY" or "IFCFACILITYPART" or "IFCROAD" or "IFCRAILWAY" or "IFCBRIDGE";
    }

    private static bool CanCreateProductUnder(IfcEntity entity)
    {
        return entity.Type is "IFCPROJECT" or "IFCPROJECTLIBRARY" or "IFCSITE" or "IFCBUILDING" or "IFCBUILDINGSTOREY" or "IFCSPACE"
            or "IFCFACILITY" or "IFCFACILITYPART" or "IFCROAD" or "IFCRAILWAY" or "IFCBRIDGE";
    }

    private static bool IsCommonPhysicalProductType(string entityType)
    {
        return entityType.Contains("ELEMENT", StringComparison.OrdinalIgnoreCase)
            || entityType is "IFCWALL" or "IFCWALLSTANDARDCASE" or "IFCSLAB" or "IFCBEAM" or "IFCCOLUMN" or "IFCDOOR" or "IFCWINDOW"
                or "IFCMEMBER" or "IFCPLATE" or "IFCFOOTING" or "IFCCOVERING" or "IFCRAILING" or "IFCSTAIR" or "IFCRAMP" or "IFCROOF";
    }

    private static bool CanAttachPropertyTemplates(IfcEntity entity)
    {
        return entity.Arguments.Count > 4
            && !entity.Type.StartsWith("IFCREL", StringComparison.OrdinalIgnoreCase)
            && entity.Type is not "IFCPROPERTYSET" and not "IFCELEMENTQUANTITY";
    }

    private void ApplyDraft_Click(object sender, RoutedEventArgs e)
    {
        var selectedId = selectedEntity?.Id;
        var changesetName = ChangesetNameBox.Text;
        var appliedDocument = draftSession.Apply(changesetName);
        if (appliedDocument is null)
        {
            return;
        }

        LoadDocument(appliedDocument, selectedId, preserveDraft: true);
        ChangesetNameBox.Text = string.Empty;
        StatusText.Text = string.IsNullOrWhiteSpace(changesetName) ? "Draft applied." : $"Draft applied as '{changesetName.Trim()}'.";
    }

    private void DiscardDraft_Click(object sender, RoutedEventArgs e)
    {
        var selectedId = selectedEntity?.Id;
        var restoredDocument = draftSession.Discard();
        if (restoredDocument is null)
        {
            return;
        }

        LoadDocument(restoredDocument, selectedId, preserveDraft: true);
        StatusText.Text = "Draft discarded.";
    }

    private void UndoDraft_Click(object sender, RoutedEventArgs e)
    {
        var selectedId = selectedEntity?.Id;
        var restoredDocument = draftSession.Undo();
        if (restoredDocument is null)
        {
            return;
        }

        LoadDocument(restoredDocument, selectedId, preserveDraft: true);
        StatusText.Text = "Draft history undone.";
    }

    private void RedoDraft_Click(object sender, RoutedEventArgs e)
    {
        var selectedId = selectedEntity?.Id;
        var restoredDocument = draftSession.Redo();
        if (restoredDocument is null)
        {
            return;
        }

        LoadDocument(restoredDocument, selectedId, preserveDraft: true);
        StatusText.Text = "Draft history redone.";
    }

    private void StructureTree_SelectedItemChanged(object sender, RoutedPropertyChangedEventArgs<object> e)
    {
        if (e.NewValue is IfcTreeNode node)
        {
            SelectEntity(node.Entity);
        }
    }

    private void EntitySearch_TextChanged(object sender, TextChangedEventArgs e)
    {
        if (updatingUi || document is null)
        {
            return;
        }

        StructureTree.ItemsSource = IfcNavigationProjector.Search(document, EntitySearchBox.Text);
    }

    private void BookmarkList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (updatingUi || BookmarkList.SelectedItem is not IfcTreeNode node)
        {
            return;
        }

        SelectEntity(node.Entity);
    }

    private async void RecentFileList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (updatingUi || RecentFileList.SelectedItem is not RecentIfcFile recentFile)
        {
            return;
        }

        if (!File.Exists(recentFile.Path))
        {
            RefreshRecentFiles(recentFileStore.RemoveMissing());
            StatusText.Text = $"Recent file no longer exists: {recentFile.FileName}";
            return;
        }

        await OpenIfcFileAsync(recentFile.Path);
    }

    private void ClearMissingRecent_Click(object sender, RoutedEventArgs e)
    {
        RefreshRecentFiles(recentFileStore.RemoveMissing());
        StatusText.Text = "Removed missing recent files.";
    }

    private void ToggleBookmark_Click(object sender, RoutedEventArgs e)
    {
        if (selectedEntity is null)
        {
            return;
        }

        if (!bookmarkedEntityIds.Add(selectedEntity.Id))
        {
            bookmarkedEntityIds.Remove(selectedEntity.Id);
        }

        RefreshBookmarks();
        SelectEntity(selectedEntity);
    }

    private void TypeList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (TypeList.SelectedItem is not IfcTypeCount typeCount)
        {
            return;
        }

        ViewportInfo.Text = IfcNavigationProjector.GetTypeViewportSummary(typeCount);
    }

    private void PropertyList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (updatingUi || PropertyList.SelectedItem is not IfcPropertyDetails property)
        {
            return;
        }

        SetPropertyEditor(property);
    }

    private void RelationshipList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (updatingUi || RelationshipList.SelectedItem is not IfcRelationshipDetails relationship)
        {
            return;
        }

        SetRelationshipEditor(relationship);
    }

    private void RelationshipGraphList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (updatingUi || document is null || RelationshipGraphList.SelectedItem is not IfcRelationshipGraphItem graphItem || graphItem.EntityId is null)
        {
            return;
        }

        if (document.EntityById.TryGetValue(graphItem.EntityId.Value, out var entity))
        {
            SelectEntity(entity);
        }
    }

    private void FitViewport_Click(object sender, RoutedEventArgs e)
    {
        ViewportInfo.Text = selectedEntity is null
            ? "Viewport reset to native overview."
            : $"Fit selection #{selectedEntity.Id} ({selectedEntity.TypeName()}).";
    }

    private void ResetViewport_Click(object sender, RoutedEventArgs e)
    {
        if (document is not null)
        {
            ViewportTitle.Text = "Native Viewport";
            ViewportGeometryList.ItemsSource = geometryBackend.ProjectDocument(document);
        }

        ViewportInfo.Text = "Native geometry preview reset.";
    }

    private void StageDraft(IfcDocument draftDocument, int selectedId, string message)
    {
        if (document is null)
        {
            return;
        }

        draftSession.Stage(document, draftDocument);
        LoadDocument(draftDocument, selectedId, preserveDraft: true);
        StatusText.Text = message;
    }

    private void LoadDocument(IfcDocument nextDocument, int? selectId = null, bool preserveDraft = false)
    {
        updatingUi = true;
        document = nextDocument;
        if (!preserveDraft)
        {
            draftSession.Reset(nextDocument);
        }

        selectedEntity = null;

        SchemaText.Text = document.Schema;
        EntityCountText.Text = $"{document.Entities.Count:N0} entities";
        StatusText.Text = document.FileName;
        DiagnosticsList.ItemsSource = IfcDiagnosticsProjector.Project(document.Diagnostics.Messages);
        TypeList.ItemsSource = IfcNavigationProjector.GetTypeCounts(document);

        bookmarkedEntityIds.RemoveWhere(id => !document.EntityById.ContainsKey(id));
        RefreshBookmarks();

        EntitySearchBox.Text = string.Empty;
        StructureTree.ItemsSource = document.SpatialRoots;
        ViewportTitle.Text = "Native Viewport";
        ViewportInfo.Text = IfcNavigationProjector.GetDocumentViewportSummary(document);
        ViewportGeometryList.ItemsSource = geometryBackend.ProjectDocument(document);
        RefreshDraftUi();

        updatingUi = false;

        if (selectId is not null && document.EntityById.TryGetValue(selectId.Value, out var selected))
        {
            SelectEntity(selected);
        }
        else
        {
            var first = document.SpatialRoots.FirstOrDefault()?.Entity ?? document.Entities.FirstOrDefault();
            if (first is not null)
            {
                SelectEntity(first);
            }
            else
            {
                ClearInspector();
            }
        }
    }

    private void RefreshBookmarks()
    {
        if (document is null)
        {
            BookmarkList.ItemsSource = Array.Empty<IfcTreeNode>();
            return;
        }

        BookmarkList.ItemsSource = IfcNavigationProjector.GetBookmarks(document, bookmarkedEntityIds);
    }

    private void RefreshRecentFiles(IReadOnlyList<RecentIfcFile>? recentFiles = null)
    {
        updatingUi = true;
        RecentFileList.ItemsSource = recentFiles ?? recentFileStore.Load();
        RecentFileList.SelectedItem = null;
        updatingUi = false;
    }

    private void RefreshDraftUi()
    {
        ApplyDraftButton.IsEnabled = draftSession.HasDraft;
        DiscardDraftButton.IsEnabled = draftSession.HasDraft;
        UndoDraftButton.IsEnabled = draftSession.CanUndo;
        RedoDraftButton.IsEnabled = draftSession.CanRedo;
        UndoDraftButton.Content = draftSession.NextUndoName is null ? "Undo" : $"Undo: {draftSession.NextUndoName}";
        RedoDraftButton.Content = draftSession.NextRedoName is null ? "Redo" : $"Redo: {draftSession.NextRedoName}";
        ExportButton.IsEnabled = draftSession.CanExport;

        var draftLines = draftSession.Summarize().Concat(draftSession.GetHistoryLines()).ToList();
        DraftList.ItemsSource = draftLines;
    }

    private void SelectEntity(IfcEntity entity)
    {
        if (document is null)
        {
            return;
        }

        var details = IfcSelectionProjector.Project(document, entity);
        selectedEntity = entity;
        InspectorTitle.Text = entity.DisplayName;
        EntityIdText.Text = $"#{entity.Id}";
        EntityTypeText.Text = entity.Type;
        EntityGlobalIdText.Text = string.IsNullOrWhiteSpace(entity.GlobalId) ? "-" : entity.GlobalId;
        EntityPathText.Text = details.SpatialPath;
        EntityNameBox.Text = entity.Name;
        EntityDescriptionBox.Text = entity.Description;
        RawArgsBox.Text = string.Join(",", entity.Arguments);
        ViewportTitle.Text = entity.DisplayName;
        ViewportInfo.Text = $"Selected #{entity.Id}. {geometryBackend.Status}";
        ViewportGeometryList.ItemsSource = geometryBackend.ProjectSelection(document, entity.Id);
        ToggleBookmarkButton.Content = bookmarkedEntityIds.Contains(entity.Id) ? "Unpin selection" : "Pin selection";

        IncomingList.ItemsSource = details.IncomingReferences;
        RelationshipList.ItemsSource = details.Relationships;
        RelationshipGraphList.ItemsSource = details.RelationshipGraph;
        SetRelationshipEditor(IfcRelationshipDetails.Empty);
        SetSpatialEditor(details.Spatial);
        SetCreateProductEditor(entity);
        SetPlacementEditor(details.Placement);
        RepresentationList.ItemsSource = details.Representations;
        var canAssignBody = CanAssignBodyRepresentation(document, entity);
        AssignRectangleBodyButton.IsEnabled = canAssignBody;
        AssignCylinderBodyButton.IsEnabled = canAssignBody;
        CreateOpeningVoidButton.IsEnabled = CanCreateOpeningVoid(entity);
        CreateFillingElementButton.IsEnabled = CanCreateFillingElement(entity);
        PropertyList.ItemsSource = details.PropertySets;
        SetPropertyEditor(IfcPropertyDetails.Empty);
        AddCommonPsetButton.IsEnabled = CanAttachPropertyTemplates(entity);
        AddBaseQtoButton.IsEnabled = CanAttachPropertyTemplates(entity);
        TypeAssignmentList.ItemsSource = details.TypeAssignments;
        ResourceList.ItemsSource = details.Resources;
        UnitList.ItemsSource = details.Units;
    }

    private void SetSpatialEditor(IfcSpatialDetails spatial)
    {
        selectedSpatial = spatial;
        SpatialEditList.ItemsSource = new[] { spatial.Label };
        SpatialParentBox.Text = spatial.ParentId;
        SaveSpatialParentButton.IsEnabled = spatial.CanEdit;
        DetachSpatialParentButton.IsEnabled = spatial.CanEdit;
    }

    private void SetCreateProductEditor(IfcEntity entity)
    {
        var canCreate = CanCreateProductUnder(entity);
        CreateRectangleProductButton.IsEnabled = canCreate;
        CreateCylinderProductButton.IsEnabled = canCreate;
    }

    private void SetPlacementEditor(IfcPlacementDetails placement)
    {
        PlacementList.ItemsSource = new[] { placement.Label };
        PlacementXBox.Text = placement.X;
        PlacementYBox.Text = placement.Y;
        PlacementZBox.Text = placement.Z;
        SavePlacementButton.IsEnabled = placement.CanEdit;
    }

    private void SetRelationshipEditor(IfcRelationshipDetails relationship)
    {
        selectedRelationship = relationship;
        RelationshipTypeBox.Text = relationship.RelationshipId is not null && document is not null && document.RelationshipById.TryGetValue(relationship.RelationshipId.Value, out var indexedRelationship)
            ? indexedRelationship.Type
            : "IFCRELDEFINESBYPROPERTIES";
        RelationshipNameBox.Text = relationship.RelationshipId is not null && document is not null && document.EntityById.TryGetValue(relationship.RelationshipId.Value, out var relationshipEntity)
            ? relationshipEntity.Name
            : "Native relationship";
        RelationshipSourceBox.Text = relationship.SourceIds;
        RelationshipTargetBox.Text = relationship.TargetIds;
        CreateRelationshipButton.IsEnabled = document is not null && selectedEntity is not null;
        SaveRelationshipButton.IsEnabled = relationship.CanEdit;
        DeleteRelationshipButton.IsEnabled = relationship.RelationshipId is not null;
        ConnectElementButton.IsEnabled = document is not null && selectedEntity is not null;
        DisconnectElementButton.IsEnabled = document is not null && selectedEntity is not null;
    }

    private void SetPropertyEditor(IfcPropertyDetails property)
    {
        selectedProperty = property;
        PropertyValueBox.Text = property.Value;
        SavePropertyButton.IsEnabled = property.CanEdit;
    }

    private void ClearInspector()
    {
        InspectorTitle.Text = "Inspector";
        EntityIdText.Text = "-";
        EntityTypeText.Text = "-";
        EntityGlobalIdText.Text = "-";
        EntityPathText.Text = "-";
        EntityNameBox.Text = string.Empty;
        EntityDescriptionBox.Text = string.Empty;
        RawArgsBox.Text = string.Empty;
        ToggleBookmarkButton.Content = "Pin selection";
        IncomingList.ItemsSource = Array.Empty<string>();
        RelationshipList.ItemsSource = Array.Empty<IfcRelationshipDetails>();
        RelationshipGraphList.ItemsSource = Array.Empty<IfcRelationshipGraphItem>();
        ViewportGeometryList.ItemsSource = Array.Empty<IfcViewportItem>();
        SetRelationshipEditor(IfcRelationshipDetails.Empty);
        CreateRelationshipButton.IsEnabled = false;
        SetSpatialEditor(IfcSpatialDetails.None);
        CreateRectangleProductButton.IsEnabled = false;
        CreateCylinderProductButton.IsEnabled = false;
        DetachSpatialParentButton.IsEnabled = false;
        DeleteRelationshipButton.IsEnabled = false;
        ConnectElementButton.IsEnabled = false;
        DisconnectElementButton.IsEnabled = false;
        PlacementList.ItemsSource = Array.Empty<string>();
        RepresentationList.ItemsSource = Array.Empty<string>();
        AssignRectangleBodyButton.IsEnabled = false;
        AssignCylinderBodyButton.IsEnabled = false;
        CreateOpeningVoidButton.IsEnabled = false;
        CreateFillingElementButton.IsEnabled = false;
        PlacementXBox.Text = string.Empty;
        PlacementYBox.Text = string.Empty;
        PlacementZBox.Text = string.Empty;
        SavePlacementButton.IsEnabled = false;
        PropertyList.ItemsSource = Array.Empty<IfcPropertyDetails>();
        SetPropertyEditor(IfcPropertyDetails.Empty);
        AddCommonPsetButton.IsEnabled = false;
        AddBaseQtoButton.IsEnabled = false;
        TypeAssignmentList.ItemsSource = Array.Empty<string>();
        ResourceList.ItemsSource = Array.Empty<string>();
        UnitList.ItemsSource = Array.Empty<string>();
    }
}
