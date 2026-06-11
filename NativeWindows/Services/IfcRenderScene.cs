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
            if (mesh.ProductId == productId && mesh.Positions.Length > 0)
            {
                var positions = new double[mesh.Positions.Length];
                var normals = hasRotation ? new float[mesh.Normals.Length] : mesh.Normals;
                var meshBounds = IfcRenderBounds.Empty;
                for (var offset = 0; offset + 2 < mesh.Positions.Length; offset += 3)
                {
                    var x = mesh.Positions[offset];
                    var y = mesh.Positions[offset + 1];
                    if (hasRotation)
                    {
                        var localX = x - pivot.X;
                        var localY = y - pivot.Y;
                        x = pivot.X + localX * cos - localY * sin;
                        y = pivot.Y + localX * sin + localY * cos;
                        var normalX = mesh.Normals[offset];
                        var normalY = mesh.Normals[offset + 1];
                        normals[offset] = (float)(normalX * cos - normalY * sin);
                        normals[offset + 1] = (float)(normalX * sin + normalY * cos);
                        normals[offset + 2] = mesh.Normals[offset + 2];
                    }

                    positions[offset] = x + moveDeltaX;
                    positions[offset + 1] = y + moveDeltaY;
                    positions[offset + 2] = mesh.Positions[offset + 2] + moveDeltaZ;
                    meshBounds = meshBounds.Include(positions[offset], positions[offset + 1], positions[offset + 2]);
                }

                next = mesh with { Positions = positions, Normals = normals, Bounds = meshBounds };
                changed = true;
            }

            meshes.Add(next);
            bounds = bounds.Include(next.Bounds);
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
            if (mesh.ProductId == productId)
            {
                bounds = bounds.Include(mesh.Bounds);
            }
        }

        return bounds.Center;
    }
}

/// <summary>
/// Triangle mesh with flat interleaved arrays: <see cref="Positions"/> holds
/// world-space xyz per vertex (double precision for large coordinates),
/// <see cref="Normals"/> the matching xyz normals. <see cref="Bounds"/> is
/// computed once at decode time so consumers never re-scan the vertices.
/// </summary>
public sealed record IfcRenderMesh(
    int ProductId,
    int ShapeGeometryId,
    int StyleId,
    int IfcTypeId,
    IfcRenderColor Color,
    double[] Positions,
    float[] Normals,
    int[] Indices,
    IfcRenderBounds Bounds,
    bool IsSpace = false)
{
    public int VertexCount => Positions.Length / 3;

    public bool IsRenderable => ProductId > 0 && Positions.Length >= 3 && Indices.Length >= 3;
}

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

    public IfcRenderBounds Include(IfcRenderBounds other)
    {
        if (other.IsEmpty)
        {
            return this;
        }

        if (IsEmpty)
        {
            return other;
        }

        return new IfcRenderBounds(
            Math.Min(MinX, other.MinX),
            Math.Min(MinY, other.MinY),
            Math.Min(MinZ, other.MinZ),
            Math.Max(MaxX, other.MaxX),
            Math.Max(MaxY, other.MaxY),
            Math.Max(MaxZ, other.MaxZ));
    }

    public static IfcRenderBounds FromPositions(double[] positions)
    {
        var bounds = Empty;
        for (var offset = 0; offset + 2 < positions.Length; offset += 3)
        {
            bounds = bounds.Include(positions[offset], positions[offset + 1], positions[offset + 2]);
        }

        return bounds;
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
