namespace IFCnative.NativeWindows.ViewModels;

public sealed record IfcPropertySetTableDetails(
    int Id,
    string Kind,
    string Name,
    IReadOnlyList<IfcPropertyTableRowDetails> Rows)
{
    public string Meta => $"#{Id} / {Rows.Count:N0} value(s)";
}

public sealed record IfcPropertyTableRowDetails(
    int? EntityId,
    string Name,
    string Type,
    string Value,
    bool CanEdit,
    string ValueType = "")
{
    public string StepId => EntityId is null ? "-" : $"#{EntityId}";

    /// <summary>The measure type is only switchable on IfcPropertySingleValue.</summary>
    public bool CanEditValueType => CanEdit && Type == "IFCPROPERTYSINGLEVALUE";

    public IfcPropertyDetails ToPropertyDetails()
    {
        var label = string.IsNullOrWhiteSpace(Value)
            ? $"{StepId} {Type} {Name}"
            : $"{StepId} {Type} {Name}: {Value}";
        return new IfcPropertyDetails(EntityId, label, Value, CanEdit);
    }
}
