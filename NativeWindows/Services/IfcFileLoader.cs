using System.IO;
using System.Text;

namespace IFCnative.NativeWindows.Services;

public static class IfcFileLoader
{
    private const int BufferSize = 1024 * 1024;

    public static async Task<string> ReadTextAsync(
        string path,
        IProgress<string>? progress = null,
        CancellationToken cancellationToken = default)
    {
        var fileInfo = new FileInfo(path);
        progress?.Report($"Opening {fileInfo.Name} ({FormatBytes(fileInfo.Length)})…");

        await using var stream = new FileStream(
            path,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            BufferSize,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true, bufferSize: BufferSize, leaveOpen: false);

        var builder = new StringBuilder(fileInfo.Length > int.MaxValue ? int.MaxValue : (int)fileInfo.Length);
        var buffer = new char[BufferSize];
        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var read = await reader.ReadAsync(buffer.AsMemory(0, buffer.Length), cancellationToken);
            if (read == 0)
            {
                break;
            }

            builder.Append(buffer, 0, read);
            progress?.Report($"Read {FormatBytes(stream.Position)} / {FormatBytes(fileInfo.Length)} from {fileInfo.Name}…");
        }

        return builder.ToString();
    }

    public static string FormatBytes(long bytes)
    {
        string[] units = ["B", "KB", "MB", "GB"];
        var value = (double)bytes;
        var unit = 0;
        while (value >= 1024 && unit < units.Length - 1)
        {
            value /= 1024;
            unit++;
        }

        return $"{value:0.#} {units[unit]}";
    }
}
