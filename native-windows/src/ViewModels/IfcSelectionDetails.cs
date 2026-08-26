using IFCnative.NativeWindows.Models;

namespace IFCnative.NativeWindows.ViewModels;

public sealed record IfcSelectionDetails(
    IfcEntity Entity,
    string SpatialPath,
    IReadOnlyList<string> IncomingReferences,
    IReadOnlyList<IfcRelationshipDetails> Relationships,
    IReadOnlyList<IfcRelationshipGraphItem> RelationshipGraph,
    IfcSpatialDetails Spatial,
    IfcPlacementDetails Placement,
    IReadOnlyList<string> Representations,
    IReadOnlyList<IfcPropertyDetails> PropertySets,
    IReadOnlyList<IfcPropertySetTableDetails> PropertySetTables,
    IReadOnlyList<string> TypeAssignments,
    IReadOnlyList<string> Resources,
    IReadOnlyList<string> Units);
