namespace IFCnative.NativeWindows.Models;

public sealed class IfcPropertySet
{
    public required int Id { get; init; }

    public required string Kind { get; init; }

    public required string Name { get; init; }

    public List<IfcPropertyValue> Values { get; } = [];

    public string Label => $"#{Id} {Kind} {Name}";
}

public sealed class IfcPropertyValue
{
    public required int Id { get; init; }

    public required string Type { get; init; }

    public required string Name { get; init; }

    public required string Value { get; init; }

    /// <summary>Measure type of the stored value (e.g. IfcLabel, IfcReal); empty for quantities.</summary>
    public string ValueType { get; init; } = string.Empty;

    public string Label => string.IsNullOrWhiteSpace(Value)
        ? $"#{Id} {Type} {Name}"
        : $"#{Id} {Type} {Name}: {Value}";
}
