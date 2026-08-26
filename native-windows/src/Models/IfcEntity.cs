using IFCnative.NativeWindows;

namespace IFCnative.NativeWindows.Models;

public sealed class IfcEntity
{
    public int Id { get; init; }

    public required string Type { get; init; }

    public List<string> Arguments { get; } = [];

    public string? OriginalStepLine { get; init; }

    public List<string> OriginalArguments { get; } = [];

    public string GlobalId => StepArgumentReader.Unquote(Arguments.ElementAtOrDefault(0)) ?? string.Empty;

    public string Name
    {
        get => StepArgumentReader.Unquote(Arguments.ElementAtOrDefault(2)) ?? string.Empty;
        set
        {
            while (Arguments.Count <= 2)
            {
                Arguments.Add("$");
            }

            Arguments[2] = string.IsNullOrWhiteSpace(value) ? "$" : StepArgumentReader.Quote(value);
        }
    }

    public string Description
    {
        get => StepArgumentReader.Unquote(Arguments.ElementAtOrDefault(3)) ?? string.Empty;
        set
        {
            while (Arguments.Count <= 3)
            {
                Arguments.Add("$");
            }

            Arguments[3] = string.IsNullOrWhiteSpace(value) ? "$" : StepArgumentReader.Quote(value);
        }
    }

    public string DisplayName
    {
        get
        {
            var name = Name;
            return string.IsNullOrWhiteSpace(name) ? $"#{Id}" : $"{name} #{Id}";
        }
    }

    public string ToStepLine()
    {
        return IFCnative.NativeWindows.Services.IfcStepWriter.SerializeEntity(this);
    }
}
