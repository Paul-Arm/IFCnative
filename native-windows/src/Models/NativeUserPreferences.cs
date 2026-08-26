namespace IFCnative.NativeWindows.Models;

public enum AntiAliasingMode
{
    None,
    Msaa4x,
    Msaa8x,
    Fxaa
}

public sealed record NativeUserPreferences(
    double TextScale = 1.0,
    AntiAliasingMode AntiAliasing = AntiAliasingMode.None,
    bool HideSpaces = false,
    bool ShowFpsCounter = false,
    double FieldOfView = 45.0,
    double NearPlane = 0.01,
    double FarPlane = 1000.0);
