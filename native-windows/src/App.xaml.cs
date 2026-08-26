using Avalonia;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;
using Avalonia.OpenGL;
using Avalonia.Threading;

namespace IFCnative.NativeWindows;

public partial class App : Application
{
    private int transientRenderFailureCount;

    public override void Initialize()
    {
        AvaloniaXamlLoader.Load(this);
    }

    public override void OnFrameworkInitializationCompleted()
    {
        Dispatcher.UIThread.UnhandledException += OnDispatcherUnhandledException;
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

    private void OnDispatcherUnhandledException(object sender, DispatcherUnhandledExceptionEventArgs e)
    {
        // Avalonia's OpenGL swapchain can transiently fail to configure its FBO
        // (e.g. under fast continuous rendering with WGL). Dropping the frame and
        // retrying on the next composition pass is safe; crashing the app is not.
        if (FindOpenGlException(e.Exception) is not { } glException)
        {
            return;
        }

        e.Handled = true;
        // Avalonia marks exceptions it has already routed through the dispatcher
        // via e.Exception.Data and refuses to catch the same instance twice.
        // The compositor can rethrow the same OpenGlException instance from a
        // cached commit, so clear the marker to keep it catchable.
        try
        {
            e.Exception.Data.Clear();
        }
        catch
        {
        }

        transientRenderFailureCount++;
        LogRenderFailure(glException);
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime { MainWindow: { } window })
        {
            // Schedule another composition pass so the viewport recovers without
            // waiting for the next input event.
            Dispatcher.UIThread.Post(window.InvalidateVisual, DispatcherPriority.Background);
        }
    }

    private static OpenGlException? FindOpenGlException(Exception? exception)
    {
        for (var current = exception; current is not null; current = current.InnerException)
        {
            if (current is OpenGlException glException)
            {
                return glException;
            }
        }

        return null;
    }

    private void LogRenderFailure(OpenGlException exception)
    {
        try
        {
            var path = Path.Combine(Path.GetTempPath(), "IFCnative.viewport.log");
            File.AppendAllText(
                path,
                $"{DateTimeOffset.Now:O} transient OpenGL render failure #{transientRenderFailureCount} handled: {exception.Message}{Environment.NewLine}");
        }
        catch
        {
        }
    }
}
