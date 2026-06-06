using Avalonia;
using Avalonia.ReactiveUI;
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
            .LogToTrace()
            .UseReactiveUI();
    }
}
