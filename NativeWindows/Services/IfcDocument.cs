using IFCnative.NativeWindows.Models;

namespace IFCnative.NativeWindows.Services;

public sealed class IfcDocument
{
    public string FileName { get; init; } = "Untitled.ifc";

    public string HeaderText { get; init; } = string.Empty;

    public string Schema { get; init; } = "UNKNOWN";

    public List<IfcEntity> Entities { get; } = [];

    public Dictionary<int, IfcEntity> EntityById { get; } = [];

    public Dictionary<string, List<IfcEntity>> EntitiesByType { get; } = new(StringComparer.OrdinalIgnoreCase);

    public Dictionary<int, List<IfcEntity>> IncomingReferences { get; } = [];

    public Dictionary<int, IfcRelationship> RelationshipById { get; } = [];

    public Dictionary<int, List<IfcRelationship>> RelationshipsByEntity { get; } = [];

    public Dictionary<int, IfcPropertySet> PropertySetById { get; } = [];

    public Dictionary<int, List<IfcPropertySet>> PropertySetsByEntity { get; } = [];

    public Dictionary<int, List<string>> ResourcesByEntity { get; } = [];

    public Dictionary<int, List<IfcTypeAssignment>> TypeAssignmentsByEntity { get; } = [];

    public Dictionary<int, IfcPlacementSummary> PlacementsByEntity { get; } = [];

    public Dictionary<int, IfcRepresentationSummary> RepresentationsByEntity { get; } = [];

    public List<string> Units { get; } = [];

    public List<IfcTreeNode> SpatialRoots { get; } = [];

    public Dictionary<int, string> SpatialPathByEntity { get; } = [];

    public IfcMemoryModel MemoryModel { get; internal set; } = IfcMemoryModel.Empty;

    public IfcDiagnostics Diagnostics { get; } = new();

    public string ToStepText()
    {
        return IfcStepWriter.Serialize(this);
    }
}

