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
            .With(new Win32PlatformOptions
            {
                // ANGLE (D3D11) is Avalonia's default and most stable Windows backend.
                // The WGL shared-context path intermittently fails to configure the
                // swapchain FBO under continuous rendering, crashing the process.
                RenderingMode = [Win32RenderingMode.AngleEgl, Win32RenderingMode.Wgl, Win32RenderingMode.Software],
            })
            .LogToTrace()
            .UseReactiveUI();
    }
}
