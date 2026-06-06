using Avalonia.Controls;
using Avalonia.ReactiveUI;
using Avalonia.Interactivity;
using IFCnative.NativeWindows.ViewModels;

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
        }

        activeViewModel = DataContext as StructurePanelViewModel;

        if (activeViewModel is not null)
        {
            activeViewModel.PropertyChanged += OnViewModelPropertyChanged;
        }
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(StructurePanelViewModel.SelectedRow))
        {
            if (DataContext is StructurePanelViewModel viewModel && viewModel.SelectedRow is { } selectedRow)
            {
                var listBox = this.FindControl<ListBox>("TreeListBox");
                listBox?.ScrollIntoView(selectedRow);
            }
        }
    }
}

public partial class TypesPanelView : ReactiveUserControl<TypesPanelViewModel>
{
    public TypesPanelView() => InitializeComponent();
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

    private void OnViewportTop(object? sender, RoutedEventArgs e)
    {
        ViewportCanvas.SetTopView();
    }

    private void OnViewportFront(object? sender, RoutedEventArgs e)
    {
        ViewportCanvas.SetFrontView();
    }

    private void OnViewportRight(object? sender, RoutedEventArgs e)
    {
        ViewportCanvas.SetRightView();
    }
}

public partial class InspectorPanelView : ReactiveUserControl<InspectorPanelViewModel>
{
    public InspectorPanelView() => InitializeComponent();
}

public partial class DraftPanelView : ReactiveUserControl<DraftPanelViewModel>
{
    public DraftPanelView() => InitializeComponent();
}

public partial class GraphPanelView : ReactiveUserControl<GraphPanelViewModel>
{
    public GraphPanelView() => InitializeComponent();
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
