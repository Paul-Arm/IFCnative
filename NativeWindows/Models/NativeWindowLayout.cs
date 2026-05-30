namespace IFCnative.NativeWindows.Models;

public sealed record NativeWindowLayout(
    bool ShowModelPane = true,
    bool ShowViewportPane = true,
    bool ShowInspectorPane = true,
    double ModelPaneWidth = 330,
    double InspectorPaneWidth = 380,
    double WindowWidth = 1440,
    double WindowHeight = 900,
    string? LastOpenedIfcPath = null,
    string? AvalonDockLayoutXml = null);
