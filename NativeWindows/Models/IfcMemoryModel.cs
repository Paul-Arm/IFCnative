namespace IFCnative.NativeWindows.Models;

public sealed class IfcMemoryModel
{
    public static IfcMemoryModel Empty { get; } = new();

    public string FileName { get; init; } = "Untitled.ifc";

    public string Schema { get; init; } = "UNKNOWN";

    public List<IfcModelObject> Objects { get; } = [];

    public Dictionary<int, IfcModelObject> ObjectsBySourceId { get; } = [];

    public Dictionary<string, List<IfcModelObject>> ObjectsByClass { get; } = new(StringComparer.OrdinalIgnoreCase);

    public List<IfcModelRelation> Relations { get; } = [];

    public Dictionary<int, List<IfcModelRelation>> RelationsByObjectId { get; } = [];

    public Dictionary<int, IfcModelPropertySet> PropertySetBySourceId { get; } = [];

    public Dictionary<int, List<IfcModelPropertySet>> PropertySetsByObjectId { get; } = [];

    public Dictionary<int, IfcModelResource> ResourceBySourceId { get; } = [];

    public Dictionary<int, List<IfcModelResource>> ResourcesByObjectId { get; } = [];

    public Dictionary<int, IfcProductGeometry> ProductGeometryByProductId { get; } = [];

    public int PropertyValueCount => PropertySetsByObjectId.Values
        .SelectMany(sets => sets)
        .SelectMany(set => set.Values)
        .Count();

    public int GeometryPrimitiveCount => ProductGeometryByProductId.Values
        .SelectMany(geometry => geometry.Primitives)
        .Count();
}

public sealed class IfcModelObject
{
    public int SourceId { get; init; }

    public string IfcClass { get; init; } = string.Empty;

    public string GlobalId { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public string Description { get; set; } = string.Empty;

    public string PredefinedType { get; set; } = string.Empty;

    public List<string> RawArguments { get; } = [];

    public bool HasRawArgumentOverride { get; set; }

    public bool IsSpatial { get; init; }

    public bool IsPhysicalProduct { get; init; }

    public string SpatialPath { get; set; } = string.Empty;

    public IfcModelPlacement? Placement { get; set; }

    public IfcProductGeometry? Geometry { get; set; }

    public List<IfcModelPropertySet> PropertySets { get; } = [];

    public List<IfcModelResource> Resources { get; } = [];

    public List<IfcModelRelation> Relations { get; } = [];

    public string Label
    {
        get
        {
            var name = string.IsNullOrWhiteSpace(Name) ? $"#{SourceId}" : Name;
            return $"#{SourceId} {IfcClass} {name}";
        }
    }
}

public sealed class IfcModelRelation
{
    public int SourceId { get; init; }

    public string IfcClass { get; init; } = string.Empty;

    public string Name { get; init; } = string.Empty;

    public List<int> SourceObjectIds { get; } = [];

    public List<int> TargetObjectIds { get; } = [];

    public string Label => string.IsNullOrWhiteSpace(Name)
        ? $"#{SourceId} {IfcClass}"
        : $"#{SourceId} {IfcClass} {Name}";
}

public sealed class IfcModelPropertySet
{
    public int SourceId { get; init; }

    public string Kind { get; init; } = string.Empty;

    public string Name { get; init; } = string.Empty;

    public List<IfcModelPropertyValue> Values { get; } = [];

    public string Label => $"#{SourceId} {Kind} {Name}";
}

public sealed class IfcModelPropertyValue
{
    public int SourceId { get; init; }

    public string IfcClass { get; init; } = string.Empty;

    public string Name { get; init; } = string.Empty;

    public IfcModelValue Value { get; set; } = IfcModelValue.Empty;

    public string Label => string.IsNullOrWhiteSpace(Value.Display)
        ? $"#{SourceId} {IfcClass} {Name}"
        : $"#{SourceId} {IfcClass} {Name}: {Value.Display}";
}

public sealed class IfcModelResource
{
    public int SourceId { get; init; }

    public string IfcClass { get; init; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public string Identification { get; set; } = string.Empty;

    public string Description { get; set; } = string.Empty;

    public string Label
    {
        get
        {
            var typeName = IfcClass.StartsWith("IFC", StringComparison.OrdinalIgnoreCase)
                ? IfcClass[3..]
                : IfcClass;
            var label = string.IsNullOrWhiteSpace(Name) ? Identification : Name;
            return string.IsNullOrWhiteSpace(label)
                ? $"#{SourceId} {typeName}"
                : $"#{SourceId} {typeName} {label}";
        }
    }
}

public sealed record IfcModelValue(
    IfcPropertyValueKind Kind,
    string? IfcType,
    string? Text,
    double? Number,
    bool? Boolean,
    string Display)
{
    public static IfcModelValue Empty { get; } = new(IfcPropertyValueKind.Empty, null, null, null, null, string.Empty);
}

public enum IfcPropertyValueKind
{
    Empty,
    String,
    Boolean,
    Number,
    Enum,
    Reference,
    Unknown,
}

public sealed class IfcModelPlacement
{
    public int SourceId { get; init; }

    public int AxisPlacementSourceId { get; init; }

    public int PointSourceId { get; init; }

    public int AxisDirectionSourceId { get; set; }

    public int RefDirectionSourceId { get; set; }

    public int? RelativeToSourceId { get; init; }

    public double X { get; set; }

    public double Y { get; set; }

    public double Z { get; set; }

    public IfcModelVector Axis { get; set; } = IfcModelVector.UnitZ;

    public IfcModelVector RefDirection { get; set; } = IfcModelVector.UnitX;

    public string Label
    {
        get
        {
            var relative = RelativeToSourceId is null ? "world" : $"#{RelativeToSourceId}";
            return $"placement #{SourceId} at ({X:0.###}, {Y:0.###}, {Z:0.###}), relative to {relative}";
        }
    }
}

public sealed class IfcProductGeometry
{
    public int ProductSourceId { get; init; }

    public int ProductDefinitionShapeSourceId { get; init; }

    public List<IfcShapeRepresentationModel> ShapeRepresentations { get; } = [];

    public List<IfcGeometryPrimitive> Primitives { get; } = [];

    public string Label => $"product #{ProductSourceId}: {Primitives.Count:N0} native geometry primitive(s)";
}

public sealed class IfcShapeRepresentationModel
{
    public int SourceId { get; init; }

    public int ContextSourceId { get; init; }

    public string Identifier { get; init; } = string.Empty;

    public string RepresentationType { get; init; } = string.Empty;

    public List<int> GeometryItemSourceIds { get; } = [];

    public string Label => $"#{SourceId} {Identifier} {RepresentationType}".Trim();
}

public sealed class IfcGeometryPrimitive
{
    public int SourceId { get; init; }

    public string IfcClass { get; init; } = string.Empty;

    public string Kind { get; init; } = "Unknown";

    public bool IsMissingReference { get; init; }

    public IfcGeometryProfile? Profile { get; set; }

    public int PositionSourceId { get; set; }

    public int PositionPointSourceId { get; set; }

    public int DirectionSourceId { get; set; }

    public int MappedItemSourceId { get; set; }

    public int MappedGeometrySourceId { get; set; }

    public double MappingX { get; set; }

    public double MappingY { get; set; }

    public double MappingZ { get; set; }

    public double MappingScale { get; set; } = 1;

    public IfcModelVector MappingAxis { get; set; } = IfcModelVector.UnitZ;

    public IfcModelVector MappingRefDirection { get; set; } = IfcModelVector.UnitX;

    public int PositionAxisSourceId { get; set; }

    public int PositionRefDirectionSourceId { get; set; }

    public double PositionX { get; set; }

    public double PositionY { get; set; }

    public double PositionZ { get; set; }

    public double? SizeX { get; set; }

    public double? SizeY { get; set; }

    public double? SizeZ { get; set; }

    public IfcModelVector Direction { get; init; } = IfcModelVector.UnitZ;

    public IfcModelVector PositionAxis { get; set; } = IfcModelVector.UnitZ;

    public IfcModelVector PositionRefDirection { get; set; } = IfcModelVector.UnitX;

    public List<int> ReferencedSourceIds { get; } = [];

    public string Label
    {
        get
        {
            if (IsMissingReference)
            {
                return $"missing geometry reference #{SourceId}";
            }

            if (Kind == "ExtrudedAreaSolid")
            {
                var profile = Profile?.Label ?? "unknown profile";
                var depth = SizeZ is null ? "unknown depth" : $"depth {SizeZ:0.###}";
                var mapped = MappedItemSourceId > 0 && MappedGeometrySourceId > 0 ? $"mapped #{MappedGeometrySourceId} " : string.Empty;
                return $"#{SourceId} {mapped}extruded {profile}, {depth}";
            }

            if (Kind == "BoundingBox")
            {
                return $"#{SourceId} bounding box {SizeX:0.###} x {SizeY:0.###} x {SizeZ:0.###}";
            }

            return $"#{SourceId} {IfcClass}";
        }
    }
}

public sealed class IfcGeometryProfile
{
    public int SourceId { get; init; }

    public int PositionSourceId { get; set; }

    public int PositionPointSourceId { get; set; }

    public int DirectionSourceId { get; set; }

    public double PositionX { get; set; }

    public double PositionY { get; set; }

    public double PositionZ { get; set; }

    public IfcModelVector PositionRefDirection { get; set; } = IfcModelVector.UnitX;

    public string IfcClass { get; init; } = string.Empty;

    public string Kind { get; init; } = "Unknown";

    public string Name { get; init; } = string.Empty;

    public double? SizeX { get; set; }

    public double? SizeY { get; set; }

    public double? Radius { get; set; }

    public string Label
    {
        get
        {
            if (Kind == "Rectangle")
            {
                return $"rectangle {SizeX:0.###} x {SizeY:0.###}";
            }

            if (Kind == "Circle")
            {
                return $"circle radius {Radius:0.###}";
            }

            return string.IsNullOrWhiteSpace(Name)
                ? $"#{SourceId} {IfcClass}"
                : $"#{SourceId} {IfcClass} {Name}";
        }
    }
}

public sealed record IfcModelVector(double X, double Y, double Z)
{
    public static IfcModelVector UnitX { get; } = new(1, 0, 0);

    public static IfcModelVector UnitY { get; } = new(0, 1, 0);

    public static IfcModelVector UnitZ { get; } = new(0, 0, 1);
}
