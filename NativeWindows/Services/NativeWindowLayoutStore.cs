using System.Text.Json;
using IFCnative.NativeWindows.Models;

namespace IFCnative.NativeWindows.Services;

public sealed class NativeWindowLayoutStore
{
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    private readonly string storePath;

    public NativeWindowLayoutStore(string? storePath = null)
    {
        if (!string.IsNullOrWhiteSpace(storePath))
        {
            this.storePath = storePath;
            return;
        }

        var appData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var folder = Path.Combine(appData, "IFCnative", "NativeWindows");
        this.storePath = Path.Combine(folder, "window-layout.json");
    }

    public NativeWindowLayout Load()
    {
        if (!File.Exists(storePath))
        {
            return new NativeWindowLayout();
        }

        try
        {
            var json = File.ReadAllText(storePath);
            var layout = JsonSerializer.Deserialize<NativeWindowLayout>(json, JsonOptions);
            return Sanitize(layout ?? new NativeWindowLayout());
        }
        catch
        {
            return new NativeWindowLayout();
        }
    }

    public void Save(NativeWindowLayout layout)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(storePath)!);
        File.WriteAllText(storePath, JsonSerializer.Serialize(Sanitize(layout), JsonOptions));
    }

    private static NativeWindowLayout Sanitize(NativeWindowLayout layout)
    {
        var showViewport = layout.ShowViewportPane || (!layout.ShowModelPane && !layout.ShowInspectorPane);
        return layout with
        {
            ShowViewportPane = showViewport,
            ModelPaneWidth = Clamp(layout.ModelPaneWidth, 260, 900, 330),
            InspectorPaneWidth = Clamp(layout.InspectorPaneWidth, 320, 900, 380),
            WindowWidth = Clamp(layout.WindowWidth, 1100, 3840, 1440),
            WindowHeight = Clamp(layout.WindowHeight, 700, 2160, 900),
            LastOpenedIfcPath = NormalizePath(layout.LastOpenedIfcPath),
        };
    }

    private static double Clamp(double value, double min, double max, double fallback)
    {
        if (double.IsNaN(value) || double.IsInfinity(value) || value <= 0)
        {
            return fallback;
        }

        return Math.Min(max, Math.Max(min, value));
    }

    private static string? NormalizePath(string? path)
    {
        if (string.IsNullOrWhiteSpace(path))
        {
            return null;
        }

        try
        {
            return Path.GetFullPath(path);
        }
        catch
        {
            return null;
        }
    }
}
