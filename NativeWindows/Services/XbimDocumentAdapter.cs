namespace IFCnative.NativeWindows.Services;

public sealed record XbimDocumentLoadResult(
    IfcDocument Document,
    IReadOnlyList<string> Messages,
    bool XbimAvailable,
    bool IsIfcXml)
{
    public string FileName => Document.FileName;
}

public sealed class XbimDocumentAdapter
{
    public async Task<XbimDocumentLoadResult> LoadAsync(
        string path,
        IProgress<string>? progress = null,
        CancellationToken cancellationToken = default)
    {
        var loaded = await IfcFileLoader.ReadAsync(path, progress, cancellationToken);
        progress?.Report($"Parsing {loaded.FileName}...");

        var document = await Task.Run(() => IfcStepParser.Parse(loaded.Text, loaded.FileName), cancellationToken);
        var dependencyMessages = NativeDependencyCatalog.GetStatuses()
            .Select(status => status.Label)
            .ToList();

        var xbimAvailable = NativeDependencyCatalog.CanResolve("Xbim.Ifc");
        dependencyMessages.Add(xbimAvailable
            ? "Info: xBIM adapter bridge is available for IFC/ifcZIP typed model workflows."
            : "Warning: xBIM adapter bridge is not resolvable at runtime.");

        var isIfcXml = IfcXmlExchange.IsIfcXml(path);
        if (isIfcXml)
        {
            dependencyMessages.Add("Info: Loaded ifcXML through the IFCnative stepText roundtrip payload.");
        }

        foreach (var message in dependencyMessages)
        {
            document.Diagnostics.Info(message);
        }

        return new XbimDocumentLoadResult(document, dependencyMessages, xbimAvailable, isIfcXml);
    }
}
