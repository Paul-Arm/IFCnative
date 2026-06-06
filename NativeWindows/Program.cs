using Avalonia;
using Avalonia.ReactiveUI;
using Avalonia.Win32;
using IFCnative.NativeWindows.Services;

namespace IFCnative.NativeWindows;

internal static class Program
{
    [STAThread]
    public static void Main(string[] args)
    {
        XbimIfcDocumentService.ConfigureToolkit();
        BuildAvaloniaApp().StartWithClassicDesktopLifetime(args);
    }

    public static AppBuilder BuildAvaloniaApp()
    {
        return AppBuilder
            .Configure<App>()
            .UsePlatformDetect()
            .With(new Win32PlatformOptions { RenderingMode = [Win32RenderingMode.Wgl] })
            .LogToTrace()
            .UseReactiveUI();
    }
}
