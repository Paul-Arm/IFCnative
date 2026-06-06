using IFCnative.NativeWindows.Models;

namespace IFCnative.NativeWindows.Services;

public static class NativeGeometryTransformService
{
    public static NativeGeometryTransform ResolvePrimitiveTransform(
        IfcMemoryModel model,
        IfcModelObject product,
        IfcGeometryPrimitive primitive,
        int fallbackIndex,
        int fallbackColumns)
    {
        var productTransform = product.Placement is null
            ? NativeGeometryTransform.Identity with { Origin = ResolveFallbackOrigin(fallbackIndex, fallbackColumns) }
            : ResolvePlacementTransform(model, product.Placement);
        var mappingTransform = primitive.MappedItemSourceId > 0
            ? NativeGeometryTransform.FromAxisPlacement(
                new IfcPreviewVertex(primitive.MappingX, primitive.MappingY, primitive.MappingZ),
                primitive.MappingAxis,
                primitive.MappingRefDirection,
                primitive.MappingScale)
            : NativeGeometryTransform.Identity;
        var primitiveTransform = NativeGeometryTransform.FromAxisPlacement(
            new IfcPreviewVertex(primitive.PositionX, primitive.PositionY, primitive.PositionZ),
            primitive.PositionAxis,
            primitive.PositionRefDirection);
        return productTransform.Compose(mappingTransform).Compose(primitiveTransform);
    }

    public static IfcPreviewVertex ResolvePlacementOrigin(IfcMemoryModel model, IfcModelPlacement placement)
    {
        return ResolvePlacementTransform(model, placement).Origin;
    }

    public static NativeGeometryTransform ResolvePlacementTransform(IfcMemoryModel model, IfcModelPlacement placement)
    {
        var placementsById = model.Objects
            .Select(modelObject => modelObject.Placement)
            .Where(candidate => candidate is not null)
            .Cast<IfcModelPlacement>()
            .GroupBy(candidate => candidate.SourceId)
            .ToDictionary(group => group.Key, group => group.First());

        var chain = new List<IfcModelPlacement>();
        var current = placement;
        var visited = new HashSet<int>();
        while (visited.Add(current.SourceId))
        {
            chain.Add(current);
            if (current.RelativeToSourceId is null || !placementsById.TryGetValue(current.RelativeToSourceId.Value, out var parent))
            {
                break;
            }

            current = parent;
        }

        var transform = NativeGeometryTransform.Identity;
        for (var index = chain.Count - 1; index >= 0; index--)
        {
            var item = chain[index];
            transform = transform.Compose(NativeGeometryTransform.FromAxisPlacement(
                new IfcPreviewVertex(item.X, item.Y, item.Z),
                item.Axis,
                item.RefDirection));
        }

        return transform;
    }

    public static IfcPreviewVertex Add(IfcPreviewVertex left, IfcPreviewVertex right)
    {
        return new IfcPreviewVertex(left.X + right.X, left.Y + right.Y, left.Z + right.Z);
    }

    public static IfcPreviewVertex ResolveProfilePoint(IfcGeometryProfile? profile, double x, double y, double z)
    {
        if (profile is null)
        {
            return new IfcPreviewVertex(x, y, z);
        }

        var profileXAxis = Normalize(new IfcPreviewVertex(profile.PositionRefDirection.X, profile.PositionRefDirection.Y, 0), new IfcPreviewVertex(1, 0, 0));
        var profileYAxis = new IfcPreviewVertex(-profileXAxis.Y, profileXAxis.X, 0);
        var origin = new IfcPreviewVertex(profile.PositionX, profile.PositionY, profile.PositionZ);
        return Add(Add(Add(origin, Scale(profileXAxis, x)), Scale(profileYAxis, y)), new IfcPreviewVertex(0, 0, z));
    }

    private static IfcPreviewVertex ResolveFallbackOrigin(int index, int columns)
    {
        var safeColumns = Math.Max(1, columns);
        var row = index / safeColumns;
        var column = index % safeColumns;
        return new IfcPreviewVertex((column - (safeColumns - 1) / 2.0) * 1.8, row * 1.8, 0);
    }

    private static IfcPreviewVertex Scale(IfcPreviewVertex vertex, double scale)
    {
        return new IfcPreviewVertex(vertex.X * scale, vertex.Y * scale, vertex.Z * scale);
    }

    private static IfcPreviewVertex Normalize(IfcPreviewVertex vector, IfcPreviewVertex fallback)
    {
        var length = Math.Sqrt(vector.X * vector.X + vector.Y * vector.Y + vector.Z * vector.Z);
        return length > 0 && !double.IsNaN(length) && !double.IsInfinity(length)
            ? new IfcPreviewVertex(vector.X / length, vector.Y / length, vector.Z / length)
            : fallback;
    }
}

public sealed record NativeGeometryTransform(
    IfcPreviewVertex Origin,
    IfcPreviewVertex XAxis,
    IfcPreviewVertex YAxis,
    IfcPreviewVertex ZAxis)
{
    public static NativeGeometryTransform Identity { get; } = new(
        new IfcPreviewVertex(0, 0, 0),
        new IfcPreviewVertex(1, 0, 0),
        new IfcPreviewVertex(0, 1, 0),
        new IfcPreviewVertex(0, 0, 1));

    public static NativeGeometryTransform FromAxisPlacement(IfcPreviewVertex origin, IfcModelVector axis, IfcModelVector refDirection, double scale = 1)
    {
        var zAxis = Normalize(ToVertex(axis), new IfcPreviewVertex(0, 0, 1));
        var rawXAxis = ToVertex(refDirection);
        var projectedXAxis = Subtract(rawXAxis, Scale(zAxis, Dot(rawXAxis, zAxis)));
        var safeScale = scale > 0 && !double.IsNaN(scale) && !double.IsInfinity(scale) ? scale : 1;
        var xAxis = Normalize(projectedXAxis, FallbackXAxis(zAxis));
        var yAxis = Normalize(Cross(zAxis, xAxis), new IfcPreviewVertex(0, 1, 0));
        return new NativeGeometryTransform(origin, Scale(xAxis, safeScale), Scale(yAxis, safeScale), Scale(zAxis, safeScale));
    }

    public NativeGeometryTransform Compose(NativeGeometryTransform child)
    {
        return new NativeGeometryTransform(
            TransformPoint(child.Origin),
            TransformVector(child.XAxis),
            TransformVector(child.YAxis),
            TransformVector(child.ZAxis));
    }

    public IfcPreviewVertex TransformPoint(IfcPreviewVertex point)
    {
        return Add(Origin, TransformVector(point));
    }

    public IfcPreviewVertex TransformVector(IfcPreviewVertex vector)
    {
        return Add(Add(Scale(XAxis, vector.X), Scale(YAxis, vector.Y)), Scale(ZAxis, vector.Z));
    }

    private static IfcPreviewVertex ToVertex(IfcModelVector vector)
    {
        return new IfcPreviewVertex(vector.X, vector.Y, vector.Z);
    }

    private static IfcPreviewVertex FallbackXAxis(IfcPreviewVertex zAxis)
    {
        var candidate = Math.Abs(Dot(zAxis, new IfcPreviewVertex(1, 0, 0))) > 0.95
            ? new IfcPreviewVertex(0, 1, 0)
            : new IfcPreviewVertex(1, 0, 0);
        return Normalize(Subtract(candidate, Scale(zAxis, Dot(candidate, zAxis))), new IfcPreviewVertex(1, 0, 0));
    }

    private static IfcPreviewVertex Add(IfcPreviewVertex left, IfcPreviewVertex right)
    {
        return new IfcPreviewVertex(left.X + right.X, left.Y + right.Y, left.Z + right.Z);
    }

    private static IfcPreviewVertex Subtract(IfcPreviewVertex left, IfcPreviewVertex right)
    {
        return new IfcPreviewVertex(left.X - right.X, left.Y - right.Y, left.Z - right.Z);
    }

    private static IfcPreviewVertex Scale(IfcPreviewVertex vertex, double scale)
    {
        return new IfcPreviewVertex(vertex.X * scale, vertex.Y * scale, vertex.Z * scale);
    }

    private static double Dot(IfcPreviewVertex left, IfcPreviewVertex right)
    {
        return left.X * right.X + left.Y * right.Y + left.Z * right.Z;
    }

    private static IfcPreviewVertex Cross(IfcPreviewVertex left, IfcPreviewVertex right)
    {
        return new IfcPreviewVertex(
            left.Y * right.Z - left.Z * right.Y,
            left.Z * right.X - left.X * right.Z,
            left.X * right.Y - left.Y * right.X);
    }

    private static IfcPreviewVertex Normalize(IfcPreviewVertex vector, IfcPreviewVertex fallback)
    {
        var length = Math.Sqrt(vector.X * vector.X + vector.Y * vector.Y + vector.Z * vector.Z);
        return length > 0 && !double.IsNaN(length) && !double.IsInfinity(length)
            ? new IfcPreviewVertex(vector.X / length, vector.Y / length, vector.Z / length)
            : fallback;
    }
}
