namespace IFCnative.NativeWindows.Services;

public sealed record IfcRenderScene(
    string Label,
    IReadOnlyList<IfcRenderMesh> Meshes,
    IfcRenderBounds Bounds,
    int ShapeInstanceCount,
    int TriangleCount,
    string Status)
{
    public bool IsEmpty => Meshes.Count == 0 || TriangleCount == 0 || Bounds.IsEmpty;

    public static IfcRenderScene Empty(string status = "No xBIM render geometry.")
    {
        return new IfcRenderScene("Empty", [], IfcRenderBounds.Empty, 0, 0, status);
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
    float X,
    float Y,
    float Z,
    float NormalX,
    float NormalY,
    float NormalZ);

public readonly record struct IfcRenderColor(float R, float G, float B, float A)
{
    public static IfcRenderColor Default { get; } = new(0.66f, 0.74f, 0.68f, 1f);
}

public readonly record struct IfcRenderBounds(
    float MinX,
    float MinY,
    float MinZ,
    float MaxX,
    float MaxY,
    float MaxZ)
{
    public static IfcRenderBounds Empty { get; } = new(
        float.PositiveInfinity,
        float.PositiveInfinity,
        float.PositiveInfinity,
        float.NegativeInfinity,
        float.NegativeInfinity,
        float.NegativeInfinity);

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

    public IfcRenderBounds Include(float x, float y, float z)
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

    private static bool IsFinite(float value)
    {
        return !float.IsNaN(value) && !float.IsInfinity(value);
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
