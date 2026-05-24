using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Media3D;
using System.Windows.Shapes;
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
        "Done: simple material assignment draft workflow",
        "Done: geometry backend abstraction and STEP-reference viewport preview",
        "Done: cancellable async IFC/ifcZIP file loading",
        "Done: duplicate GlobalId and containment diagnostics",
        "Done: grouped diagnostics with repair suggestions",
        "Done: spatial containment tree",
        "Done: spatial reparent draft editor",
        "Done: native relationship create/edit/delete workflows",
        "Done: relationship neighborhood graph panel with relationship hubs/edge labels",
        "Done: pinned entity bookmarks",
        "Done: persisted recent files",
        "Done: persisted native window layout",
        "Done: entity inspector",
        "Done: basic entity editing/export",
        "Done: centralized STEP writer helpers",
        "Next: native mesh/tessellation backend",
        "Next: richer psets/quantities normalization",
        "Unsupported: IDS/MVD validation",
        "Unsupported: ifcXML",
    ];

    private IfcDocument? document;
    private IfcEntity? selectedEntity;
    private IfcRelationshipDetails selectedRelationship = IfcRelationshipDetails.Empty;
    private IfcSpatialDetails selectedSpatial = IfcSpatialDetails.None;
    private IfcPropertyDetails selectedProperty = IfcPropertyDetails.Empty;
    private CancellationTokenSource? openCancellation;
    private readonly RecentFileStore recentFileStore = new();
    private readonly NativeWindowLayoutStore layoutStore = new();
    private readonly IfcDraftSession draftSession = new();
    private readonly IIfcGeometryBackend geometryBackend = new StepReferenceGeometryBackend();
    private readonly HashSet<int> bookmarkedEntityIds = [];
    private readonly ScaleTransform graphScale = new(1, 1);
    private readonly TranslateTransform graphTranslate = new(0, 0);
    private IReadOnlyList<IfcRelationshipGraphItem> currentGraphItems = Array.Empty<IfcRelationshipGraphItem>();
    private Point? graphDragStart;
    private string? activeDocumentPath;
    private bool updatingUi;

    public MainWindow()
    {
        InitializeComponent();
        RelationshipGraphCanvas.RenderTransform = new TransformGroup { Children = { graphScale, graphTranslate } };
        CapabilityList.ItemsSource = capabilities;
        RestoreSavedLayout();
        Closing += (_, _) => layoutStore.Save(CaptureCurrentLayout());
        RefreshRecentFiles();
        LoadDocument(IfcStepParser.CreateSample());
        Loaded += RestoreLastDocumentOnStartup;
    }

    private void Exit_Click(object sender, RoutedEventArgs e)
    {
        Close();
    }

    private void PaneVisibility_Click(object sender, RoutedEventArgs e)
    {
        ApplyPaneLayout();
        layoutStore.Save(CaptureCurrentLayout());
    }

    private void ResetLayout_Click(object sender, RoutedEventArgs e)
    {
        ShowModelPaneMenuItem.IsChecked = true;
        ShowViewportPaneMenuItem.IsChecked = true;
        ShowInspectorPaneMenuItem.IsChecked = true;
        ModelColumn.Width = new GridLength(330);
        ViewportColumn.Width = new GridLength(1, GridUnitType.Star);
        InspectorColumn.Width = new GridLength(380);
        ApplyPaneLayout();
        layoutStore.Save(CaptureCurrentLayout());
        StatusText.Text = "Window layout reset.";
    }

    private void ApplyPaneLayout()
    {
        SetPane(ModelPane, ModelSplitter, ModelColumn, ModelSplitterColumn, ShowModelPaneMenuItem.IsChecked, 330, minWidth: 260);
        SetPane(ViewportPane, null, ViewportColumn, null, ShowViewportPaneMenuItem.IsChecked, 1, minWidth: 420, star: true);
        SetPane(InspectorPane, InspectorSplitter, InspectorColumn, InspectorSplitterColumn, ShowInspectorPaneMenuItem.IsChecked, 380, minWidth: 320);

        if (!ShowModelPaneMenuItem.IsChecked && !ShowViewportPaneMenuItem.IsChecked && !ShowInspectorPaneMenuItem.IsChecked)
        {
            ShowViewportPaneMenuItem.IsChecked = true;
            SetPane(ViewportPane, null, ViewportColumn, null, true, 1, minWidth: 420, star: true);
        }
    }

    private void RestoreSavedLayout()
    {
        var layout = layoutStore.Load();
        Width = layout.WindowWidth;
        Height = layout.WindowHeight;
        ShowModelPaneMenuItem.IsChecked = layout.ShowModelPane;
        ShowViewportPaneMenuItem.IsChecked = layout.ShowViewportPane;
        ShowInspectorPaneMenuItem.IsChecked = layout.ShowInspectorPane;
        ModelColumn.Width = new GridLength(layout.ModelPaneWidth);
        InspectorColumn.Width = new GridLength(layout.InspectorPaneWidth);
        ViewportColumn.Width = new GridLength(1, GridUnitType.Star);
        ApplyPaneLayout();
    }

    private NativeWindowLayout CaptureCurrentLayout()
    {
        return new NativeWindowLayout(
            ShowModelPaneMenuItem.IsChecked,
            ShowViewportPaneMenuItem.IsChecked,
            ShowInspectorPaneMenuItem.IsChecked,
            GetPixelWidth(ModelColumn, 330),
            GetPixelWidth(InspectorColumn, 380),
            ActualWidth > 0 ? ActualWidth : Width,
            ActualHeight > 0 ? ActualHeight : Height,
            activeDocumentPath);
    }

    private static double GetPixelWidth(ColumnDefinition column, double fallback)
    {
        if (column.ActualWidth > 0)
        {
            return column.ActualWidth;
        }

        return column.Width.IsAbsolute && column.Width.Value > 0 ? column.Width.Value : fallback;
    }

    private static void SetPane(UIElement pane, UIElement? splitter, ColumnDefinition column, ColumnDefinition? splitterColumn, bool visible, double width, double minWidth, bool star = false)
    {
        pane.Visibility = visible ? Visibility.Visible : Visibility.Collapsed;
        if (splitter is not null)
        {
            splitter.Visibility = visible ? Visibility.Visible : Visibility.Collapsed;
        }

        column.MinWidth = visible ? minWidth : 0;
        if (visible)
        {
            var needsDefaultWidth = column.Width.Value <= 0 || (column.Width.IsAbsolute && column.Width.Value < minWidth);
            if (needsDefaultWidth)
            {
                column.Width = new GridLength(width, star ? GridUnitType.Star : GridUnitType.Pixel);
            }
        }
        else
        {
            column.Width = new GridLength(0);
        }

        if (splitterColumn is not null)
        {
            splitterColumn.Width = visible ? new GridLength(6) : new GridLength(0);
        }
    }

    private async void RestoreLastDocumentOnStartup(object sender, RoutedEventArgs e)
    {
        Loaded -= RestoreLastDocumentOnStartup;
        var lastOpenedPath = layoutStore.Load().LastOpenedIfcPath;
        if (string.IsNullOrWhiteSpace(lastOpenedPath))
        {
            return;
        }

        if (!File.Exists(lastOpenedPath))
        {
            StatusText.Text = $"Last opened IFC is missing: {Path.GetFileName(lastOpenedPath)}. Loaded sample instead.";
            return;
        }

        StatusText.Text = $"Restoring last IFC workspace: {Path.GetFileName(lastOpenedPath)}…";
        await OpenIfcFileAsync(lastOpenedPath);
    }

    private async void OpenIfc_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFileDialog
        {
            Filter = "IFC files (*.ifc)|*.ifc|ifcZIP archives (*.ifczip;*.zip)|*.ifczip;*.zip|STEP files (*.stp;*.step)|*.stp;*.step|All files (*.*)|*.*",
            Title = "Open IFC or ifcZIP file",
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
            var loaded = await IfcFileLoader.ReadAsync(path, progress, openCancellation.Token);
            StatusText.Text = $"Parsing {loaded.FileName}…";
            var parsed = await Task.Run(() => IfcStepParser.Parse(loaded.Text, loaded.FileName), openCancellation.Token);
            activeDocumentPath = Path.GetFullPath(path);
            LoadDocument(parsed);
            recentFileStore.Add(path);
            RefreshRecentFiles();
            layoutStore.Save(CaptureCurrentLayout());
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
        activeDocumentPath = null;
        LoadDocument(IfcStepParser.CreateSample());
        layoutStore.Save(CaptureCurrentLayout());
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
            Filter = "IFC files (*.ifc)|*.ifc|ifcZIP archives (*.ifczip)|*.ifczip|All files (*.*)|*.*",
            FileName = document.FileName,
            Title = "Export IFC or ifcZIP file",
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

        IfcFileLoader.WriteText(dialog.FileName, document.ToStepText(), document.FileName);
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

    private void AddMaterial_Click(object sender, RoutedEventArgs e)
    {
        StageResourceAssignment("material", document => IfcDocumentEditor.AddSimpleMaterialAssignment(document, selectedEntity!.Id, MaterialNameBox.Text));
    }

    private void AddClassification_Click(object sender, RoutedEventArgs e)
    {
        StageResourceAssignment("classification", document => IfcDocumentEditor.AddSimpleClassificationAssignment(document, selectedEntity!.Id, MaterialNameBox.Text, ResourceIdentificationBox.Text));
    }

    private void AddDocument_Click(object sender, RoutedEventArgs e)
    {
        StageResourceAssignment("document", document => IfcDocumentEditor.AddSimpleDocumentAssignment(document, selectedEntity!.Id, MaterialNameBox.Text, ResourceIdentificationBox.Text));
    }

    private void AddLibrary_Click(object sender, RoutedEventArgs e)
    {
        StageResourceAssignment("library reference", document => IfcDocumentEditor.AddSimpleLibraryAssignment(document, selectedEntity!.Id, MaterialNameBox.Text, ResourceIdentificationBox.Text));
    }

    private void StageResourceAssignment(string resourceLabel, Func<IfcDocument, IfcDocument> createDraft)
    {
        if (document is null || selectedEntity is null || !CanAssignResource(selectedEntity))
        {
            return;
        }

        var beforeResourceIds = document.ResourcesByEntity.TryGetValue(selectedEntity.Id, out var resources)
            ? resources.Count
            : 0;
        var selectedId = selectedEntity.Id;
        var draft = createDraft(document);
        var afterResourceIds = draft.ResourcesByEntity.TryGetValue(selectedId, out var draftResources)
            ? draftResources.Count
            : 0;

        if (afterResourceIds <= beforeResourceIds)
        {
            StatusText.Text = $"No {resourceLabel} assignment created for this selection.";
            return;
        }

        StageDraft(draft, selectedId, $"Staged {resourceLabel} assignment for #{selectedId}");
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

    private void SelectGraphEntity(IfcRelationshipGraphItem graphItem)
    {
        if (updatingUi || document is null || graphItem.EntityId is null)
        {
            return;
        }

        if (document.EntityById.TryGetValue(graphItem.EntityId.Value, out var entity))
        {
            SelectEntity(entity);
        }
    }

    private void SelectGraphRelationship(IfcRelationshipGraphItem graphItem)
    {
        if (updatingUi || document is null || graphItem.RelationshipId is null)
        {
            return;
        }

        var relationship = RelationshipList.Items
            .OfType<IfcRelationshipDetails>()
            .FirstOrDefault(item => item.RelationshipId == graphItem.RelationshipId.Value);
        if (relationship is not null)
        {
            RelationshipList.SelectedItem = relationship;
            SetRelationshipEditor(relationship);
            StatusText.Text = $"Selected relationship #{graphItem.RelationshipId.Value} from graph.";
            return;
        }

        if (document.EntityById.TryGetValue(graphItem.RelationshipId.Value, out var relationshipEntity))
        {
            SelectEntity(relationshipEntity);
            StatusText.Text = $"Opened relationship entity #{relationshipEntity.Id} from graph.";
        }
    }

    private void FitGraph_Click(object sender, RoutedEventArgs e)
    {
        FitGraph();
    }

    private void ResetGraph_Click(object sender, RoutedEventArgs e)
    {
        graphScale.ScaleX = 1;
        graphScale.ScaleY = 1;
        graphTranslate.X = 0;
        graphTranslate.Y = 0;
    }

    private void GraphFilter_TextChanged(object sender, TextChangedEventArgs e)
    {
        if (updatingUi)
        {
            return;
        }

        RefreshRelationshipGraph();
    }

    private void GraphDepth_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (updatingUi)
        {
            return;
        }

        RefreshRelationshipGraph();
    }

    private void RelationshipGraphCanvas_MouseWheel(object sender, MouseWheelEventArgs e)
    {
        var factor = e.Delta > 0 ? 1.12 : 0.88;
        graphScale.ScaleX = Math.Clamp(graphScale.ScaleX * factor, 0.35, 2.8);
        graphScale.ScaleY = graphScale.ScaleX;
    }

    private void RelationshipGraphCanvas_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        graphDragStart = e.GetPosition(this);
        RelationshipGraphCanvas.CaptureMouse();
    }

    private void RelationshipGraphCanvas_MouseMove(object sender, MouseEventArgs e)
    {
        if (graphDragStart is null || e.LeftButton != MouseButtonState.Pressed)
        {
            return;
        }

        var current = e.GetPosition(this);
        graphTranslate.X += current.X - graphDragStart.Value.X;
        graphTranslate.Y += current.Y - graphDragStart.Value.Y;
        graphDragStart = current;
    }

    private void RelationshipGraphCanvas_MouseLeftButtonUp(object sender, MouseButtonEventArgs e)
    {
        graphDragStart = null;
        RelationshipGraphCanvas.ReleaseMouseCapture();
    }

    private void DiagnosticFilter_TextChanged(object sender, TextChangedEventArgs e)
    {
        if (updatingUi || document is null)
        {
            return;
        }

        RefreshDiagnostics();
    }

    private void DiagnosticsList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        RepairDiagnosticButton.IsEnabled = document is not null
            && DiagnosticsList.SelectedItem is IfcDiagnosticDetails selectedDiagnostic
            && selectedDiagnostic.CanRepair;
        RepairDiagnosticButton.Content = DiagnosticsList.SelectedItem is IfcDiagnosticDetails repairDiagnostic && repairDiagnostic.CanRepair
            ? repairDiagnostic.RepairLabel
            : "Stage diagnostic repair";

        if (updatingUi || document is null || DiagnosticsList.SelectedItem is not IfcDiagnosticDetails diagnostic || diagnostic.EntityId is null)
        {
            return;
        }

        if (document.EntityById.TryGetValue(diagnostic.EntityId.Value, out var entity))
        {
            SelectEntity(entity);
            StatusText.Text = $"Navigated to diagnostic target #{entity.Id}.";
        }
        else
        {
            StatusText.Text = $"Diagnostic target #{diagnostic.EntityId.Value} is not present in the indexed entities.";
        }
    }

    private void RepairDiagnostic_Click(object sender, RoutedEventArgs e)
    {
        if (document is null || DiagnosticsList.SelectedItem is not IfcDiagnosticDetails diagnostic || !diagnostic.CanRepair)
        {
            return;
        }

        var selectedId = diagnostic.EntityId ?? selectedEntity?.Id ?? document.Entities.FirstOrDefault()?.Id ?? 0;
        var draft = diagnostic.CanRepairSpatialContainment
            ? IfcDocumentEditor.KeepFirstPrimarySpatialContainment(document, diagnostic.Message)
            : diagnostic.CanRepairMissingReference
                ? IfcDocumentEditor.RemoveMissingRelationshipReferences(document, diagnostic.Message)
            : diagnostic.CanRepairMissingGlobalId
                ? IfcDocumentEditor.GenerateMissingGlobalIdFromDiagnostic(document, diagnostic.Message)
            : diagnostic.CanRepairPlacement
                ? IfcDocumentEditor.AssignDefaultPlacementFromDiagnostic(document, diagnostic.Message)
            : diagnostic.CanRepairRepresentation
                ? IfcDocumentEditor.AssignDefaultRepresentationFromDiagnostic(document, diagnostic.Message)
                : IfcDocumentEditor.RegenerateDuplicateGlobalIds(document, diagnostic.Message);
        if (draft.ToStepText() == document.ToStepText())
        {
            StatusText.Text = "No diagnostic repair was staged for this diagnostic.";
            return;
        }

        StageDraft(draft, selectedId, diagnostic.CanRepairSpatialContainment
            ? "Staged spatial containment repair from diagnostic."
            : diagnostic.CanRepairMissingReference
                ? "Staged missing reference repair from diagnostic."
            : diagnostic.CanRepairMissingGlobalId
                ? "Staged missing GlobalId repair from diagnostic."
            : diagnostic.CanRepairPlacement
                ? "Staged default placement repair from diagnostic."
            : diagnostic.CanRepairRepresentation
                ? "Staged default representation repair from diagnostic."
                : "Staged duplicate GlobalId repair from diagnostic.");
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
            var viewportItems = geometryBackend.ProjectDocument(document);
            ViewportGeometryList.ItemsSource = viewportItems;
            RenderNativeViewport(viewportItems);
        }

        ViewportInfo.Text = "Native geometry preview reset.";
    }

    private void RenderNativeViewport(IReadOnlyList<IfcViewportItem> items)
    {
        NativeViewport3D.Children.Clear();
        NativeViewport3D.Camera = new PerspectiveCamera(new Point3D(7, -9, 6), new Vector3D(-7, 9, -6), new Vector3D(0, 0, 1), 45);

        var group = new Model3DGroup();
        group.Children.Add(new AmbientLight(Color.FromRgb(90, 110, 140)));
        group.Children.Add(new DirectionalLight(Colors.White, new Vector3D(-0.8, 1.0, -1.2)));

        var visibleItems = items.Where(item => item.EntityId is not null).Take(24).ToList();
        if (visibleItems.Count == 0)
        {
            visibleItems.Add(new IfcViewportItem(null, "Generated sample preview volume"));
        }

        var columns = Math.Max(1, (int)Math.Ceiling(Math.Sqrt(visibleItems.Count)));
        for (var index = 0; index < visibleItems.Count; index++)
        {
            var row = index / columns;
            var column = index % columns;
            var center = new Point3D((column - (columns - 1) / 2.0) * 1.7, row * 1.7, 0.45);
            var height = 0.7 + (index % 4) * 0.18;
            group.Children.Add(CreateBox(center, 1.15, 1.15, height, index == 0 ? Color.FromRgb(59, 130, 246) : Color.FromRgb(34, 197, 94)));
        }

        NativeViewport3D.Children.Add(new ModelVisual3D { Content = group });
    }

    private static GeometryModel3D CreateBox(Point3D center, double width, double depth, double height, Color color)
    {
        var x = width / 2;
        var y = depth / 2;
        var z = height / 2;
        var points = new Point3DCollection
        {
            new(center.X - x, center.Y - y, center.Z - z), new(center.X + x, center.Y - y, center.Z - z), new(center.X + x, center.Y + y, center.Z - z), new(center.X - x, center.Y + y, center.Z - z),
            new(center.X - x, center.Y - y, center.Z + z), new(center.X + x, center.Y - y, center.Z + z), new(center.X + x, center.Y + y, center.Z + z), new(center.X - x, center.Y + y, center.Z + z),
        };
        var indices = new Int32Collection
        {
            0,2,1, 0,3,2, 4,5,6, 4,6,7, 0,1,5, 0,5,4,
            1,2,6, 1,6,5, 2,3,7, 2,7,6, 3,0,4, 3,4,7,
        };

        return new GeometryModel3D(
            new MeshGeometry3D { Positions = points, TriangleIndices = indices },
            new DiffuseMaterial(new SolidColorBrush(color)))
        {
            BackMaterial = new DiffuseMaterial(new SolidColorBrush(Color.FromRgb(15, 23, 42))),
        };
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
        RefreshDiagnostics();
        TypeList.ItemsSource = IfcNavigationProjector.GetTypeCounts(document);

        bookmarkedEntityIds.RemoveWhere(id => !document.EntityById.ContainsKey(id));
        RefreshBookmarks();

        EntitySearchBox.Text = string.Empty;
        StructureTree.ItemsSource = document.SpatialRoots;
        ViewportTitle.Text = "Native Viewport";
        ViewportInfo.Text = IfcNavigationProjector.GetDocumentViewportSummary(document);
        var documentViewportItems = geometryBackend.ProjectDocument(document);
        ViewportGeometryList.ItemsSource = documentViewportItems;
        RenderNativeViewport(documentViewportItems);
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

    private void RenderRelationshipGraph()
    {
        RelationshipGraphCanvas.Children.Clear();
        if (currentGraphItems.Count == 0)
        {
            RelationshipGraphCanvas.Children.Add(new TextBlock
            {
                Text = "Select an entity to visualize its relationship neighborhood.",
                Foreground = (Brush)FindResource("MutedBrush"),
                Margin = new Thickness(14),
            });
            return;
        }

        var entityNodes = currentGraphItems
            .Where(item => item.EntityId is not null)
            .GroupBy(item => item.EntityId!.Value)
            .Select(group => group.OrderBy(item => item.Depth).First())
            .OrderBy(item => item.Depth)
            .ThenBy(item => item.EntityId)
            .Take(24)
            .ToList();

        var relationshipNodes = currentGraphItems
            .Where(item => item.RelationshipId is not null && item.EntityId is null)
            .GroupBy(item => item.RelationshipId!.Value)
            .Select(group => group.OrderBy(item => item.Depth).First())
            .OrderBy(item => item.Depth)
            .ThenBy(item => item.RelationshipId)
            .Take(18)
            .ToList();

        if (entityNodes.Count == 0 && relationshipNodes.Count == 0)
        {
            RelationshipGraphCanvas.Children.Add(new TextBlock
            {
                Text = currentGraphItems.FirstOrDefault()?.Label ?? "No relationship graph neighbors indexed for this entity.",
                Foreground = (Brush)FindResource("MutedBrush"),
                Margin = new Thickness(14),
            });
            return;
        }

        var center = new Point(210, 170);
        var entityPositions = new Dictionary<int, Point>();
        var relationshipPositions = new Dictionary<int, Point>();

        for (var index = 0; index < relationshipNodes.Count; index++)
        {
            var radius = Math.Max(78, 20 * relationshipNodes.Count / Math.PI);
            var angle = relationshipNodes.Count == 1 ? -Math.PI / 2 : (2 * Math.PI * index / relationshipNodes.Count) - Math.PI / 2;
            relationshipPositions[relationshipNodes[index].RelationshipId!.Value] = new Point(center.X + Math.Cos(angle) * radius, center.Y + Math.Sin(angle) * radius);
        }

        foreach (var depthGroup in entityNodes.GroupBy(item => Math.Min(item.Depth, 2)).OrderBy(group => group.Key))
        {
            var depthNodes = depthGroup.ToList();
            var radius = Math.Max(150, 42 * depthNodes.Count / Math.PI) + Math.Max(0, depthGroup.Key - 1) * 120;
            for (var index = 0; index < depthNodes.Count; index++)
            {
                var angle = depthNodes.Count == 1 ? -Math.PI / 2 : (2 * Math.PI * index / depthNodes.Count) - Math.PI / 2;
                entityPositions[depthNodes[index].EntityId!.Value] = new Point(center.X + Math.Cos(angle) * radius, center.Y + Math.Sin(angle) * radius);
            }
        }

        foreach (var relationshipNode in relationshipNodes)
        {
            var relationshipPosition = relationshipPositions[relationshipNode.RelationshipId!.Value];
            AddGraphEdge(center, relationshipPosition, relationshipNode.Label);

            foreach (var entityNode in entityNodes.Where(node => node.RelationshipId == relationshipNode.RelationshipId))
            {
                if (entityNode.EntityId is not null && entityPositions.TryGetValue(entityNode.EntityId.Value, out var entityPosition))
                {
                    AddGraphEdge(relationshipPosition, entityPosition, relationshipNode.Label);
                }
            }
        }

        AddGraphNode(center, selectedEntity?.Id is null ? "Selection" : $"#{selectedEntity.Id}\n{selectedEntity.TypeName()}", null, true);
        foreach (var relationshipNode in relationshipNodes)
        {
            AddGraphNode(relationshipPositions[relationshipNode.RelationshipId!.Value], relationshipNode.Label, relationshipNode, false);
        }

        foreach (var node in entityNodes)
        {
            AddGraphNode(entityPositions[node.EntityId!.Value], node.Label, node, false);
        }
    }

    private void AddGraphEdge(Point from, Point to, string label)
    {
        RelationshipGraphCanvas.Children.Add(new Line
        {
            X1 = from.X,
            Y1 = from.Y,
            X2 = to.X,
            Y2 = to.Y,
            Stroke = new SolidColorBrush(Color.FromRgb(71, 85, 105)),
            StrokeThickness = 1.4,
            Opacity = 0.7,
        });

        if (!string.IsNullOrWhiteSpace(label))
        {
            var text = new TextBlock
            {
                Text = CompactGraphLabel(label),
                Foreground = (Brush)FindResource("MutedBrush"),
                FontSize = 10,
                Background = new SolidColorBrush(Color.FromArgb(190, 2, 6, 23)),
                Padding = new Thickness(4, 1, 4, 1),
                ToolTip = label,
            };

            RelationshipGraphCanvas.Children.Add(text);
            Canvas.SetLeft(text, (from.X + to.X) / 2 - 36);
            Canvas.SetTop(text, (from.Y + to.Y) / 2 - 10);
        }
    }

    private void AddGraphNode(Point center, string label, IfcRelationshipGraphItem? item, bool selected)
    {
        const double width = 150;
        const double height = 54;
        var border = new Border
        {
            Width = width,
            Height = height,
            CornerRadius = new CornerRadius(14),
            Background = new SolidColorBrush(selected ? Color.FromRgb(29, 78, 216) : item?.EntityId is null ? Color.FromRgb(88, 28, 135) : item?.Depth >= 2 ? Color.FromRgb(49, 46, 129) : Color.FromRgb(15, 23, 42)),
            BorderBrush = new SolidColorBrush(selected ? Color.FromRgb(147, 197, 253) : item?.EntityId is null ? Color.FromRgb(216, 180, 254) : item?.Depth >= 2 ? Color.FromRgb(129, 140, 248) : Color.FromRgb(51, 65, 85)),
            BorderThickness = new Thickness(1),
            Padding = new Thickness(8),
            Child = new TextBlock
            {
                Text = label,
                Foreground = Brushes.White,
                FontSize = 11,
                TextTrimming = TextTrimming.CharacterEllipsis,
                TextWrapping = TextWrapping.Wrap,
            },
            ToolTip = label,
        };

        if (item is not null)
        {
            border.Cursor = Cursors.Hand;
            border.MouseLeftButtonUp += (_, args) =>
            {
                args.Handled = true;
                if (item.EntityId is not null)
                {
                    SelectGraphEntity(item);
                }
                else
                {
                    SelectGraphRelationship(item);
                }
            };
        }

        Canvas.SetLeft(border, center.X - width / 2);
        Canvas.SetTop(border, center.Y - height / 2);
        RelationshipGraphCanvas.Children.Add(border);
    }

    private static string CompactGraphLabel(string label)
    {
        var compact = label.Trim();
        if (compact.StartsWith('→') || compact.StartsWith('←') || compact.StartsWith('↔'))
        {
            compact = compact[1..].Trim();
        }

        var parts = compact.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        return parts.Length >= 2 ? $"{parts[0]} {parts[1]}" : compact;
    }

    private void FitGraph()
    {
        graphScale.ScaleX = 1;
        graphScale.ScaleY = 1;
        graphTranslate.X = 0;
        graphTranslate.Y = 0;
    }

    private void RefreshRelationshipGraph()
    {
        if (document is null || selectedEntity is null)
        {
            currentGraphItems = Array.Empty<IfcRelationshipGraphItem>();
            RenderRelationshipGraph();
            return;
        }

        currentGraphItems = IfcSelectionProjector.ProjectRelationshipGraph(document, selectedEntity, GraphFilterBox.Text, GetGraphDepth());
        RenderRelationshipGraph();
    }

    private int GetGraphDepth()
    {
        return GraphDepthBox.SelectedItem is ComboBoxItem item && int.TryParse(item.Tag?.ToString(), out var depth)
            ? depth
            : 1;
    }

    private void RefreshRecentFiles(IReadOnlyList<RecentIfcFile>? recentFiles = null)
    {
        updatingUi = true;
        RecentFileList.ItemsSource = recentFiles ?? recentFileStore.Load();
        RecentFileList.SelectedItem = null;
        updatingUi = false;
    }

    private void RefreshDiagnostics()
    {
        if (document is null)
        {
            DiagnosticsList.ItemsSource = Array.Empty<IfcDiagnosticDetails>();
            RepairDiagnosticButton.IsEnabled = false;
            return;
        }

        DiagnosticsList.ItemsSource = IfcDiagnosticsProjector.Project(document.Diagnostics.Messages, DiagnosticFilterBox.Text);
        RepairDiagnosticButton.IsEnabled = false;
        RepairDiagnosticButton.Content = "Stage diagnostic repair";
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
        var selectionViewportItems = geometryBackend.ProjectSelection(document, entity.Id);
        ViewportGeometryList.ItemsSource = selectionViewportItems;
        RenderNativeViewport(selectionViewportItems);
        ToggleBookmarkButton.Content = bookmarkedEntityIds.Contains(entity.Id) ? "Unpin selection" : "Pin selection";

        IncomingList.ItemsSource = details.IncomingReferences;
        RelationshipList.ItemsSource = details.Relationships;
        RefreshRelationshipGraph();
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
        var canAssignResource = CanAssignResource(entity);
        AddMaterialButton.IsEnabled = canAssignResource;
        AddClassificationButton.IsEnabled = canAssignResource;
        AddDocumentButton.IsEnabled = canAssignResource;
        AddLibraryButton.IsEnabled = canAssignResource;
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
        currentGraphItems = Array.Empty<IfcRelationshipGraphItem>();
        RenderRelationshipGraph();
        ViewportGeometryList.ItemsSource = Array.Empty<IfcViewportItem>();
        RenderNativeViewport(Array.Empty<IfcViewportItem>());
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
        MaterialNameBox.Text = "Native material";
        ResourceIdentificationBox.Text = "NATIVE-REF";
        AddMaterialButton.IsEnabled = false;
        AddClassificationButton.IsEnabled = false;
        AddDocumentButton.IsEnabled = false;
        AddLibraryButton.IsEnabled = false;
        UnitList.ItemsSource = Array.Empty<string>();
    }

    private static bool CanAssignResource(IfcEntity entity)
    {
        return entity.Arguments.Count > 4
            && !entity.Type.StartsWith("IFCREL", StringComparison.OrdinalIgnoreCase)
            && entity.Type is not "IFCMATERIAL" and not "IFCCLASSIFICATIONREFERENCE" and not "IFCDOCUMENTREFERENCE" and not "IFCLIBRARYREFERENCE";
    }
}
