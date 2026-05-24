using System.IO;
using System.IO.Compression;
using System.Text;

namespace IFCnative.NativeWindows.Services;

public static class IfcFileLoader
{
    private const int BufferSize = 1024 * 1024;

    public static async Task<LoadedIfcText> ReadAsync(
        string path,
        IProgress<string>? progress = null,
        CancellationToken cancellationToken = default)
    {
        var fileInfo = new FileInfo(path);
        progress?.Report($"Opening {fileInfo.Name} ({FormatBytes(fileInfo.Length)})…");

        if (IsIfcZip(path))
        {
            return await ReadZipAsync(path, progress, cancellationToken);
        }

        return new LoadedIfcText(await ReadPlainTextAsync(path, fileInfo, progress, cancellationToken), fileInfo.Name);
    }

    public static async Task<string> ReadTextAsync(
        string path,
        IProgress<string>? progress = null,
        CancellationToken cancellationToken = default)
    {
        return (await ReadAsync(path, progress, cancellationToken)).Text;
    }

    public static void WriteText(string path, string stepText, string documentFileName)
    {
        if (IsIfcZip(path))
        {
            WriteZip(path, stepText, documentFileName);
            return;
        }

        File.WriteAllText(path, stepText, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
    }

    private static async Task<string> ReadPlainTextAsync(
        string path,
        FileInfo fileInfo,
        IProgress<string>? progress,
        CancellationToken cancellationToken)
    {

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

    private static async Task<LoadedIfcText> ReadZipAsync(
        string path,
        IProgress<string>? progress,
        CancellationToken cancellationToken)
    {
        await using var stream = new FileStream(
            path,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            BufferSize,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        using var archive = new ZipArchive(stream, ZipArchiveMode.Read, leaveOpen: false);
        var entry = archive.Entries
            .Where(candidate => !string.IsNullOrWhiteSpace(candidate.Name) && IsIfcTextEntry(candidate.Name))
            .OrderByDescending(candidate => candidate.Name.EndsWith(".ifc", StringComparison.OrdinalIgnoreCase))
            .ThenBy(candidate => candidate.FullName, StringComparer.OrdinalIgnoreCase)
            .FirstOrDefault();

        if (entry is null)
        {
            throw new InvalidDataException("ifcZIP archive does not contain an .ifc, .stp, or .step file.");
        }

        progress?.Report($"Extracting {entry.FullName} from {Path.GetFileName(path)} ({FormatBytes(entry.Length)})…");
        await using var entryStream = entry.Open();
        using var reader = new StreamReader(entryStream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true, bufferSize: BufferSize, leaveOpen: false);
        var text = await reader.ReadToEndAsync(cancellationToken);
        return new LoadedIfcText(text, entry.Name);
    }

    private static void WriteZip(string path, string stepText, string documentFileName)
    {
        using var stream = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.None);
        using var archive = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: false);
        var entry = archive.CreateEntry(CreateIfcZipEntryName(documentFileName), CompressionLevel.Optimal);
        using var writer = new StreamWriter(entry.Open(), new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
        writer.Write(stepText);
    }

    private static bool IsIfcZip(string path)
    {
        var extension = Path.GetExtension(path);
        return extension.Equals(".ifczip", StringComparison.OrdinalIgnoreCase)
            || extension.Equals(".zip", StringComparison.OrdinalIgnoreCase);
    }

    private static string CreateIfcZipEntryName(string documentFileName)
    {
        var fileName = Path.GetFileName(documentFileName);
        var extension = Path.GetExtension(fileName);
        if (extension.Equals(".ifc", StringComparison.OrdinalIgnoreCase))
        {
            return fileName;
        }

        var stem = Path.GetFileNameWithoutExtension(fileName);
        return string.IsNullOrWhiteSpace(stem) ? "model.ifc" : $"{stem}.ifc";
    }

    private static bool IsIfcTextEntry(string name)
    {
        var extension = Path.GetExtension(name);
        return extension.Equals(".ifc", StringComparison.OrdinalIgnoreCase)
            || extension.Equals(".stp", StringComparison.OrdinalIgnoreCase)
            || extension.Equals(".step", StringComparison.OrdinalIgnoreCase);
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

public sealed record LoadedIfcText(string Text, string FileName);
