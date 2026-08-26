using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Media;

namespace IFCnative.NativeWindows.Views;

public sealed class NavCubeViewRequestedEventArgs(double? yawDegrees, double pitchDegrees) : EventArgs
{
    /// <summary>Target yaw, or null to keep the current yaw (top/bottom views).</summary>
    public double? YawDegrees { get; } = yawDegrees;

    public double PitchDegrees { get; } = pitchDegrees;
}

public sealed class NavCubeOrbitEventArgs(double deltaX, double deltaY) : EventArgs
{
    public double DeltaX { get; } = deltaX;

    public double DeltaY { get; } = deltaY;
}

/// <summary>
/// Blender/CAD-style navigation cube drawn as an Avalonia overlay: it rotates
/// with the camera, clicking a face orients the view, dragging orbits.
/// Rendering happens entirely on the UI thread, so labels and hover styling are
/// regular 2D drawing instead of GL work.
/// </summary>
public sealed class ViewportNavCubeControl : Control
{
    public static readonly StyledProperty<double> YawDegreesProperty =
        AvaloniaProperty.Register<ViewportNavCubeControl, double>(nameof(YawDegrees), -51.633);

    public static readonly StyledProperty<double> PitchDegreesProperty =
        AvaloniaProperty.Register<ViewportNavCubeControl, double>(nameof(PitchDegrees), 25.2);

    private static readonly Typeface LabelTypeface = new("Segoe UI", FontStyle.Normal, FontWeight.SemiBold);

    private sealed record CubeFace(
        string Label,
        Vector3D Normal,
        Vector3D[] Corners,
        double? TargetYawDegrees,
        double TargetPitchDegrees);

    private readonly record struct Vector3D(double X, double Y, double Z);

    private sealed record ProjectedFace(CubeFace Face, Point[] Points, double Facing, Point Center);

    private static readonly CubeFace[] Faces = BuildFaces();

    private List<ProjectedFace> visibleFaces = [];
    private CubeFace? hoverFace;
    private Point? pressPoint;
    private Point? lastDragPoint;
    private bool dragging;

    static ViewportNavCubeControl()
    {
        AffectsRender<ViewportNavCubeControl>(YawDegreesProperty, PitchDegreesProperty);
    }

    public ViewportNavCubeControl()
    {
        ClipToBounds = false;
    }

    public double YawDegrees
    {
        get => GetValue(YawDegreesProperty);
        set => SetValue(YawDegreesProperty, value);
    }

    public double PitchDegrees
    {
        get => GetValue(PitchDegreesProperty);
        set => SetValue(PitchDegreesProperty, value);
    }

    public event EventHandler<NavCubeViewRequestedEventArgs>? ViewRequested;

    public event EventHandler<NavCubeOrbitEventArgs>? OrbitRequested;

    public override void Render(DrawingContext context)
    {
        base.Render(context);
        var width = Bounds.Width;
        var height = Bounds.Height;
        if (width < 8 || height < 8)
        {
            return;
        }

        var center = new Point(width / 2d, height / 2d);
        var scale = Math.Min(width, height) * 0.30;
        var (right, up, toCamera) = CameraBasis();

        var projected = new List<ProjectedFace>(6);
        foreach (var face in Faces)
        {
            var facing = Dot(face.Normal, toCamera);
            if (facing <= 0.02)
            {
                continue;
            }

            var points = new Point[4];
            for (var i = 0; i < 4; i++)
            {
                points[i] = Project(face.Corners[i], right, up, center, scale);
            }

            var faceCenter = new Point(
                (points[0].X + points[1].X + points[2].X + points[3].X) / 4d,
                (points[0].Y + points[1].Y + points[2].Y + points[3].Y) / 4d);
            projected.Add(new ProjectedFace(face, points, facing, faceCenter));
        }

        projected.Sort((a, b) => a.Facing.CompareTo(b.Facing));
        visibleFaces = projected;

        var border = new Pen(new SolidColorBrush(Color.FromArgb(220, 0x4A, 0x55, 0x48)), 1.0);
        foreach (var face in projected)
        {
            var isHover = ReferenceEquals(face.Face, hoverFace);
            var shade = (byte)Math.Clamp(0x28 + face.Facing * 0x30, 0, 255);
            var fill = isHover
                ? new SolidColorBrush(Color.FromArgb(235, 0x2F, 0x7D, 0x68))
                : new SolidColorBrush(Color.FromArgb(215, shade, (byte)(shade + 4), shade));

            var geometry = new StreamGeometry();
            using (var geometryContext = geometry.Open())
            {
                geometryContext.BeginFigure(face.Points[0], true);
                geometryContext.LineTo(face.Points[1]);
                geometryContext.LineTo(face.Points[2]);
                geometryContext.LineTo(face.Points[3]);
                geometryContext.EndFigure(true);
            }

            context.DrawGeometry(fill, border, geometry);

            // Labels fade out at grazing angles where they would distort badly.
            var labelAlpha = Math.Clamp((face.Facing - 0.25) / 0.75, 0, 1);
            if (labelAlpha > 0.05)
            {
                var brush = new SolidColorBrush(Color.FromArgb(
                    (byte)(labelAlpha * (isHover ? 255 : 205)),
                    0xE6, 0xEA, 0xE2));
                var text = new FormattedText(
                    face.Face.Label,
                    System.Globalization.CultureInfo.InvariantCulture,
                    FlowDirection.LeftToRight,
                    LabelTypeface,
                    10.5,
                    brush);
                context.DrawText(text, new Point(face.Center.X - text.Width / 2d, face.Center.Y - text.Height / 2d));
            }
        }
    }

    protected override void OnPointerMoved(PointerEventArgs e)
    {
        base.OnPointerMoved(e);
        var position = e.GetPosition(this);
        if (pressPoint is { } pressed)
        {
            if (!dragging && (Math.Abs(position.X - pressed.X) + Math.Abs(position.Y - pressed.Y)) > 3)
            {
                dragging = true;
            }

            if (dragging && lastDragPoint is { } last)
            {
                OrbitRequested?.Invoke(this, new NavCubeOrbitEventArgs(position.X - last.X, position.Y - last.Y));
            }

            lastDragPoint = position;
            e.Handled = true;
            return;
        }

        var nextHover = HitFace(position)?.Face;
        if (!ReferenceEquals(nextHover, hoverFace))
        {
            hoverFace = nextHover;
            Cursor = hoverFace is null ? Cursor.Default : new Cursor(StandardCursorType.Hand);
            InvalidateVisual();
        }
    }

    protected override void OnPointerExited(PointerEventArgs e)
    {
        base.OnPointerExited(e);
        if (hoverFace is not null)
        {
            hoverFace = null;
            InvalidateVisual();
        }
    }

    protected override void OnPointerPressed(PointerPressedEventArgs e)
    {
        base.OnPointerPressed(e);
        if (!e.GetCurrentPoint(this).Properties.IsLeftButtonPressed)
        {
            return;
        }

        pressPoint = e.GetPosition(this);
        lastDragPoint = pressPoint;
        dragging = false;
        e.Pointer.Capture(this);
        e.Handled = true;
    }

    protected override void OnPointerReleased(PointerReleasedEventArgs e)
    {
        base.OnPointerReleased(e);
        var position = e.GetPosition(this);
        var wasDragging = dragging;
        pressPoint = null;
        lastDragPoint = null;
        dragging = false;
        e.Pointer.Capture(null);

        if (!wasDragging && HitFace(position) is { } hit)
        {
            ViewRequested?.Invoke(this, new NavCubeViewRequestedEventArgs(hit.Face.TargetYawDegrees, hit.Face.TargetPitchDegrees));
        }

        e.Handled = true;
    }

    private ProjectedFace? HitFace(Point point)
    {
        // Visible faces tile the silhouette of a convex cube, so the first
        // containing polygon is the unique hit.
        for (var i = visibleFaces.Count - 1; i >= 0; i--)
        {
            if (Contains(visibleFaces[i].Points, point))
            {
                return visibleFaces[i];
            }
        }

        return null;
    }

    private static bool Contains(Point[] polygon, Point point)
    {
        var sign = 0;
        for (var i = 0; i < polygon.Length; i++)
        {
            var a = polygon[i];
            var b = polygon[(i + 1) % polygon.Length];
            var cross = (b.X - a.X) * (point.Y - a.Y) - (b.Y - a.Y) * (point.X - a.X);
            if (Math.Abs(cross) < 0.0001)
            {
                continue;
            }

            var currentSign = cross > 0 ? 1 : -1;
            if (sign == 0)
            {
                sign = currentSign;
            }
            else if (sign != currentSign)
            {
                return false;
            }
        }

        return sign != 0;
    }

    private (Vector3D Right, Vector3D Up, Vector3D ToCamera) CameraBasis()
    {
        // Matches NativeViewportCameraController.DirectionFromYawPitch: the
        // vector from the target to the camera.
        var yaw = YawDegrees * Math.PI / 180d;
        var pitch = PitchDegrees * Math.PI / 180d;
        var horizontal = Math.Cos(pitch);
        var toCamera = new Vector3D(horizontal * Math.Cos(yaw), horizontal * Math.Sin(yaw), Math.Sin(pitch));

        // Same basis as Matrix4x4.CreateLookAt with +Z up.
        var rightVector = Normalize(Cross(new Vector3D(0, 0, 1), toCamera));
        if (Length(rightVector) < 0.0001)
        {
            rightVector = new Vector3D(1, 0, 0);
        }

        var upVector = Cross(toCamera, rightVector);
        return (rightVector, upVector, toCamera);
    }

    private static Point Project(Vector3D vertex, Vector3D right, Vector3D up, Point center, double scale)
    {
        return new Point(
            center.X + Dot(vertex, right) * scale,
            center.Y - Dot(vertex, up) * scale);
    }

    private static CubeFace[] BuildFaces()
    {
        return
        [
            new CubeFace(
                "TOP",
                new Vector3D(0, 0, 1),
                [new(-1, -1, 1), new(1, -1, 1), new(1, 1, 1), new(-1, 1, 1)],
                null,
                89),
            new CubeFace(
                "BTM",
                new Vector3D(0, 0, -1),
                [new(-1, -1, -1), new(1, -1, -1), new(1, 1, -1), new(-1, 1, -1)],
                null,
                -89),
            new CubeFace(
                "FRONT",
                new Vector3D(0, -1, 0),
                [new(-1, -1, -1), new(1, -1, -1), new(1, -1, 1), new(-1, -1, 1)],
                -90,
                0),
            new CubeFace(
                "BACK",
                new Vector3D(0, 1, 0),
                [new(-1, 1, -1), new(1, 1, -1), new(1, 1, 1), new(-1, 1, 1)],
                90,
                0),
            new CubeFace(
                "RIGHT",
                new Vector3D(1, 0, 0),
                [new(1, -1, -1), new(1, 1, -1), new(1, 1, 1), new(1, -1, 1)],
                0,
                0),
            new CubeFace(
                "LEFT",
                new Vector3D(-1, 0, 0),
                [new(-1, -1, -1), new(-1, 1, -1), new(-1, 1, 1), new(-1, -1, 1)],
                180,
                0),
        ];
    }

    private static Vector3D Cross(Vector3D left, Vector3D right)
    {
        return new Vector3D(
            left.Y * right.Z - left.Z * right.Y,
            left.Z * right.X - left.X * right.Z,
            left.X * right.Y - left.Y * right.X);
    }

    private static double Dot(Vector3D left, Vector3D right)
    {
        return left.X * right.X + left.Y * right.Y + left.Z * right.Z;
    }

    private static double Length(Vector3D vector)
    {
        return Math.Sqrt(Dot(vector, vector));
    }

    private static Vector3D Normalize(Vector3D vector)
    {
        var length = Length(vector);
        return length > 0.000001
            ? new Vector3D(vector.X / length, vector.Y / length, vector.Z / length)
            : new Vector3D(0, 0, 0);
    }
}
