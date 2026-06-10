namespace IFCnative.NativeWindows.Services;

public sealed record IfcRenderScene(
    string Label,
    IReadOnlyList<IfcRenderMesh> Meshes,
    IfcRenderBounds Bounds,
    int ShapeInstanceCount,
    int TriangleCount,
    string Status,
    IReadOnlyDictionary<int, IfcPreviewVertex>? ProductPlacements = null)
{
    public bool IsEmpty => Meshes.Count == 0 || TriangleCount == 0 || Bounds.IsEmpty;

    public static IfcRenderScene Empty(string status = "No xBIM render geometry.")
    {
        return new IfcRenderScene("Empty", [], IfcRenderBounds.Empty, 0, 0, status);
    }
}

public static class IfcRenderSceneTransform
{
    /// <summary>
    /// Applies a committed move/rotate of a single product to an existing render
    /// scene without re-tessellating the model. The rotation pivot matches the
    /// STEP edit semantics: world Z through the product's placement origin.
    /// </summary>
    public static IfcRenderScene TransformProduct(
        IfcRenderScene scene,
        int productId,
        double moveDeltaX,
        double moveDeltaY,
        double moveDeltaZ,
        double rotateZRadians)
    {
        var hasMove = Math.Abs(moveDeltaX) > 1e-9 || Math.Abs(moveDeltaY) > 1e-9 || Math.Abs(moveDeltaZ) > 1e-9;
        var hasRotation = Math.Abs(rotateZRadians) > 1e-9;
        if (scene.IsEmpty || productId <= 0 || (!hasMove && !hasRotation))
        {
            return scene;
        }

        var pivot = ResolvePivot(scene, productId);
        var cos = Math.Cos(rotateZRadians);
        var sin = Math.Sin(rotateZRadians);
        var meshes = new List<IfcRenderMesh>(scene.Meshes.Count);
        var bounds = IfcRenderBounds.Empty;
        var changed = false;
        foreach (var mesh in scene.Meshes)
        {
            var next = mesh;
            if (mesh.ProductId == productId && mesh.Vertices.Count > 0)
            {
                var vertices = new List<IfcRenderVertex>(mesh.Vertices.Count);
                foreach (var vertex in mesh.Vertices)
                {
                    vertices.Add(TransformVertex(vertex, pivot, cos, sin, hasRotation, moveDeltaX, moveDeltaY, moveDeltaZ));
                }

                next = mesh with { Vertices = vertices };
                changed = true;
            }

            meshes.Add(next);
            foreach (var vertex in next.Vertices)
            {
                bounds = bounds.Include(vertex.X, vertex.Y, vertex.Z);
            }
        }

        if (!changed)
        {
            return scene;
        }

        var placements = scene.ProductPlacements;
        if (placements is not null && placements.TryGetValue(productId, out var origin))
        {
            var updated = new Dictionary<int, IfcPreviewVertex>(placements.Count);
            foreach (var pair in placements)
            {
                updated[pair.Key] = pair.Value;
            }

            updated[productId] = new IfcPreviewVertex(origin.X + moveDeltaX, origin.Y + moveDeltaY, origin.Z + moveDeltaZ);
            placements = updated;
        }

        return scene with { Meshes = meshes, Bounds = bounds, ProductPlacements = placements };
    }

    private static IfcPreviewVertex ResolvePivot(IfcRenderScene scene, int productId)
    {
        if (scene.ProductPlacements is not null
            && scene.ProductPlacements.TryGetValue(productId, out var origin)
            && double.IsFinite(origin.X) && double.IsFinite(origin.Y) && double.IsFinite(origin.Z))
        {
            return origin;
        }

        var bounds = IfcRenderBounds.Empty;
        foreach (var mesh in scene.Meshes)
        {
            if (mesh.ProductId != productId)
            {
                continue;
            }

            foreach (var vertex in mesh.Vertices)
            {
                bounds = bounds.Include(vertex.X, vertex.Y, vertex.Z);
            }
        }

        return bounds.Center;
    }

    private static IfcRenderVertex TransformVertex(
        IfcRenderVertex vertex,
        IfcPreviewVertex pivot,
        double cos,
        double sin,
        bool hasRotation,
        double moveDeltaX,
        double moveDeltaY,
        double moveDeltaZ)
    {
        var x = vertex.X;
        var y = vertex.Y;
        var normalX = vertex.NormalX;
        var normalY = vertex.NormalY;
        if (hasRotation)
        {
            var localX = vertex.X - pivot.X;
            var localY = vertex.Y - pivot.Y;
            x = pivot.X + localX * cos - localY * sin;
            y = pivot.Y + localX * sin + localY * cos;
            normalX = (float)(vertex.NormalX * cos - vertex.NormalY * sin);
            normalY = (float)(vertex.NormalX * sin + vertex.NormalY * cos);
        }

        return new IfcRenderVertex(
            x + moveDeltaX,
            y + moveDeltaY,
            vertex.Z + moveDeltaZ,
            normalX,
            normalY,
            vertex.NormalZ);
    }
}

public sealed record IfcRenderMesh(
    int ProductId,
    int ShapeGeometryId,
    int StyleId,
    int IfcTypeId,
    IfcRenderColor Color,
    IReadOnlyList<IfcRenderVertex> Vertices,
    IReadOnlyList<int> Indices,
    bool IsSpace = false)
{
    public bool IsRenderable => ProductId > 0 && Vertices.Count > 0 && Indices.Count >= 3;
}

public readonly record struct IfcRenderVertex(
    double X,
    double Y,
    double Z,
    float NormalX,
    float NormalY,
    float NormalZ);

public readonly record struct IfcRenderColor(float R, float G, float B, float A)
{
    public static IfcRenderColor Default { get; } = new(0.66f, 0.74f, 0.68f, 1f);
}

public readonly record struct IfcRenderBounds(
    double MinX,
    double MinY,
    double MinZ,
    double MaxX,
    double MaxY,
    double MaxZ)
{
    public static IfcRenderBounds Empty { get; } = new(
        double.PositiveInfinity,
        double.PositiveInfinity,
        double.PositiveInfinity,
        double.NegativeInfinity,
        double.NegativeInfinity,
        double.NegativeInfinity);

    public bool IsEmpty => !IsFinite(MinX) || !IsFinite(MinY) || !IsFinite(MinZ)
        || !IsFinite(MaxX) || !IsFinite(MaxY) || !IsFinite(MaxZ)
        || MinX > MaxX || MinY > MaxY || MinZ > MaxZ;

    public IfcPreviewVertex Center => IsEmpty
        ? new IfcPreviewVertex(0, 0, 0)
        : new IfcPreviewVertex((MinX + MaxX) / 2d, (MinY + MaxY) / 2d, (MinZ + MaxZ) / 2d);

    public double Radius
    {
        get
        {
            if (IsEmpty)
            {
                return 1;
            }

            var x = MaxX - MinX;
            var y = MaxY - MinY;
            var z = MaxZ - MinZ;
            var radius = Math.Sqrt(x * x + y * y + z * z) / 2d;
            return radius > 0 && double.IsFinite(radius) ? radius : 1;
        }
    }

    public IfcRenderBounds Include(double x, double y, double z)
    {
        if (!IsFinite(x) || !IsFinite(y) || !IsFinite(z))
        {
            return this;
        }

        return new IfcRenderBounds(
            Math.Min(MinX, x),
            Math.Min(MinY, y),
            Math.Min(MinZ, z),
            Math.Max(MaxX, x),
            Math.Max(MaxY, y),
            Math.Max(MaxZ, z));
    }

    private static bool IsFinite(double value)
    {
        return !double.IsNaN(value) && !double.IsInfinity(value);
    }
}

public static class IfcRenderPicking
{
    public static IfcRenderColor EncodeProductId(int productId)
    {
        var clamped = Math.Clamp(productId, 0, 0x00FFFFFF);
        return new IfcRenderColor(
            ((clamped >> 16) & 0xFF) / 255f,
            ((clamped >> 8) & 0xFF) / 255f,
            (clamped & 0xFF) / 255f,
            1f);
    }

    public static int DecodeProductId(byte red, byte green, byte blue)
    {
        return (red << 16) | (green << 8) | blue;
    }
}
