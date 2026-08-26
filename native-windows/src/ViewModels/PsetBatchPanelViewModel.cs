using System.Collections.ObjectModel;
using System.Reactive;
using Avalonia.Threading;
using IFCnative.NativeWindows.Models;
using IFCnative.NativeWindows.Services;
using ReactiveUI;

namespace IFCnative.NativeWindows.ViewModels;

/// <summary>Measure types offered when adding a property or changing its data type.</summary>
internal static class PsetValueTypes
{
    public static readonly IReadOnlyList<string> Common =
    [
        "IfcLabel",
        "IfcText",
        "IfcIdentifier",
        "IfcBoolean",
        "IfcLogical",
        "IfcInteger",
        "IfcReal",
        "IfcLengthMeasure",
        "IfcAreaMeasure",
        "IfcVolumeMeasure",
        "IfcCountMeasure",
        "IfcMassMeasure",
        "IfcTimeMeasure",
        "IfcPlaneAngleMeasure",
        "IfcThermodynamicTemperatureMeasure",
    ];
}

/// <summary>
/// Read/write batch editor for property sets across the current multi-selection.
/// Groups the selected objects' Psets by name; each group renders as a table
/// (rows = properties, columns = objects) where every cell can be edited. Mirrors
/// the React PsetBatchPanel.
/// </summary>
public sealed class PsetBatchPanelViewModel : ReactiveViewModel
{
    private readonly MainWindowViewModel owner;
    private IfcDocument? document;
    private IReadOnlyList<int> selectedIds = [];
    private string newPsetName = string.Empty;
    private string summary = "Select one or more objects in the tree (Ctrl/Shift-click).";
    private bool hasSelection;

    public PsetBatchPanelViewModel(MainWindowViewModel owner)
    {
        this.owner = owner;
        AddEmptyPsetCommand = ReactiveCommand.Create(AddEmptyPset);
    }

    public ObservableCollection<PsetBatchBlockViewModel> Blocks { get; } = [];

    public ReactiveCommand<Unit, Unit> AddEmptyPsetCommand { get; }

    public string NewPsetName
    {
        get => newPsetName;
        set => this.RaiseAndSetIfChanged(ref newPsetName, value);
    }

    public string Summary
    {
        get => summary;
        private set => this.RaiseAndSetIfChanged(ref summary, value);
    }

    public bool HasSelection
    {
        get => hasSelection;
        private set => this.RaiseAndSetIfChanged(ref hasSelection, value);
    }

    public void SetSelection(IfcDocument document, IReadOnlyList<int> entityIds)
    {
        this.document = document;
        selectedIds = entityIds.ToList();
        Rebuild();
    }

    internal void CommitCell(PsetBatchCellViewModel cell)
    {
        owner.EditBatchPropertyCell(cell.EntityId, cell.SetId, cell.PropertyId, cell.PropertyName, cell.ValueDraft, cell.ValueType);
    }

    internal void AddPropertyToBlock(PsetBatchBlockViewModel block)
    {
        owner.AddPropertyToBatchBlock(block.Name, block.NewPropertyName, block.NewPropertyValue, block.NewPropertyType);
    }

    internal void RetypeProperties(IReadOnlyList<int> propertyIds, string valueType)
    {
        if (propertyIds.Count > 0)
        {
            owner.RetypeProperties(propertyIds, valueType);
        }
    }

    internal void EditPropertyRow(IReadOnlyList<int> propertyIds, string? newName, string? valueType)
    {
        if (propertyIds.Count > 0)
        {
            owner.EditPropertyRow(propertyIds, newName, valueType);
        }
    }

    internal void DeletePropertyCells(IReadOnlyList<(int SetId, int PropertyId)> cells)
    {
        if (cells.Count > 0)
        {
            owner.DeleteBatchProperties(cells);
        }
    }

    internal void DeletePsetColumns(IReadOnlyList<(int EntityId, int SetId)> columns)
    {
        if (columns.Count > 0)
        {
            owner.DeleteBatchPset(columns);
        }
    }

    private void AddEmptyPset()
    {
        var name = NewPsetName.Trim();
        if (name.Length == 0)
        {
            return;
        }

        owner.AddPsetToBatchSelection(name);
        NewPsetName = string.Empty;
    }

    private void Rebuild()
    {
        var count = selectedIds.Count;
        HasSelection = count > 0;

        var blocks = BuildBlocks();
        MainWindowViewModel.ReplaceItems(Blocks, blocks);

        Summary = count == 0
            ? "Select one or more objects in the tree (Ctrl/Shift-click)."
            : $"{count:N0} object(s) · {blocks.Count:N0} Pset(s)";
    }

    private List<PsetBatchBlockViewModel> BuildBlocks()
    {
        if (document is null || selectedIds.Count == 0)
        {
            return [];
        }

        // Aggregate every selected object's sets by normalized name, preserving
        // first-seen order, then sort the result alphabetically (like React).
        var groups = new Dictionary<string, BlockAccumulator>(StringComparer.Ordinal);

        foreach (var entityId in selectedIds)
        {
            if (!document.PropertySetsByEntity.TryGetValue(entityId, out var sets))
            {
                continue;
            }

            foreach (var set in sets)
            {
                var displayName = set.Name?.Trim() ?? string.Empty;
                var key = displayName.ToLowerInvariant();
                if (key.Length == 0)
                {
                    continue;
                }

                if (!groups.TryGetValue(key, out var block))
                {
                    block = new BlockAccumulator(displayName, set.Kind);
                    groups[key] = block;
                }

                block.Columns.TryAdd(entityId, set.Id);

                foreach (var value in set.Values)
                {
                    if (string.IsNullOrWhiteSpace(value.Name))
                    {
                        continue;
                    }

                    if (!block.Properties.TryGetValue(value.Name, out var property))
                    {
                        property = new PropertyAccumulator();
                        block.Properties[value.Name] = property;
                    }

                    property.Cells[entityId] = new CellData(value.Id, value.Value ?? string.Empty);
                    if (property.ValueType.Length == 0 && !string.IsNullOrWhiteSpace(value.ValueType))
                    {
                        property.ValueType = value.ValueType;
                    }
                }
            }
        }

        return groups.Values
            .OrderBy(block => block.Name, StringComparer.OrdinalIgnoreCase)
            .Select(BuildBlock)
            .ToList();
    }

    private PsetBatchBlockViewModel BuildBlock(BlockAccumulator block)
    {
        var columns = block.Columns
            .Select(pair =>
            {
                var entity = document!.EntityById.GetValueOrDefault(pair.Key);
                return new PsetBatchColumnViewModel(
                    pair.Key,
                    pair.Value,
                    entity?.DisplayName ?? $"#{pair.Key}",
                    $"#{pair.Key} · {entity?.TypeName() ?? string.Empty}");
            })
            .ToList();

        var properties = block.Properties
            .OrderBy(pair => pair.Key, StringComparer.OrdinalIgnoreCase)
            .Select(pair =>
            {
                var propertyName = pair.Key;
                var accumulator = pair.Value;
                var valueType = accumulator.ValueType.Length == 0 ? "IfcLabel" : accumulator.ValueType;
                var isQuantity = !string.Equals(block.Kind, "Pset", StringComparison.OrdinalIgnoreCase);
                var cells = columns.Select(column =>
                {
                    var present = accumulator.Cells.TryGetValue(column.EntityId, out var cellData);
                    return new PsetBatchCellViewModel(
                        this,
                        column.EntityId,
                        column.SetId,
                        present ? cellData.PropertyId : null,
                        propertyName,
                        valueType,
                        present ? cellData.Value : string.Empty,
                        isQuantity);
                }).ToList();

                var distinct = cells.Select(cell => cell.OriginalValue).Distinct(StringComparer.Ordinal).Count() > 1;
                foreach (var cell in cells)
                {
                    cell.IsDistinct = distinct;
                }

                return new PsetBatchPropertyViewModel(this, propertyName, cells);
            })
            .ToList();

        return new PsetBatchBlockViewModel(this, block.Name, block.Kind, columns.Count, selectedIds.Count, columns, properties);
    }

    private sealed class BlockAccumulator(string name, string kind)
    {
        public string Name { get; } = name;

        public string Kind { get; } = kind;

        // entity id -> owning set id
        public Dictionary<int, int> Columns { get; } = [];

        // property name -> per-object cell data
        public Dictionary<string, PropertyAccumulator> Properties { get; } = new(StringComparer.Ordinal);
    }

    private sealed class PropertyAccumulator
    {
        public Dictionary<int, CellData> Cells { get; } = [];

        public string ValueType { get; set; } = string.Empty;
    }

    private readonly record struct CellData(int PropertyId, string Value);
}

public sealed class PsetBatchBlockViewModel : ReactiveViewModel
{
    private readonly PsetBatchPanelViewModel owner;
    private string newPropertyName = string.Empty;
    private string newPropertyValue = string.Empty;
    private string newPropertyType = "IfcLabel";

    public PsetBatchBlockViewModel(
        PsetBatchPanelViewModel owner,
        string name,
        string kind,
        int columnCount,
        int selectionCount,
        IReadOnlyList<PsetBatchColumnViewModel> columns,
        IReadOnlyList<PsetBatchPropertyViewModel> properties)
    {
        this.owner = owner;
        Name = name;
        Columns = columns;
        Properties = properties;
        Coverage = $"{columnCount}/{selectionCount}";
        IsPartial = columnCount < selectionCount;
        HasProperties = properties.Count > 0;
        // Only true property sets (not quantity sets) accept a new IfcProperty.
        CanAddProperty = string.Equals(kind, "Pset", StringComparison.OrdinalIgnoreCase);
        // Defer: committing rebuilds the panel, tearing down this button's visual
        // tree while its click is still being dispatched.
        AddPropertyCommand = ReactiveCommand.Create(
            () => Dispatcher.UIThread.Post(() => owner.AddPropertyToBlock(this), DispatcherPriority.Background));
    }

    public string Name { get; }

    public string Coverage { get; }

    public bool IsPartial { get; }

    public bool HasProperties { get; }

    public bool CanAddProperty { get; }

    public IReadOnlyList<string> ValueTypeOptions => PsetValueTypes.Common;

    public string NewPropertyName
    {
        get => newPropertyName;
        set => this.RaiseAndSetIfChanged(ref newPropertyName, value);
    }

    public string NewPropertyValue
    {
        get => newPropertyValue;
        set => this.RaiseAndSetIfChanged(ref newPropertyValue, value);
    }

    public string NewPropertyType
    {
        get => newPropertyType;
        set => this.RaiseAndSetIfChanged(ref newPropertyType, value ?? "IfcLabel");
    }

    public ReactiveCommand<Unit, Unit> AddPropertyCommand { get; }

    public IReadOnlyList<PsetBatchColumnViewModel> Columns { get; }

    public IReadOnlyList<PsetBatchPropertyViewModel> Properties { get; }

    /// <summary>Header right-click "delete": detaches this Pset from every selected object carrying it.</summary>
    public void DeleteFromSelection()
    {
        owner.DeletePsetColumns(Columns.Select(column => (column.EntityId, column.SetId)).ToList());
    }
}

public sealed record PsetBatchColumnViewModel(int EntityId, int SetId, string Label, string Title);

public sealed class PsetBatchPropertyViewModel(
    PsetBatchPanelViewModel owner,
    string name,
    IReadOnlyList<PsetBatchCellViewModel> cells)
{
    public string Name { get; } = name;

    public IReadOnlyList<PsetBatchCellViewModel> Cells { get; } = cells;

    /// <summary>The measure type shared by the row (first non-empty cell type).</summary>
    public string CurrentType =>
        Cells.Select(cell => cell.ValueType).FirstOrDefault(type => !string.IsNullOrWhiteSpace(type)) ?? "IfcLabel";

    /// <summary>
    /// Applies a right-click row edit: renames and/or retypes every existing
    /// property of the row in one transaction. Cells that have no property yet
    /// only remember the type for their next value entry.
    /// </summary>
    public void ApplyRowEdit(string newName, string? newType)
    {
        var nameChanged = !string.IsNullOrWhiteSpace(newName) && !string.Equals(newName.Trim(), Name, StringComparison.Ordinal);
        var typeChanged = !string.IsNullOrWhiteSpace(newType) && !string.Equals(newType, CurrentType, StringComparison.OrdinalIgnoreCase);
        if (!nameChanged && !typeChanged)
        {
            return;
        }

        if (typeChanged)
        {
            foreach (var cell in Cells.Where(cell => cell.PropertyId is null))
            {
                cell.ValueType = newType!;
            }
        }

        var propertyIds = Cells
            .Where(cell => cell.PropertyId is not null)
            .Select(cell => cell.PropertyId!.Value)
            .Distinct()
            .ToList();
        if (propertyIds.Count == 0)
        {
            return;
        }

        owner.EditPropertyRow(propertyIds, nameChanged ? newName.Trim() : Name, typeChanged ? newType : null);
    }

    /// <summary>Right-click "delete row": removes the property from every selected object.</summary>
    public void DeleteRow()
    {
        var cells = Cells
            .Where(cell => cell.PropertyId is not null)
            .Select(cell => (cell.SetId, cell.PropertyId!.Value))
            .Distinct()
            .ToList();
        owner.DeletePropertyCells(cells);
    }
}

public sealed class PsetBatchCellViewModel : ReactiveViewModel
{
    private readonly PsetBatchPanelViewModel owner;
    private string valueDraft;
    private bool isDistinct;
    private bool saved;

    public PsetBatchCellViewModel(
        PsetBatchPanelViewModel owner,
        int entityId,
        int setId,
        int? propertyId,
        string propertyName,
        string valueType,
        string value,
        bool isQuantity = false)
    {
        this.owner = owner;
        EntityId = entityId;
        SetId = setId;
        PropertyId = propertyId;
        PropertyName = propertyName;
        ValueType = valueType;
        OriginalValue = value;
        valueDraft = value;
        IsQuantity = isQuantity;
    }

    public int EntityId { get; }

    public int SetId { get; }

    public int? PropertyId { get; }

    public string PropertyName { get; }

    /// <summary>Quantity (Qto) cells have no measure type to change.</summary>
    public bool IsQuantity { get; }

    /// <summary>
    /// Measure type used when this cell's value is first written. For cells that
    /// already have a property this only matters until the next refresh.
    /// </summary>
    public string ValueType { get; set; }

    public string OriginalValue { get; }

    public string ValueDraft
    {
        get => valueDraft;
        set => this.RaiseAndSetIfChanged(ref valueDraft, value);
    }

    public bool IsDistinct
    {
        get => isDistinct;
        set => this.RaiseAndSetIfChanged(ref isDistinct, value);
    }

    /// <summary>
    /// Auto-save entry point (Enter / focus loss): commits at most once and only
    /// when the value actually changed — the commit rebuilds the panel, which
    /// would otherwise re-fire focus-loss events on stale controls.
    /// </summary>
    public void SaveIfChanged()
    {
        if (saved || string.Equals(valueDraft, OriginalValue, StringComparison.Ordinal))
        {
            return;
        }

        saved = true;
        owner.CommitCell(this);
    }

    /// <summary>
    /// Right-click "set value type": retypes the existing property in place, or —
    /// when the object does not yet own the property — remembers the type for the
    /// next value entry.
    /// </summary>
    public void SetType(string valueType)
    {
        if (PropertyId is int propertyId)
        {
            owner.RetypeProperties([propertyId], valueType);
        }
        else
        {
            ValueType = valueType;
        }
    }

    /// <summary>Right-click "delete": removes this object's property from its set.</summary>
    public void DeleteProperty()
    {
        if (PropertyId is int propertyId)
        {
            owner.DeletePropertyCells([(SetId, propertyId)]);
        }
    }
}
