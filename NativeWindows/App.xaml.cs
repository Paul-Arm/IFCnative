using Avalonia;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;

namespace IFCnative.NativeWindows;

public partial class App : Application
{
    public override void Initialize()
    {
        AvaloniaXamlLoader.Load(this);
    }

    public override void OnFrameworkInitializationCompleted()
    {
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
        {
            var startupFiles = (desktop.Args ?? [])
                .Where(File.Exists)
                .ToList();
            var mainWindow = new MainWindow(loadSample: startupFiles.Count == 0);
            desktop.MainWindow = mainWindow;
            foreach (var path in startupFiles)
            {
                _ = mainWindow.ViewModel?.OpenPathAsync(path);
            }
        }

        base.OnFrameworkInitializationCompleted();
    }
}
