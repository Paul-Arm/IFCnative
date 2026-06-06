using System.Collections.Specialized;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.ReactiveUI;
using IFCnative.NativeWindows.Services;
using IFCnative.NativeWindows.ViewModels;

namespace IFCnative.NativeWindows;

public partial class MainWindow : ReactiveWindow<MainWindowViewModel>
{
    public MainWindow()
    {
        InitializeComponent();
        ViewModel = new MainWindowViewModel(new AvaloniaFileDialogService(this));
        DataContext = ViewModel;
        KeyDown += OnKeyDown;
        ViewModel.Documents.CollectionChanged += Documents_CollectionChanged;
        ViewModel.Recent.Entries.CollectionChanged += RecentEntries_CollectionChanged;
        ViewModel.PropertyChanged += (_, args) =>
        {
            if (args.PropertyName is nameof(MainWindowViewModel.DockFactory) or nameof(MainWindowViewModel.DockLayout))
            {
                ApplyDockLayout();
            }

            if (args.PropertyName is nameof(MainWindowViewModel.TextScale))
            {
                ApplyTextScaleResources();
            }

            if (args.PropertyName is nameof(MainWindowViewModel.ActiveSession) or nameof(MainWindowViewModel.SessionSummary))
            {
                RebuildDocumentsMenu();
            }
        };
        ApplyTextScaleResources();
        ApplyDockLayout();
        RebuildDocumentsMenu();
        RebuildRecentFilesMenu();
    }

    private void ApplyDockLayout()
    {
        if (ViewModel?.DockFactory is null || ViewModel.DockLayout is null)
        {
            return;
        }

        WorkspaceDock.Factory = ViewModel.DockFactory;
        WorkspaceDock.Layout = ViewModel.DockLayout;
    }

    private void ExitMenuItem_Click(object? sender, Avalonia.Interactivity.RoutedEventArgs args)
    {
        Close();
    }

    private void Documents_CollectionChanged(object? sender, NotifyCollectionChangedEventArgs args)
    {
        RebuildDocumentsMenu();
    }

    private void RecentEntries_CollectionChanged(object? sender, NotifyCollectionChangedEventArgs args)
    {
        RebuildRecentFilesMenu();
    }

    private void RebuildDocumentsMenu()
    {
        if (ViewModel is null)
        {
            return;
        }

        DocumentsMenu.Items.Clear();

        if (ViewModel.Documents.Count == 0)
        {
            DocumentsMenu.Items.Add(new MenuItem
            {
                Header = "No IFC files loaded",
                IsEnabled = false,
            });
            return;
        }

        DocumentsMenu.Items.Add(new MenuItem
        {
            Header = ViewModel.SessionSummary,
            IsEnabled = false,
        });
        DocumentsMenu.Items.Add(new Separator());

        foreach (var session in ViewModel.Documents)
        {
            var isActive = ReferenceEquals(session, ViewModel.ActiveSession);
            var item = new MenuItem
            {
                Header = $"{(isActive ? "* " : string.Empty)}{session.FileName}",
                InputGesture = null,
            };
            item.Click += (_, _) => ViewModel.ActiveSession = session;
            DocumentsMenu.Items.Add(item);
        }
    }

    private void RebuildRecentFilesMenu()
    {
        if (ViewModel is null)
        {
            return;
        }

        RecentFilesMenu.Items.Clear();

        if (ViewModel.Recent.Entries.Count == 0)
        {
            RecentFilesMenu.Items.Add(new MenuItem
            {
                Header = "No recent IFC files",
                IsEnabled = false,
            });
            return;
        }

        var index = 1;
        foreach (var entry in ViewModel.Recent.Entries)
        {
            var item = new MenuItem
            {
                Header = $"{index}  {entry.FileName}",
                InputGesture = null,
            };
            ToolTip.SetTip(item, entry.Path);
            item.Click += async (_, _) => await ViewModel.OpenPathAsync(entry.Path);
            RecentFilesMenu.Items.Add(item);
            index++;
        }
    }

    private void OnKeyDown(object? sender, KeyEventArgs args)
    {
        if (ViewModel is null || !args.KeyModifiers.HasFlag(KeyModifiers.Control))
        {
            return;
        }

        switch (args.Key)
        {
            case Key.Add:
            case Key.OemPlus:
                ViewModel.IncreaseTextScale();
                args.Handled = true;
                break;
            case Key.Subtract:
            case Key.OemMinus:
                ViewModel.DecreaseTextScale();
                args.Handled = true;
                break;
            case Key.D0:
            case Key.NumPad0:
                ViewModel.ResetTextScale();
                args.Handled = true;
                break;
        }
    }

    private void ApplyTextScaleResources()
    {
        var scale = ViewModel?.TextScale ?? 1.0;
        SetFontResource("FontSizeBody", 13.0, scale);
        SetFontResource("FontSizeCaption", 11.0, scale);
        SetFontResource("FontSizeSection", 13.0, scale);
        SetFontResource("FontSizeHeader", 15.0, scale);
        SetFontResource("FontSizeBadge", 11.0, scale);
        SetFontResource("FontSizeTree", 11.0, scale);
        SetFontResource("FontSizeTreeMeta", 9.5, scale);

        Resources["FileTreeRowHeight"] = 24.0 * scale;
        Resources["FileTreeGuideWidth"] = 16.0 * scale;
        Resources["FileTreeChevronSlot"] = 18.0 * scale;
        Resources["FileTreeChevronSize"] = 10.0 * scale;
        Resources["FileTreeIconSize"] = 16.0 * scale;
        FontSize = 13.0 * scale;
    }

    private void SetFontResource(string key, double baseSize, double scale)
    {
        Resources[key] = Math.Round(baseSize * scale, 1);
    }
}
