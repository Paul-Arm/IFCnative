using System.Globalization;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using IFCnative.NativeWindows.Models;
using IFCnative.NativeWindows.Services;
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
        "Done: cancellable async IFC file loading",
        "Done: duplicate GlobalId and containment diagnostics",
        "Done: spatial containment tree",
        "Done: entity inspector",
        "Done: basic entity editing/export",
        "Next: web-ifc WASM geometry bridge",
        "Next: psets/quantities normalization",
        "Next: native writer helpers",
        "Unsupported: IDS/MVD validation",
        "Unsupported: ifcZIP/ifcXML",
    ];

    private IfcDocument? document;
    private IfcDocument? savedDocument;
    private IfcDocument? pendingDocument;
    private IfcEntity? selectedEntity;
    private CancellationTokenSource? openCancellation;
    private bool updatingUi;

    public MainWindow()
    {
        InitializeComponent();
        CapabilityList.ItemsSource = capabilities;
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

        openCancellation?.Cancel();
        openCancellation = new CancellationTokenSource();
        SetOpenInProgress(true);

        try
        {
            var progress = new Progress<string>(message => StatusText.Text = message);
            var text = await IfcFileLoader.ReadTextAsync(dialog.FileName, progress, openCancellation.Token);
            StatusText.Text = $"Parsing {Path.GetFileName(dialog.FileName)}…";
            var parsed = await Task.Run(() => IfcStepParser.Parse(text, Path.GetFileName(dialog.FileName)), openCancellation.Token);
            LoadDocument(parsed);
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

        if (pendingDocument is not null)
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

        File.WriteAllText(dialog.FileName, document.ToStepText());
        StatusText.Text = $"Exported {Path.GetFileName(dialog.FileName)}";
    }

    private void SaveEdit_Click(object sender, RoutedEventArgs e)
    {
        if (document is null || selectedEntity is null)
        {
            return;
        }

        var selectedId = selectedEntity.Id;
        var draft = IfcStepParser.Parse(document.ToStepText(), document.FileName);
        if (!draft.EntityById.TryGetValue(selectedId, out var draftEntity))
        {
            return;
        }

        draftEntity.Name = EntityNameBox.Text.Trim();
        draftEntity.Description = EntityDescriptionBox.Text.Trim();

        var rawArguments = RawArgsBox.Text.Trim();
        if (!string.IsNullOrWhiteSpace(rawArguments))
        {
            draftEntity.Arguments.Clear();
            draftEntity.Arguments.AddRange(StepArgumentReader.SplitTopLevel(rawArguments));
        }

        StageDraft(IfcStepParser.Parse(draft.ToStepText(), draft.FileName), selectedId, $"Staged entity edit for #{selectedId}");
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

    private void ApplyDraft_Click(object sender, RoutedEventArgs e)
    {
        if (pendingDocument is null)
        {
            return;
        }

        savedDocument = pendingDocument;
        pendingDocument = null;
        RefreshDraftUi();
        StatusText.Text = "Draft applied.";
    }

    private void DiscardDraft_Click(object sender, RoutedEventArgs e)
    {
        if (pendingDocument is null || savedDocument is null)
        {
            return;
        }

        var selectedId = selectedEntity?.Id;
        pendingDocument = null;
        LoadDocument(savedDocument, selectedId);
        StatusText.Text = "Draft discarded.";
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

        var search = EntitySearchBox.Text.Trim();
        if (string.IsNullOrWhiteSpace(search))
        {
            StructureTree.ItemsSource = document.SpatialRoots;
            return;
        }

        var matches = document.Entities
            .Where(entity =>
                entity.Id.ToString().Contains(search, StringComparison.OrdinalIgnoreCase)
                || entity.Type.Contains(search, StringComparison.OrdinalIgnoreCase)
                || entity.Name.Contains(search, StringComparison.OrdinalIgnoreCase)
                || entity.GlobalId.Contains(search, StringComparison.OrdinalIgnoreCase))
            .Take(500)
            .Select(entity => new IfcTreeNode(entity, "match"))
            .ToList();

        StructureTree.ItemsSource = matches;
    }

    private void TypeList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (TypeList.SelectedItem is not string selected || document is null)
        {
            return;
        }

        var type = selected.Split(' ', 2)[0];
        var count = document.EntitiesByType.TryGetValue(type, out var entities) ? entities.Count : 0;
        ViewportInfo.Text = $"{type}: {count:N0} indexed entities. Geometry streaming is the next web-ifc bridge task.";
    }

    private void FitViewport_Click(object sender, RoutedEventArgs e)
    {
        ViewportInfo.Text = selectedEntity is null
            ? "Viewport reset to native overview."
            : $"Fit selection #{selectedEntity.Id} ({selectedEntity.TypeName()}).";
    }

    private void ResetViewport_Click(object sender, RoutedEventArgs e)
    {
        ViewportInfo.Text = "Native camera reset.";
    }

    private void StageDraft(IfcDocument draftDocument, int selectedId, string message)
    {
        if (savedDocument is null)
        {
            savedDocument = document;
        }

        pendingDocument = draftDocument;
        LoadDocument(draftDocument, selectedId, preserveSaved: true);
        StatusText.Text = message;
    }

    private void LoadDocument(IfcDocument nextDocument, int? selectId = null, bool preserveSaved = false)
    {
        updatingUi = true;
        document = nextDocument;
        if (!preserveSaved)
        {
            savedDocument = nextDocument;
            pendingDocument = null;
        }

        selectedEntity = null;

        SchemaText.Text = document.Schema;
        EntityCountText.Text = $"{document.Entities.Count:N0} entities";
        StatusText.Text = document.FileName;
        DiagnosticsList.ItemsSource = document.Diagnostics.Messages;
        TypeList.ItemsSource = document.EntitiesByType
            .OrderByDescending(pair => pair.Value.Count)
            .ThenBy(pair => pair.Key)
            .Select(pair => $"{pair.Key} ({pair.Value.Count:N0})")
            .ToList();

        EntitySearchBox.Text = string.Empty;
        StructureTree.ItemsSource = document.SpatialRoots;
        ViewportTitle.Text = "Native Viewport";
        ViewportInfo.Text = $"{document.FileName}: {document.SpatialRoots.Count:N0} root nodes, {document.EntitiesByType.Count:N0} entity types.";
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

    private void RefreshDraftUi()
    {
        var hasDraft = pendingDocument is not null && savedDocument is not null;
        ApplyDraftButton.IsEnabled = hasDraft;
        DiscardDraftButton.IsEnabled = hasDraft;
        ExportButton.IsEnabled = !hasDraft;
        DraftList.ItemsSource = hasDraft && savedDocument is not null && pendingDocument is not null
            ? IfcDiffService.Summarize(savedDocument, pendingDocument)
            : ["No pending draft."];
    }

    private void SelectEntity(IfcEntity entity)
    {
        selectedEntity = entity;
        InspectorTitle.Text = entity.DisplayName;
        EntityIdText.Text = $"#{entity.Id}";
        EntityTypeText.Text = entity.Type;
        EntityGlobalIdText.Text = string.IsNullOrWhiteSpace(entity.GlobalId) ? "-" : entity.GlobalId;
        EntityNameBox.Text = entity.Name;
        EntityDescriptionBox.Text = entity.Description;
        RawArgsBox.Text = string.Join(",", entity.Arguments);
        ViewportTitle.Text = entity.DisplayName;
        ViewportInfo.Text = $"Selected #{entity.Id}. Native graph selection is active.";

        IncomingList.ItemsSource = GetIncomingReferences(entity).ToList();
        RelationshipList.ItemsSource = GetRelationships(entity).ToList();
        SetPlacementEditor(entity);
        RepresentationList.ItemsSource = GetRepresentation(entity).ToList();
        PropertyList.ItemsSource = GetPropertySets(entity).ToList();
        TypeAssignmentList.ItemsSource = GetTypeAssignments(entity).ToList();
        ResourceList.ItemsSource = GetResources(entity).ToList();
        UnitList.ItemsSource = document?.Units.Count > 0 ? document.Units : ["No IFCUNITASSIGNMENT units indexed."];
    }

    private void SetPlacementEditor(IfcEntity entity)
    {
        if (document is null || !document.PlacementsByEntity.TryGetValue(entity.Id, out var placement))
        {
            PlacementList.ItemsSource = new[] { "No IFCLOCALPLACEMENT indexed for this entity." };
            PlacementXBox.Text = string.Empty;
            PlacementYBox.Text = string.Empty;
            PlacementZBox.Text = string.Empty;
            SavePlacementButton.IsEnabled = false;
            return;
        }

        PlacementList.ItemsSource = new[] { placement.Label };
        PlacementXBox.Text = placement.X.ToString("0.########", CultureInfo.InvariantCulture);
        PlacementYBox.Text = placement.Y.ToString("0.########", CultureInfo.InvariantCulture);
        PlacementZBox.Text = placement.Z.ToString("0.########", CultureInfo.InvariantCulture);
        SavePlacementButton.IsEnabled = true;
    }

    private IEnumerable<string> GetPlacement(IfcEntity entity)
    {
        if (document is null || !document.PlacementsByEntity.TryGetValue(entity.Id, out var placement))
        {
            yield return "No IFCLOCALPLACEMENT indexed for this entity.";
            yield break;
        }

        yield return placement.Label;
    }

    private IEnumerable<string> GetRepresentation(IfcEntity entity)
    {
        if (document is null || !document.RepresentationsByEntity.TryGetValue(entity.Id, out var representation))
        {
            yield return "No IFCPRODUCTDEFINITIONSHAPE indexed for this entity.";
            yield break;
        }

        yield return representation.Label;
    }

    private IEnumerable<string> GetPropertySets(IfcEntity entity)
    {
        if (document is null || !document.PropertySetsByEntity.TryGetValue(entity.Id, out var propertySets))
        {
            yield return "No property or quantity sets indexed for this entity.";
            yield break;
        }

        foreach (var propertySet in propertySets.OrderBy(set => set.Kind).ThenBy(set => set.Name).ThenBy(set => set.Id))
        {
            yield return propertySet.Label;
            foreach (var value in propertySet.Values)
            {
                yield return $"  • {value.Label}";
            }
        }
    }

    private IEnumerable<string> GetTypeAssignments(IfcEntity entity)
    {
        if (document is null || !document.TypeAssignmentsByEntity.TryGetValue(entity.Id, out var assignments))
        {
            yield return "No IFC type assignments indexed for this entity.";
            yield break;
        }

        foreach (var assignment in assignments.OrderBy(assignment => assignment.TypeClass).ThenBy(assignment => assignment.TypeName).ThenBy(assignment => assignment.RelationshipId))
        {
            yield return assignment.Label;
        }
    }

    private IEnumerable<string> GetResources(IfcEntity entity)
    {
        if (document is null || !document.ResourcesByEntity.TryGetValue(entity.Id, out var resources))
        {
            yield return "No material/classification/document/library resources indexed for this entity.";
            yield break;
        }

        foreach (var resource in resources.OrderBy(resource => resource, StringComparer.OrdinalIgnoreCase))
        {
            yield return resource;
        }
    }

    private IEnumerable<string> GetRelationships(IfcEntity entity)
    {
        if (document is null || !document.RelationshipsByEntity.TryGetValue(entity.Id, out var relationships))
        {
            yield return "No indexed IFC relationships for this entity.";
            yield break;
        }

        foreach (var relationship in relationships.OrderBy(relationship => relationship.Type).ThenBy(relationship => relationship.Id))
        {
            yield return relationship.Label;
        }
    }

    private IEnumerable<string> GetIncomingReferences(IfcEntity entity)
    {
        if (document is null || !document.IncomingReferences.TryGetValue(entity.Id, out var incoming))
        {
            yield return "No incoming references indexed.";
            yield break;
        }

        foreach (var reference in incoming.OrderBy(reference => reference.Type).ThenBy(reference => reference.Id))
        {
            yield return $"#{reference.Id} {reference.Type}: {StepArgumentReader.CompactPreview(string.Join(",", reference.Arguments))}";
        }
    }

    private void ClearInspector()
    {
        InspectorTitle.Text = "Inspector";
        EntityIdText.Text = "-";
        EntityTypeText.Text = "-";
        EntityGlobalIdText.Text = "-";
        EntityNameBox.Text = string.Empty;
        EntityDescriptionBox.Text = string.Empty;
        RawArgsBox.Text = string.Empty;
        IncomingList.ItemsSource = Array.Empty<string>();
        RelationshipList.ItemsSource = Array.Empty<string>();
        PlacementList.ItemsSource = Array.Empty<string>();
        RepresentationList.ItemsSource = Array.Empty<string>();
        PlacementXBox.Text = string.Empty;
        PlacementYBox.Text = string.Empty;
        PlacementZBox.Text = string.Empty;
        SavePlacementButton.IsEnabled = false;
        PropertyList.ItemsSource = Array.Empty<string>();
        TypeAssignmentList.ItemsSource = Array.Empty<string>();
        ResourceList.ItemsSource = Array.Empty<string>();
        UnitList.ItemsSource = Array.Empty<string>();
    }
}

