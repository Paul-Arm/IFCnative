namespace IFCnative.NativeWindows.ViewModels;

public sealed record IfcViewportItem(
    int? EntityId,
    string Label,
    string Shape = "box",
    double CenterX = 0,
    double CenterY = 0,
    double CenterZ = 0.5,
    double Width = 1,
    double Depth = 1,
    double Height = 1)
{
    public bool HasPreviewGeometry => EntityId is not null && Width > 0 && Depth > 0 && Height > 0;
}
