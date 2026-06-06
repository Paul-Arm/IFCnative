namespace IFCnative.NativeWindows.Models;

public sealed record RecentIfcFile(string Path, DateTimeOffset LastOpenedUtc)
{
    public string FileName => System.IO.Path.GetFileName(Path);

    public string Label => $"{FileName} - {Path}";
}
