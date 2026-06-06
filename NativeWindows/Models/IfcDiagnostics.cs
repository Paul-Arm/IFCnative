namespace IFCnative.NativeWindows.Models;

public sealed class IfcDiagnostics
{
    public List<string> Messages { get; } = [];

    public bool HasErrors => Messages.Any(message => message.StartsWith("Error:", StringComparison.OrdinalIgnoreCase));

    public bool HasBeenChecked { get; private set; }

    public IReadOnlyList<string> CheckMessages => checkStartIndex is null
        ? []
        : Messages.Skip(checkStartIndex.Value).Take(checkMessageCount).ToList();

    private int? checkStartIndex;
    private int checkMessageCount;

    public void Info(string message) => Messages.Add($"Info: {message}");

    public void Warn(string message) => Messages.Add($"Warning: {message}");

    public void Error(string message) => Messages.Add($"Error: {message}");

    public void BeginCheck()
    {
        if (checkStartIndex is int startIndex && checkMessageCount > 0)
        {
            Messages.RemoveRange(startIndex, checkMessageCount);
        }

        checkStartIndex = Messages.Count;
        checkMessageCount = 0;
        HasBeenChecked = true;
    }

    public void CheckInfo(string message) => AddCheckMessage("Info", message);

    public void CheckWarn(string message) => AddCheckMessage("Warning", message);

    public void CheckError(string message) => AddCheckMessage("Error", message);

    private void AddCheckMessage(string severity, string message)
    {
        if (checkStartIndex is null)
        {
            BeginCheck();
        }

        Messages.Add($"{severity}: {message}");
        checkMessageCount++;
    }
}

