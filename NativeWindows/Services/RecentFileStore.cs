using System.IO;
using System.Text.Json;
using IFCnative.NativeWindows.Models;

namespace IFCnative.NativeWindows.Services;

public sealed class RecentFileStore
{
    private const int MaxRecentFiles = 10;
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    private readonly string storePath;

    public RecentFileStore()
    {
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var folder = Path.Combine(appData, "IFCnative", "NativeWindows");
        storePath = Path.Combine(folder, "recent-files.json");
    }

    public IReadOnlyList<RecentIfcFile> Load()
    {
        if (!File.Exists(storePath))
        {
            return [];
        }

        try
        {
            var json = File.ReadAllText(storePath);
            return JsonSerializer.Deserialize<List<RecentIfcFile>>(json, JsonOptions)?
                .Where(item => !string.IsNullOrWhiteSpace(item.Path))
                .GroupBy(item => item.Path, StringComparer.OrdinalIgnoreCase)
                .Select(group => group.OrderByDescending(item => item.LastOpenedUtc).First())
                .OrderByDescending(item => item.LastOpenedUtc)
                .Take(MaxRecentFiles)
                .ToList() ?? [];
        }
        catch
        {
            return [];
        }
    }

    public IReadOnlyList<RecentIfcFile> Add(string path)
    {
        var fullPath = Path.GetFullPath(path);
        var next = Load()
            .Where(item => !string.Equals(item.Path, fullPath, StringComparison.OrdinalIgnoreCase))
            .Prepend(new RecentIfcFile(fullPath, DateTimeOffset.UtcNow))
            .Take(MaxRecentFiles)
            .ToList();

        Save(next);
        return next;
    }

    public IReadOnlyList<RecentIfcFile> RemoveMissing()
    {
        var next = Load()
            .Where(item => File.Exists(item.Path))
            .ToList();

        Save(next);
        return next;
    }

    private void Save(IReadOnlyList<RecentIfcFile> files)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(storePath)!);
        File.WriteAllText(storePath, JsonSerializer.Serialize(files, JsonOptions));
    }
}
