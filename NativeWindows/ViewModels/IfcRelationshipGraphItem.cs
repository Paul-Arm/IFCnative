namespace IFCnative.NativeWindows.ViewModels;

public sealed record IfcRelationshipGraphItem(
    int? RelationshipId,
    int? EntityId,
    string Label,
    int Depth,
    bool IsPinnedCandidate);
