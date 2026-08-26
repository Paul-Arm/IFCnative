using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;

namespace IFCnative.NativeWindows.Views;

public sealed class IfcTreeIconControl : Control
{
    public static readonly StyledProperty<string> EntityTypeProperty =
        AvaloniaProperty.Register<IfcTreeIconControl, string>(nameof(EntityType), string.Empty);

    public string EntityType
    {
        get => GetValue(EntityTypeProperty);
        set => SetValue(EntityTypeProperty, value);
    }

    public override void Render(DrawingContext context)
    {
        base.Render(context);

        var bounds = Bounds;
        var scale = Math.Min(bounds.Width, bounds.Height) / 16.0;
        if (scale <= 0)
        {
            return;
        }

        using var transform = context.PushTransform(
            Matrix.CreateTranslation((bounds.Width - 16 * scale) / 2, (bounds.Height - 16 * scale) / 2)
            * Matrix.CreateScale(scale, scale));

        var kind = NormalizeKind(EntityType);
        switch (kind)
        {
            case "project":
                DrawFolder(context, Color.FromRgb(74, 169, 142), Color.FromRgb(47, 125, 104));
                DrawDot(context, Color.FromRgb(160, 220, 201));
                break;
            case "site":
                DrawFolder(context, Color.FromRgb(91, 145, 211), Color.FromRgb(52, 94, 148));
                DrawPin(context, Color.FromRgb(184, 214, 245));
                break;
            case "building":
                DrawBuilding(context, Color.FromRgb(225, 184, 92));
                break;
            case "storey":
                DrawStorey(context, Color.FromRgb(195, 151, 228));
                break;
            case "space":
                DrawSpace(context, Color.FromRgb(113, 185, 172));
                break;
            case "opening":
                DrawOpening(context, Color.FromRgb(220, 119, 101));
                break;
            default:
                DrawElement(context, Color.FromRgb(139, 160, 190));
                break;
        }
    }

    private static string NormalizeKind(string type)
    {
        var normalized = type.StartsWith("IFC", StringComparison.OrdinalIgnoreCase) ? type[3..] : type;
        return normalized.ToUpperInvariant() switch
        {
            "PROJECT" => "project",
            "SITE" => "site",
            "BUILDING" => "building",
            "BUILDINGSTOREY" => "storey",
            "SPACE" => "space",
            "OPENINGELEMENT" => "opening",
            _ => "element",
        };
    }

    private static void DrawFolder(DrawingContext context, Color accent, Color fill)
    {
        var geometry = new StreamGeometry();
        using (var stream = geometry.Open())
        {
            stream.BeginFigure(new Point(1.5, 4.5), true);
            stream.LineTo(new Point(5.3, 4.5));
            stream.LineTo(new Point(6.7, 6.2));
            stream.LineTo(new Point(14.5, 6.2));
            stream.LineTo(new Point(14.5, 13.2));
            stream.LineTo(new Point(1.5, 13.2));
            stream.EndFigure(true);
        }

        context.DrawGeometry(
            new SolidColorBrush(Color.FromArgb(38, fill.R, fill.G, fill.B)),
            new Pen(new SolidColorBrush(accent), 1.25),
            geometry);
    }

    private static void DrawBuilding(DrawingContext context, Color accent)
    {
        var pen = new Pen(new SolidColorBrush(accent), 1.25);
        var brush = new SolidColorBrush(Color.FromArgb(34, accent.R, accent.G, accent.B));
        context.DrawRectangle(brush, pen, new Rect(3, 2.5, 10, 11.5));

        for (var y = 5.0; y <= 10.5; y += 2.5)
        {
            context.DrawLine(pen, new Point(5, y), new Point(11, y));
        }

        context.DrawLine(pen, new Point(7.8, 13.8), new Point(7.8, 11.2));
    }

    private static void DrawStorey(DrawingContext context, Color accent)
    {
        var pen = new Pen(new SolidColorBrush(accent), 1.3);
        var brush = new SolidColorBrush(Color.FromArgb(32, accent.R, accent.G, accent.B));
        context.DrawRectangle(brush, pen, new Rect(3, 3, 10, 10.5));
        context.DrawLine(pen, new Point(3.3, 6), new Point(12.7, 6));
        context.DrawLine(pen, new Point(3.3, 9), new Point(12.7, 9));
    }

    private static void DrawSpace(DrawingContext context, Color accent)
    {
        var pen = new Pen(new SolidColorBrush(accent), 1.25);
        var brush = new SolidColorBrush(Color.FromArgb(28, accent.R, accent.G, accent.B));
        context.DrawRectangle(brush, pen, new Rect(3, 3, 10, 10));
        context.DrawLine(pen, new Point(5, 5), new Point(11, 11));
        context.DrawLine(pen, new Point(11, 5), new Point(5, 11));
    }

    private static void DrawOpening(DrawingContext context, Color accent)
    {
        var pen = new Pen(new SolidColorBrush(accent), 1.25);
        context.DrawRectangle(null, pen, new Rect(3, 3, 10, 10));
        context.DrawRectangle(new SolidColorBrush(Color.FromArgb(42, accent.R, accent.G, accent.B)), null, new Rect(5.5, 5.5, 5, 7.5));
    }

    private static void DrawElement(DrawingContext context, Color accent)
    {
        var pen = new Pen(new SolidColorBrush(accent), 1.25);
        var brush = new SolidColorBrush(Color.FromArgb(28, accent.R, accent.G, accent.B));

        var geometry = new StreamGeometry();
        using (var stream = geometry.Open())
        {
            stream.BeginFigure(new Point(4, 2.5), true);
            stream.LineTo(new Point(10, 2.5));
            stream.LineTo(new Point(13, 5.5));
            stream.LineTo(new Point(13, 13.5));
            stream.LineTo(new Point(4, 13.5));
            stream.EndFigure(true);
        }

        context.DrawGeometry(brush, pen, geometry);
        context.DrawLine(pen, new Point(10, 2.7), new Point(10, 5.7));
        context.DrawLine(pen, new Point(10, 5.7), new Point(12.8, 5.7));
    }

    private static void DrawDot(DrawingContext context, Color color)
    {
        context.DrawEllipse(new SolidColorBrush(color), null, new Point(8, 9.5), 1.5, 1.5);
    }

    private static void DrawPin(DrawingContext context, Color color)
    {
        var pen = new Pen(new SolidColorBrush(color), 1.1);
        context.DrawEllipse(null, pen, new Point(8, 8.5), 2.0, 2.0);
        context.DrawLine(pen, new Point(8, 10.6), new Point(8, 12.6));
    }
}
