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
    private IfcEntity? selectedEntity;
    private bool updatingUi;

    public MainWindow()
    {
        InitializeComponent();
        CapabilityList.ItemsSource = capabilities;
        LoadDocument(IfcStepParser.CreateSample());
    }

    private void OpenIfc_Click(object sender, RoutedEventArgs e)
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

        var text = File.ReadAllText(dialog.FileName);
        LoadDocument(IfcStepParser.Parse(text, Path.GetFileName(dialog.FileName)));
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

        selectedEntity.Name = EntityNameBox.Text.Trim();
        selectedEntity.Description = EntityDescriptionBox.Text.Trim();

        var rawArguments = RawArgsBox.Text.Trim();
        if (!string.IsNullOrWhiteSpace(rawArguments))
        {
            selectedEntity.Arguments.Clear();
            selectedEntity.Arguments.AddRange(StepArgumentReader.SplitTopLevel(rawArguments));
        }

        var selectedId = selectedEntity.Id;
        var refreshed = IfcStepParser.Parse(document.ToStepText(), document.FileName);
        LoadDocument(refreshed, selectedId);
        StatusText.Text = $"Saved edit for #{selectedId}";
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

    private void LoadDocument(IfcDocument nextDocument, int? selectId = null)
    {
        updatingUi = true;
        document = nextDocument;
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
    }
}

