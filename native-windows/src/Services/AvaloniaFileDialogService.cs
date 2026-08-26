using Avalonia.Controls;
using Avalonia.Platform.Storage;

namespace IFCnative.NativeWindows.Services;

public sealed class AvaloniaFileDialogService(Window owner) : IFileDialogService
{
    private static readonly FilePickerFileType IfcFileType = new("IFC / STEP")
    {
        Patterns = ["*.ifc", "*.ifczip", "*.zip", "*.stp", "*.step"],
        MimeTypes = ["application/octet-stream", "text/plain"],
    };

    public async Task<IReadOnlyList<string>> OpenIfcFilesAsync(bool allowMultiple, CancellationToken cancellationToken = default)
    {
        var files = await owner.StorageProvider.OpenFilePickerAsync(new FilePickerOpenOptions
        {
            Title = allowMultiple ? "Add IFC files" : "Open IFC file",
            AllowMultiple = allowMultiple,
            FileTypeFilter = [IfcFileType, FilePickerFileTypes.All],
        });

        cancellationToken.ThrowIfCancellationRequested();
        return files
            .Select(file => file.Path.LocalPath)
            .Where(path => !string.IsNullOrWhiteSpace(path))
            .ToList();
    }

    public async Task<string?> SaveIfcFileAsync(string suggestedFileName, CancellationToken cancellationToken = default)
    {
        var file = await owner.StorageProvider.SaveFilePickerAsync(new FilePickerSaveOptions
        {
            Title = "Export IFC",
            SuggestedFileName = suggestedFileName,
            DefaultExtension = "ifc",
            FileTypeChoices =
            [
                new FilePickerFileType("IFC")
                {
                    Patterns = ["*.ifc"],
                    MimeTypes = ["application/octet-stream", "text/plain"],
                },
                new FilePickerFileType("ifcZIP")
                {
                    Patterns = ["*.ifczip", "*.zip"],
                    MimeTypes = ["application/zip", "application/octet-stream"],
                },
                FilePickerFileTypes.All,
            ],
        });

        cancellationToken.ThrowIfCancellationRequested();
        return file?.Path.LocalPath;
    }
}
