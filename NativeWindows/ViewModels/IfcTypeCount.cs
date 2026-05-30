namespace IFCnative.NativeWindows.ViewModels;

public sealed record IfcTypeCount(string Type, int Count)
{
    public string Label => $"{Type} ({Count:N0})";
}
