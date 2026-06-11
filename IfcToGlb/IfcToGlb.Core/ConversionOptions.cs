namespace IFCnative.IfcToGlb;

public sealed record ConversionOptions
{
    /// <summary>
    /// Minimum chord deviation for tessellation, in millimetres. Matches the
    /// viewer-grade default the NativeWindows app uses (4mm); lower values
    /// produce finer meshes at higher cost.
    /// </summary>
    public double DeflectionMillimetres { get; init; } = 4d;

    /// <summary>Angular deflection for tessellating curved surfaces, in radians.</summary>
    public double DeflectionAngle { get; init; } = 1d;

    public int MaxThreads { get; init; } = Environment.ProcessorCount;

    /// <summary>IfcSpace volumes are skipped by default; they occlude everything in viewers.</summary>
    public bool IncludeSpaces { get; init; }

    /// <summary>Writes IFC type, element name and express id into node extras.</summary>
    public bool IncludeMetadata { get; init; } = true;
}

public sealed record ConversionResult(
    string OutputPath,
    int ProductCount,
    int InstanceCount,
    int MeshCount,
    int TriangleCount,
    long OutputBytes,
    TimeSpan Duration);
