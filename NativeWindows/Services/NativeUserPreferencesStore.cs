using System.IO;
using System.Text.Json;
using IFCnative.NativeWindows.Models;

namespace IFCnative.NativeWindows.Services;

public sealed class NativeUserPreferencesStore
{
    private const double MinimumTextScale = 0.7;
    private const double MaximumTextScale = 1.8;
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    private readonly string storePath;

    public NativeUserPreferencesStore(string? storePath = null)
    {
        if (!string.IsNullOrWhiteSpace(storePath))
        {
            this.storePath = storePath;
            return;
        }

        var appData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var folder = Path.Combine(appData, "IFCnative", "NativeWindows");
        this.storePath = Path.Combine(folder, "user-preferences.json");
    }

    public NativeUserPreferences Load()
    {
        if (!File.Exists(storePath))
        {
            return new NativeUserPreferences();
        }

        try
        {
            var json = File.ReadAllText(storePath);
            return Sanitize(JsonSerializer.Deserialize<NativeUserPreferences>(json, JsonOptions) ?? new NativeUserPreferences());
        }
        catch
        {
            return new NativeUserPreferences();
        }
    }

    public void Save(NativeUserPreferences preferences)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(storePath)!);
        File.WriteAllText(storePath, JsonSerializer.Serialize(Sanitize(preferences), JsonOptions));
    }

    public static double SanitizeTextScale(double value)
    {
        if (double.IsNaN(value) || double.IsInfinity(value) || value <= 0)
        {
            return 1.0;
        }

        return Math.Clamp(Math.Round(value, 2), MinimumTextScale, MaximumTextScale);
    }

    private static NativeUserPreferences Sanitize(NativeUserPreferences preferences)
    {
        return preferences with { TextScale = SanitizeTextScale(preferences.TextScale) };
    }
}
