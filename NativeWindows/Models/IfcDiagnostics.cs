namespace IFCnative.NativeWindows.Models;

public sealed class IfcDiagnostics
{
    public List<string> Messages { get; } = [];

    public bool HasErrors => Messages.Any(message => message.StartsWith("Error:", StringComparison.OrdinalIgnoreCase));

    public void Info(string message) => Messages.Add($"Info: {message}");

    public void Warn(string message) => Messages.Add($"Warning: {message}");

    public void Error(string message) => Messages.Add($"Error: {message}");
}

