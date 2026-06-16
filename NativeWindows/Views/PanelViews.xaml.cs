using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Controls.Shapes;
using Avalonia.Input;
using Avalonia.ReactiveUI;
using Avalonia.VisualTree;
using Avalonia.Interactivity;
using Avalonia.Media;
using Avalonia.Threading;
using IFCnative.NativeWindows.Models;
using IFCnative.NativeWindows.ViewModels;
using System.Collections.Specialized;

namespace IFCnative.NativeWindows.Views;

public partial class StructurePanelView : ReactiveUserControl<StructurePanelViewModel>
{
    private StructurePanelViewModel? activeViewModel;

    public StructurePanelView()
    {
        InitializeComponent();
        DataContextChanged += OnDataContextChanged;
    }

    private void OnDataContextChanged(object? sender, EventArgs e)
    {
        if (activeViewModel is not null)
        {
            activeViewModel.PropertyChanged -= OnViewModelPropertyChanged;
            activeViewModel.MultiSelectionApplyRequested -= OnMultiSelectionApplyRequested;
        }

        activeViewModel = DataContext as StructurePanelViewModel;

        if (activeViewModel is not null)
        {
            activeViewModel.PropertyChanged += OnViewModelPropertyChanged;
            activeViewModel.MultiSelectionApplyRequested += OnMultiSelectionApplyRequested;
        }
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(StructurePanelViewModel.SelectedRow))
        {
            if (DataContext is StructurePanelViewModel viewModel && viewModel.SelectedRow is { } selectedRow)
            {
                Dispatcher.UIThread.Post(
                    () => this.FindControl<ListBox>("TreeListBox")?.ScrollIntoView(selectedRow),
                    DispatcherPriority.Background);
            }
        }
    }

    private void OnTreeSelectionChanged(object? sender, SelectionChangedEventArgs e)
    {
        if (activeViewModel is null || activeViewModel.IsProgrammaticUpdate || sender is not ListBox listBox)
        {
            return;
        }

        var ids = listBox.SelectedItems?
            .OfType<IfcFileTreeRowViewModel>()
            .Select(row => row.Node.Entity.Id)
            .ToList() ?? [];
        activeViewModel.OnUserSelectionChanged(ids);
    }

    private void OnMultiSelectionApplyRequested(object? sender, IReadOnlyList<int> entityIds)
    {
        if (this.FindControl<ListBox>("TreeListBox") is not { } listBox || listBox.SelectedItems is not { } selectedItems)
        {
            return;
        }

        var wanted = entityIds as ISet<int> ?? entityIds.ToHashSet();
        var rows = activeViewModel?.Rows.Where(row => wanted.Contains(row.Node.Entity.Id)).ToList() ?? [];

        selectedItems.Clear();
        foreach (var row in rows)
        {
            selectedItems.Add(row);
        }
    }
}

public partial class TypesPanelView : ReactiveUserControl<TypesPanelViewModel>
{
    public TypesPanelView() => InitializeComponent();
}

public partial class ModelsPanelView : ReactiveUserControl<ModelsPanelViewModel>
{
    public ModelsPanelView() => InitializeComponent();

    private void OnModelCardPressed(object? sender, Avalonia.Input.PointerPressedEventArgs e)
    {
        // The eye toggle and the remove button inside the card handle their own
        // clicks; activating the card here would race them (e.g. re-activating a
        // session that is being removed).
        if (e.Source is Control source && source.FindAncestorOfType<Button>(includeSelf: true) is not null)
        {
            return;
        }

        if (sender is Control { DataContext: IfcDocumentSessionViewModel session })
        {
            session.IsActive = true;
        }
    }
}

public partial class ViewportPanelView : ReactiveUserControl<ViewportPanelViewModel>
{
    public ViewportPanelView() => InitializeComponent();

    private void OnViewportProductPicked(object? sender, IfcProductPickedEventArgs e)
    {
        if (DataContext is ViewportPanelViewModel viewModel)
        {
            viewModel.SelectProduct(e.ProductId);
        }
    }

    private void OnViewportPointPicked(object? sender, ViewportPointPickedEventArgs e)
    {
        if (DataContext is ViewportPanelViewModel viewModel)
        {
            viewModel.HandlePointPicked(e.WorldX, e.WorldY, e.WorldZ);
        }
    }

    private void OnViewportProductTransformCommitted(object? sender, IfcProductTransformCommittedEventArgs e)
    {
        if (DataContext is ViewportPanelViewModel viewModel)
        {
            if (!viewModel.CommitProductTransform(e.ProductId, e.MoveDeltaWorld, e.RotateZRadians))
            {
                ViewportCanvas.ClearTransformPreview();
            }
        }
    }

    private void OnViewportFpsUpdated(object? sender, ViewportFpsUpdatedEventArgs e)
    {
        if (DataContext is ViewportPanelViewModel viewModel)
        {
            viewModel.FpsText = e.Text;
        }
    }

    private void OnViewportFit(object? sender, RoutedEventArgs e)
    {
        ViewportCanvas.FitCamera();
    }

    private void OnViewportFrame(object? sender, RoutedEventArgs e)
    {
        ViewportCanvas.FrameSelectedProduct();
    }

    private void OnViewportIso(object? sender, RoutedEventArgs e)
    {
        ViewportCanvas.SetIsoView();
    }

    private void OnNavCubeViewRequested(object? sender, NavCubeViewRequestedEventArgs e)
    {
        ViewportCanvas.SetViewOrientation(e.YawDegrees, e.PitchDegrees);
    }

    private void OnNavCubeOrbitRequested(object? sender, NavCubeOrbitEventArgs e)
    {
        ViewportCanvas.OrbitCamera(e.DeltaX, e.DeltaY);
    }
}

public partial class InspectorPanelView : ReactiveUserControl<InspectorPanelViewModel>
{
    public InspectorPanelView() => InitializeComponent();

    private void OnPsetValueLostFocus(object? sender, RoutedEventArgs e)
    {
        if (sender is Control { DataContext: IfcPropertyTableRowViewModel row })
        {
            row.SaveIfChanged();
        }
    }

    private void OnPsetValueKeyDown(object? sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter && sender is Control { DataContext: IfcPropertyTableRowViewModel row })
        {
            row.SaveIfChanged();
            e.Handled = true;
        }
    }

    private void OnPsetTypeChanged(object? sender, SelectionChangedEventArgs e)
    {
        // Fires during template binding too; SaveIfChanged is dirty-checked, so
        // only real user changes commit.
        if (sender is Control { DataContext: IfcPropertyTableRowViewModel row, IsLoaded: true })
        {
            row.SaveIfChanged();
        }
    }
}

public partial class PsetBatchPanelView : ReactiveUserControl<PsetBatchPanelViewModel>
{
    public PsetBatchPanelView() => InitializeComponent();

    private void OnCellLostFocus(object? sender, RoutedEventArgs e)
    {
        if (sender is Control { DataContext: PsetBatchCellViewModel cell })
        {
            cell.SaveIfChanged();
        }
    }

    private void OnCellKeyDown(object? sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter && sender is Control { DataContext: PsetBatchCellViewModel cell })
        {
            cell.SaveIfChanged();
            e.Handled = true;
        }
    }

    // Right-click a value: a context menu to set that property's measure type.
    private void OnCellContextRequested(object? sender, ContextRequestedEventArgs e)
    {
        if (sender is not Control { DataContext: PsetBatchCellViewModel cell } control)
        {
            return;
        }

        e.Handled = true;
        var typeRoot = new MenuItem { Header = "Set value type" };
        foreach (var type in PsetValueTypes.Common)
        {
            var option = type;
            var item = new MenuItem { Header = option };
            // Defer: setting the type rebuilds this panel, which would tear down
            // the menu's visual tree while the click is still being dispatched.
            item.Click += (_, _) => Dispatcher.UIThread.Post(() => cell.SetType(option), DispatcherPriority.Background);
            typeRoot.Items.Add(item);
        }

        var menu = new ContextMenu();
        menu.Items.Add(typeRoot);
        menu.Open(control);
    }

    // Right-click the property name: a menu to rename the row or set its type.
    private void OnPropertyLabelContextRequested(object? sender, ContextRequestedEventArgs e)
    {
        if (sender is not Control { DataContext: PsetBatchPropertyViewModel row } control)
        {
            return;
        }

        e.Handled = true;

        var renameItem = new MenuItem { Header = "Rename property…" };
        // Defer so the context menu fully closes before the rename popup opens.
        renameItem.Click += (_, _) => Dispatcher.UIThread.Post(() => ShowRenameFlyout(control, row), DispatcherPriority.Background);

        var typeRoot = new MenuItem { Header = "Set value type" };
        foreach (var type in PsetValueTypes.Common)
        {
            var option = type;
            var item = new MenuItem { Header = option };
            item.Click += (_, _) => Dispatcher.UIThread.Post(() => row.ApplyRowEdit(row.Name, option), DispatcherPriority.Background);
            typeRoot.Items.Add(item);
        }

        var menu = new ContextMenu();
        menu.Items.Add(renameItem);
        menu.Items.Add(typeRoot);
        menu.Open(control);
    }

    private static void ShowRenameFlyout(Control control, PsetBatchPropertyViewModel row)
    {
        var nameBox = new TextBox { Text = row.Name, Watermark = "Property name", MinWidth = 200 };
        var apply = new Button
        {
            Content = "Rename",
            Classes = { "primary" },
            HorizontalAlignment = Avalonia.Layout.HorizontalAlignment.Right,
        };

        var flyout = new Flyout
        {
            Content = new StackPanel
            {
                Spacing = 6,
                Children =
                {
                    new TextBlock { Text = "Rename property (whole row)", Classes = { "caption" } },
                    nameBox,
                    apply,
                },
            },
        };

        apply.Click += (_, _) =>
        {
            var newName = nameBox.Text ?? string.Empty;
            flyout.Hide();
            // Defer: the rename rebuilds the panel and tears down this popup.
            Dispatcher.UIThread.Post(() => row.ApplyRowEdit(newName, null), DispatcherPriority.Background);
        };

        flyout.ShowAt(control);
        Dispatcher.UIThread.Post(() => nameBox.Focus(), DispatcherPriority.Background);
    }
}

public partial class DraftPanelView : ReactiveUserControl<DraftPanelViewModel>
{
    public DraftPanelView() => InitializeComponent();
}

public partial class GraphPanelView : ReactiveUserControl<GraphPanelViewModel>
{
    private GraphPanelViewModel? activeViewModel;

    public GraphPanelView()
    {
        InitializeComponent();
        DataContextChanged += OnDataContextChanged;
        AttachedToVisualTree += (_, _) => QueueRenderGraph();
    }

    private void OnDataContextChanged(object? sender, EventArgs e)
    {
        if (activeViewModel is not null)
        {
            activeViewModel.PropertyChanged -= OnGraphPropertyChanged;
            activeViewModel.VisualNodes.CollectionChanged -= OnGraphCollectionChanged;
            activeViewModel.VisualEdges.CollectionChanged -= OnGraphCollectionChanged;
        }

        activeViewModel = DataContext as GraphPanelViewModel;

        if (activeViewModel is not null)
        {
            activeViewModel.PropertyChanged += OnGraphPropertyChanged;
            activeViewModel.VisualNodes.CollectionChanged += OnGraphCollectionChanged;
            activeViewModel.VisualEdges.CollectionChanged += OnGraphCollectionChanged;
        }

        QueueRenderGraph();
    }

    private void OnGraphPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(GraphPanelViewModel.GraphSummary))
        {
            QueueRenderGraph();
        }
    }

    private void OnGraphCollectionChanged(object? sender, NotifyCollectionChangedEventArgs e)
    {
        QueueRenderGraph();
    }

    private void QueueRenderGraph()
    {
        Dispatcher.UIThread.Post(RenderGraph, DispatcherPriority.Background);
    }

    private void RenderGraph()
    {
        if (activeViewModel is null || GraphCanvas is null)
        {
            return;
        }

        GraphCanvas.Children.Clear();
        foreach (var edge in activeViewModel.VisualEdges)
        {
            AddGraphEdge(edge);
        }

        foreach (var node in activeViewModel.VisualNodes)
        {
            AddGraphNode(node);
        }
    }

    private void AddGraphEdge(IfcRelationshipGraphVisualEdge edge)
    {
        var brush = BrushFrom(edge.Tone);
        var start = new Avalonia.Point(edge.X1, edge.Y1);
        var end = new Avalonia.Point(edge.X2, edge.Y2);
        if (activeViewModel is not null)
        {
            var sourceNode = activeViewModel.VisualNodes.FirstOrDefault(node => node.EntityId == edge.SourceId);
            var targetNode = activeViewModel.VisualNodes.FirstOrDefault(node => node.EntityId == edge.TargetId);
            if (sourceNode is not null && targetNode is not null)
            {
                (start, end) = ClipEdgeToNodeRims(
                    start,
                    end,
                    NodeRadius(sourceNode) + 8,
                    NodeRadius(targetNode) + 8);
            }
        }

        var line = new Line
        {
            StartPoint = start,
            EndPoint = end,
            Stroke = brush,
            StrokeThickness = 2,
            StrokeDashArray = new Avalonia.Collections.AvaloniaList<double> { 6, 5 },
            Opacity = 0.78,
        };
        GraphCanvas.Children.Add(line);

        var endpoint = new Ellipse
        {
            Width = 6,
            Height = 6,
            Fill = brush,
            Stroke = new SolidColorBrush(Color.Parse("#181A17")),
            StrokeThickness = 1.5,
        };
        Canvas.SetLeft(endpoint, end.X - 3);
        Canvas.SetTop(endpoint, end.Y - 3);
        GraphCanvas.Children.Add(endpoint);

        var label = new Border
        {
            Background = new SolidColorBrush(Color.Parse("#22251F")),
            BorderBrush = new SolidColorBrush(Color.Parse("#3A4035")),
            BorderThickness = new Avalonia.Thickness(1),
            CornerRadius = new Avalonia.CornerRadius(6),
            Padding = new Avalonia.Thickness(6, 2),
            Child = new TextBlock
            {
                Text = edge.Label,
                Foreground = brush,
                FontSize = 10,
                FontWeight = FontWeight.SemiBold,
                MaxWidth = 150,
                TextTrimming = Avalonia.Media.TextTrimming.CharacterEllipsis,
            },
        };
        Canvas.SetLeft(label, ((start.X + end.X) / 2) - 54);
        Canvas.SetTop(label, ((start.Y + end.Y) / 2) - 12);
        GraphCanvas.Children.Add(label);
    }

    private void AddGraphNode(IfcRelationshipGraphVisualNode node)
    {
        var tone = BrushFrom(node.Tone);
        var size = node.IsCenter ? 92 : 72;
        var labelWidth = node.IsCenter ? 184 : 156;
        var root = new Button
        {
            Background = Brushes.Transparent,
            BorderBrush = Brushes.Transparent,
            BorderThickness = new Avalonia.Thickness(0),
            Padding = new Avalonia.Thickness(0),
            Command = activeViewModel?.SelectVisualNodeCommand,
            CommandParameter = node,
            Width = labelWidth,
            Height = node.IsCenter ? 142 : 124,
            HorizontalContentAlignment = Avalonia.Layout.HorizontalAlignment.Center,
            VerticalContentAlignment = Avalonia.Layout.VerticalAlignment.Top,
        };

        var stack = new StackPanel
        {
            Spacing = 4,
            HorizontalAlignment = Avalonia.Layout.HorizontalAlignment.Center,
            VerticalAlignment = Avalonia.Layout.VerticalAlignment.Top,
        };
        var circle = new Border
        {
            Width = size,
            Height = size,
            CornerRadius = new Avalonia.CornerRadius(size / 2d),
            Background = SoftBrush(node.Tone),
            BorderBrush = tone,
            BorderThickness = new Avalonia.Thickness(node.IsCenter ? 2 : 1.6),
            Child = new TextBlock
            {
                Text = node.Glyph,
                Foreground = tone,
                FontSize = node.IsCenter ? 34 : 27,
                FontWeight = FontWeight.Bold,
                HorizontalAlignment = Avalonia.Layout.HorizontalAlignment.Center,
                VerticalAlignment = Avalonia.Layout.VerticalAlignment.Center,
            },
        };
        stack.Children.Add(circle);
        stack.Children.Add(new TextBlock
        {
            Text = node.Title,
            Foreground = new SolidColorBrush(Color.Parse("#E8EAE4")),
            FontSize = node.IsCenter ? 14 : 12,
            FontWeight = FontWeight.SemiBold,
            HorizontalAlignment = Avalonia.Layout.HorizontalAlignment.Center,
            MaxWidth = labelWidth,
            TextAlignment = TextAlignment.Center,
            TextTrimming = Avalonia.Media.TextTrimming.CharacterEllipsis,
        });
        stack.Children.Add(new TextBlock
        {
            Text = node.Subtitle,
            Foreground = new SolidColorBrush(Color.Parse("#A4AA9F")),
            FontSize = 10,
            HorizontalAlignment = Avalonia.Layout.HorizontalAlignment.Center,
            MaxWidth = labelWidth,
            TextAlignment = TextAlignment.Center,
            TextTrimming = Avalonia.Media.TextTrimming.CharacterEllipsis,
        });
        root.Content = stack;

        Canvas.SetLeft(root, node.CenterX - labelWidth / 2d);
        Canvas.SetTop(root, node.CenterY - size / 2d);
        GraphCanvas.Children.Add(root);
    }

    private static (Avalonia.Point Start, Avalonia.Point End) ClipEdgeToNodeRims(
        Avalonia.Point start,
        Avalonia.Point end,
        double startRadius,
        double endRadius)
    {
        var dx = end.X - start.X;
        var dy = end.Y - start.Y;
        var length = Math.Sqrt((dx * dx) + (dy * dy));
        if (length <= startRadius + endRadius)
        {
            return (start, end);
        }

        var unitX = dx / length;
        var unitY = dy / length;
        return (
            new Avalonia.Point(start.X + (unitX * startRadius), start.Y + (unitY * startRadius)),
            new Avalonia.Point(end.X - (unitX * endRadius), end.Y - (unitY * endRadius)));
    }

    private static double NodeRadius(IfcRelationshipGraphVisualNode node)
    {
        return node.IsCenter ? 46 : 36;
    }

    private static IBrush BrushFrom(string color)
    {
        return new SolidColorBrush(Color.Parse(color));
    }

    private static IBrush SoftBrush(string color)
    {
        var parsed = Color.Parse(color);
        return new SolidColorBrush(Color.FromArgb(44, parsed.R, parsed.G, parsed.B));
    }
}

public partial class DiagnosticsPanelView : ReactiveUserControl<DiagnosticsPanelViewModel>
{
    public DiagnosticsPanelView() => InitializeComponent();
}

public partial class BuilderPanelView : ReactiveUserControl<BuilderPanelViewModel>
{
    public BuilderPanelView() => InitializeComponent();
}

public partial class RecentFilesPanelView : ReactiveUserControl<RecentFilesPanelViewModel>
{
    public RecentFilesPanelView() => InitializeComponent();
}

public partial class NotesPanelView : ReactiveUserControl<NotesPanelViewModel>
{
    public NotesPanelView() => InitializeComponent();
}

public partial class ConsolePanelView : ReactiveUserControl<ConsolePanelViewModel>
{
    public ConsolePanelView() => InitializeComponent();
}

public partial class SettingsPanelView : ReactiveUserControl<SettingsPanelViewModel>
{
    public SettingsPanelView() => InitializeComponent();
}
