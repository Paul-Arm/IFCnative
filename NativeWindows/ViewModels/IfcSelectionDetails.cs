using IFCnative.NativeWindows.Models;

namespace IFCnative.NativeWindows.ViewModels;

public sealed record IfcSelectionDetails(
    IfcEntity Entity,
    string SpatialPath,
    IReadOnlyList<string> IncomingReferences,
    IReadOnlyList<string> Relationships,
    IReadOnlyList<string> Representations,
    IReadOnlyList<string> PropertySets,
    IReadOnlyList<string> TypeAssignments,
    IReadOnlyList<string> Resources,
    IReadOnlyList<string> Units);
