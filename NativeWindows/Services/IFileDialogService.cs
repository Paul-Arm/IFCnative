namespace IFCnative.NativeWindows.Services;

public interface IFileDialogService
{
    Task<IReadOnlyList<string>> OpenIfcFilesAsync(bool allowMultiple, CancellationToken cancellationToken = default);

    Task<string?> SaveIfcFileAsync(string suggestedFileName, CancellationToken cancellationToken = default);
}
