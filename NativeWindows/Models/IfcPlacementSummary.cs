namespace IFCnative.NativeWindows.Models;

public sealed class IfcPlacementSummary
{
    public required int ProductId { get; init; }

    public required int PlacementId { get; init; }

    public int? RelativeToId { get; init; }

    public required int AxisPlacementId { get; init; }

    public required int PointId { get; init; }

    public required double X { get; init; }

    public required double Y { get; init; }

    public required double Z { get; init; }

    public string Label
    {
        get
        {
            var relative = RelativeToId is null ? "world" : $"#{RelativeToId}";
            return $"Placement #{PlacementId}, axis #{AxisPlacementId}, point #{PointId}, relative to {relative}: X={X:0.###}, Y={Y:0.###}, Z={Z:0.###}";
        }
    }
}
