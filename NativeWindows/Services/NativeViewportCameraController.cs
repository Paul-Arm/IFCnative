namespace IFCnative.NativeWindows.Services;

public sealed record NativeViewportCameraState(
    IfcPreviewVertex Target,
    double Distance,
    double YawDegrees,
    double PitchDegrees,
    double SceneRadius,
    double FieldOfViewDegrees = 45,
    double NearPlane = 0.01,
    double FarPlane = 1000.0)
{
    public NativeViewportCameraPose ToPose()
    {
        var direction = NativeViewportCameraController.DirectionFromYawPitch(YawDegrees, PitchDegrees);
        var position = NativeViewportCameraController.Add(Target, NativeViewportCameraController.Scale(direction, Distance));
        return new NativeViewportCameraPose(
            position,
            NativeViewportCameraController.Scale(direction, -Distance),
            NativeViewportCameraController.UnitZ,
            FieldOfViewDegrees,
            NearPlane,
            FarPlane);
    }
}

public sealed record NativeViewportCameraPose(
    IfcPreviewVertex Position,
    IfcPreviewVertex LookDirection,
    IfcPreviewVertex UpDirection,
    double FieldOfViewDegrees,
    double NearPlaneDistance,
    double FarPlaneDistance);

public readonly record struct NativeViewportCameraClipping(double NearPlane, double FarPlane);

public static class NativeViewportCameraController
{
    public static IfcPreviewVertex UnitZ { get; } = new(0, 0, 1);

    public static NativeViewportCameraState FitMeshes(IReadOnlyList<IfcPreviewMesh> meshes)
    {
        var vertices = meshes
            .SelectMany(mesh => mesh.Vertices)
            .Where(IsFinite)
            .ToList();
        if (vertices.Count == 0)
        {
            return DefaultState();
        }

        var minX = vertices.Min(vertex => vertex.X);
        var maxX = vertices.Max(vertex => vertex.X);
        var minY = vertices.Min(vertex => vertex.Y);
        var maxY = vertices.Max(vertex => vertex.Y);
        var minZ = vertices.Min(vertex => vertex.Z);
        var maxZ = vertices.Max(vertex => vertex.Z);
        var target = new IfcPreviewVertex((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
        var radius = Math.Sqrt(
            Math.Pow(maxX - minX, 2) +
            Math.Pow(maxY - minY, 2) +
            Math.Pow(maxZ - minZ, 2)) / 2;
        if (!IsPositiveFinite(radius))
        {
            radius = 0.5;
        }

        return new NativeViewportCameraState(target, Math.Max(4, radius * 3.2), DefaultYawDegrees, DefaultPitchDegrees, radius);
    }

    public static NativeViewportCameraState FitScene(IfcRenderScene scene)
    {
        if (scene.IsEmpty)
        {
            return DefaultState();
        }

        return FitBounds(scene.Bounds, DefaultYawDegrees, DefaultPitchDegrees);
    }

    public static NativeViewportCameraState FitBounds(IfcRenderBounds bounds, double yawDegrees, double pitchDegrees)
    {
        if (bounds.IsEmpty)
        {
            return DefaultState();
        }

        var radius = bounds.Radius;
        return new NativeViewportCameraState(
            bounds.Center,
            Math.Max(0.25, radius * 3.2),
            NormalizeDegrees(yawDegrees),
            Math.Clamp(pitchDegrees, -80, 80),
            Math.Max(0.1, radius));
    }

    public static NativeViewportCameraState DefaultState()
    {
        return new NativeViewportCameraState(new IfcPreviewVertex(0, 0, 0.45), 8, DefaultYawDegrees, DefaultPitchDegrees, 1);
    }

    public static NativeViewportCameraState Orbit(NativeViewportCameraState state, double deltaX, double deltaY)
    {
        return state with
        {
            YawDegrees = NormalizeDegrees(state.YawDegrees - deltaX * 0.35),
            PitchDegrees = Math.Clamp(state.PitchDegrees + deltaY * 0.25, -80, 80),
        };
    }

    public static NativeViewportCameraState Zoom(NativeViewportCameraState state, int wheelDelta)
    {
        var notches = wheelDelta / 120.0;
        var distance = state.Distance * Math.Pow(0.85, notches);
        return state with { Distance = ClampDistance(state, distance) };
    }

    public static NativeViewportCameraState Dolly(NativeViewportCameraState state, double deltaPixels)
    {
        var distance = state.Distance * Math.Pow(1.01, deltaPixels);
        return state with { Distance = ClampDistance(state, distance) };
    }

    public static NativeViewportCameraState Pan(NativeViewportCameraState state, double deltaX, double deltaY, double viewportWidth, double viewportHeight)
    {
        var pose = state.ToPose();
        var look = Normalize(pose.LookDirection);
        var right = Normalize(Cross(look, UnitZ));
        if (!IsFinite(right) || Length(right) == 0)
        {
            right = new IfcPreviewVertex(1, 0, 0);
        }

        var up = Normalize(Cross(right, look));
        var visibleHeight = 2d * state.Distance * Math.Tan(DegreesToRadians(state.FieldOfViewDegrees) / 2d);
        var worldPerPixel = visibleHeight / Math.Max(1, viewportHeight);
        var offset = Add(Scale(right, -deltaX * worldPerPixel), Scale(up, deltaY * worldPerPixel));
        return state with { Target = Add(state.Target, offset) };
    }

    public static NativeViewportCameraClipping FitClippingPlanes(
        NativeViewportCameraState state,
        IfcRenderBounds bounds,
        double requestedNearPlane,
        double requestedFarPlane)
    {
        var nearPlane = SanitizePositive(requestedNearPlane, 0.01);
        var farPlane = Math.Max(SanitizePositive(requestedFarPlane, 1000), nearPlane + 1);
        if (bounds.IsEmpty)
        {
            return new NativeViewportCameraClipping(nearPlane, farPlane);
        }

        var pose = state.ToPose();
        var look = Normalize(pose.LookDirection);
        if (!IsFinite(look) || Length(look) == 0)
        {
            return new NativeViewportCameraClipping(nearPlane, farPlane);
        }

        var minDepth = double.PositiveInfinity;
        var maxDepth = double.NegativeInfinity;
        foreach (var corner in BoundsCorners(bounds))
        {
            var depth = Dot(Subtract(corner, pose.Position), look);
            if (!IsFinite(depth))
            {
                continue;
            }

            minDepth = Math.Min(minDepth, depth);
            maxDepth = Math.Max(maxDepth, depth);
        }

        if (!IsFinite(minDepth) || !IsFinite(maxDepth))
        {
            return new NativeViewportCameraClipping(nearPlane, farPlane);
        }

        var radius = Math.Max(0.1, bounds.Radius);
        var margin = Math.Max(0.1, radius * 0.05);
        var requiredFar = Math.Max(maxDepth + margin, state.Distance + radius + margin);
        farPlane = Math.Max(farPlane, requiredFar);

        // Scale the near plane with the view distance so the near/far ratio stays
        // bounded for very large scenes; otherwise the depth buffer collapses and
        // distant geometry z-fights or disappears.
        var adaptiveNear = state.Distance * 0.0005;
        if (minDepth > margin)
        {
            // The whole scene is in front of the camera; push the near plane out
            // as far as the closest geometry allows.
            adaptiveNear = Math.Max(adaptiveNear, Math.Min(minDepth - margin, farPlane / 50_000d));
        }

        nearPlane = Math.Max(nearPlane, adaptiveNear);
        nearPlane = Math.Max(0.0001, Math.Min(nearPlane, farPlane * 0.5));
        farPlane = Math.Max(farPlane, nearPlane + 1);
        return new NativeViewportCameraClipping(nearPlane, farPlane);
    }

    public static IfcPreviewVertex DirectionFromYawPitch(double yawDegrees, double pitchDegrees)
    {
        var yaw = DegreesToRadians(yawDegrees);
        var pitch = DegreesToRadians(pitchDegrees);
        var horizontal = Math.Cos(pitch);
        return Normalize(new IfcPreviewVertex(
            horizontal * Math.Cos(yaw),
            horizontal * Math.Sin(yaw),
            Math.Sin(pitch)));
    }

    public static IfcPreviewVertex Add(IfcPreviewVertex left, IfcPreviewVertex right)
    {
        return new IfcPreviewVertex(left.X + right.X, left.Y + right.Y, left.Z + right.Z);
    }

    public static IfcPreviewVertex Scale(IfcPreviewVertex vertex, double factor)
    {
        return new IfcPreviewVertex(vertex.X * factor, vertex.Y * factor, vertex.Z * factor);
    }

    private const double DefaultYawDegrees = -51.633;
    private const double DefaultPitchDegrees = 25.2;

    private static double ClampDistance(NativeViewportCameraState state, double distance)
    {
        // Keep the minimum independent of the full scene size so large or far-away
        // (geo-referenced) models can still be inspected up close.
        var min = Math.Max(0.02, state.SceneRadius * 0.002);
        var max = Math.Max(1000, state.SceneRadius * 80);
        return Math.Clamp(distance, min, max);
    }

    private static double NormalizeDegrees(double degrees)
    {
        var normalized = degrees % 360;
        return normalized < -180
            ? normalized + 360
            : normalized > 180
                ? normalized - 360
                : normalized;
    }

    private static IfcPreviewVertex Cross(IfcPreviewVertex left, IfcPreviewVertex right)
    {
        return new IfcPreviewVertex(
            left.Y * right.Z - left.Z * right.Y,
            left.Z * right.X - left.X * right.Z,
            left.X * right.Y - left.Y * right.X);
    }

    private static IfcPreviewVertex Subtract(IfcPreviewVertex left, IfcPreviewVertex right)
    {
        return new IfcPreviewVertex(left.X - right.X, left.Y - right.Y, left.Z - right.Z);
    }

    private static double Dot(IfcPreviewVertex left, IfcPreviewVertex right)
    {
        return left.X * right.X + left.Y * right.Y + left.Z * right.Z;
    }

    private static IfcPreviewVertex Normalize(IfcPreviewVertex vertex)
    {
        var length = Length(vertex);
        return length > 0 && !double.IsNaN(length) && !double.IsInfinity(length)
            ? new IfcPreviewVertex(vertex.X / length, vertex.Y / length, vertex.Z / length)
            : new IfcPreviewVertex(0, 0, 0);
    }

    private static double Length(IfcPreviewVertex vertex)
    {
        return Math.Sqrt(vertex.X * vertex.X + vertex.Y * vertex.Y + vertex.Z * vertex.Z);
    }

    private static double DegreesToRadians(double degrees)
    {
        return degrees * Math.PI / 180;
    }

    private static bool IsPositiveFinite(double value)
    {
        return value > 0 && !double.IsNaN(value) && !double.IsInfinity(value);
    }

    private static bool IsFinite(IfcPreviewVertex vertex)
    {
        return IsFinite(vertex.X) && IsFinite(vertex.Y) && IsFinite(vertex.Z);
    }

    private static bool IsFinite(double value)
    {
        return !double.IsNaN(value) && !double.IsInfinity(value);
    }

    private static double SanitizePositive(double value, double fallback)
    {
        return value > 0 && IsFinite(value) ? value : fallback;
    }

    private static IEnumerable<IfcPreviewVertex> BoundsCorners(IfcRenderBounds bounds)
    {
        yield return new IfcPreviewVertex(bounds.MinX, bounds.MinY, bounds.MinZ);
        yield return new IfcPreviewVertex(bounds.MinX, bounds.MinY, bounds.MaxZ);
        yield return new IfcPreviewVertex(bounds.MinX, bounds.MaxY, bounds.MinZ);
        yield return new IfcPreviewVertex(bounds.MinX, bounds.MaxY, bounds.MaxZ);
        yield return new IfcPreviewVertex(bounds.MaxX, bounds.MinY, bounds.MinZ);
        yield return new IfcPreviewVertex(bounds.MaxX, bounds.MinY, bounds.MaxZ);
        yield return new IfcPreviewVertex(bounds.MaxX, bounds.MaxY, bounds.MinZ);
        yield return new IfcPreviewVertex(bounds.MaxX, bounds.MaxY, bounds.MaxZ);
    }
}
