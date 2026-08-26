using System.Runtime.InteropServices;
using System.Text.Json;

namespace IFCnative.IfcToGlb;

/// <summary>Accessor indices for one deduplicated geometry payload.</summary>
public readonly record struct GlbGeometry(int PositionAccessor, int NormalAccessor, int IndexAccessor);

/// <summary>
/// Minimal streaming glTF 2.0 binary (GLB) writer. Geometry payloads are
/// appended to a delete-on-close temp file as they are produced, so peak
/// managed memory stays bounded by the largest single mesh rather than the
/// whole scene; only the small JSON-side descriptors (accessors, buffer
/// views, materials, nodes) are held until <see cref="Save"/> assembles the
/// container.
/// </summary>
public sealed class GlbWriter : IDisposable
{
    private const uint Magic = 0x46546C67;          // "glTF"
    private const uint JsonChunk = 0x4E4F534A;      // "JSON"
    private const uint BinChunk = 0x004E4942;       // "BIN\0"
    private const int ArrayBuffer = 34962;
    private const int ElementArrayBuffer = 34963;
    private const int Float = 5126;
    private const int UnsignedShort = 5123;
    private const int UnsignedInt = 5125;

    private sealed record BufferViewInfo(long ByteOffset, long ByteLength, int Target);
    private sealed record AccessorInfo(int BufferView, int ComponentType, string Type, int Count, float[]? Min, float[]? Max);
    private sealed record MaterialInfo(string? Name, float R, float G, float B, float A);
    private sealed record MeshInfo(string? Name, GlbGeometry Geometry, int Material);
    private sealed record NodeInfo(string? Name, double[]? Matrix, int? Mesh, IReadOnlyList<int>? Children, string? IfcType, int? ExpressId, string? ElementName);

    private readonly FileStream _bin;
    private readonly List<BufferViewInfo> _bufferViews = [];
    private readonly List<AccessorInfo> _accessors = [];
    private readonly List<MaterialInfo> _materials = [];
    private readonly Dictionary<uint, int> _materialLookup = [];
    private readonly List<MeshInfo> _meshes = [];
    private readonly List<NodeInfo> _nodes = [];

    public GlbWriter()
    {
        var path = Path.Combine(Path.GetTempPath(), $"ifc2glb-{Guid.NewGuid():N}.bin");
        _bin = new FileStream(path, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None, 1 << 16, FileOptions.DeleteOnClose);
    }

    public int MeshCount => _meshes.Count;

    /// <summary>Writes one geometry payload to the binary chunk and returns its accessors.</summary>
    public GlbGeometry AddGeometry(ReadOnlySpan<float> positions, ReadOnlySpan<float> normals, ReadOnlySpan<int> indices)
    {
        if (positions.Length == 0 || positions.Length % 3 != 0 || indices.Length == 0)
        {
            throw new ArgumentException("Geometry requires non-empty positions (multiple of 3) and indices.");
        }

        var vertexCount = positions.Length / 3;
        var min = new[] { float.MaxValue, float.MaxValue, float.MaxValue };
        var max = new[] { float.MinValue, float.MinValue, float.MinValue };
        for (var i = 0; i < positions.Length; i += 3)
        {
            for (var axis = 0; axis < 3; axis++)
            {
                var value = positions[i + axis];
                if (value < min[axis]) min[axis] = value;
                if (value > max[axis]) max[axis] = value;
            }
        }

        var positionView = WriteBufferView(MemoryMarshal.AsBytes(positions), ArrayBuffer);
        var positionAccessor = AddAccessor(positionView, Float, "VEC3", vertexCount, min, max);

        var normalAccessor = -1;
        if (!normals.IsEmpty)
        {
            var normalView = WriteBufferView(MemoryMarshal.AsBytes(normals), ArrayBuffer);
            normalAccessor = AddAccessor(normalView, Float, "VEC3", vertexCount, null, null);
        }

        int indexAccessor;
        if (vertexCount <= ushort.MaxValue)
        {
            var shorts = new ushort[indices.Length];
            for (var i = 0; i < indices.Length; i++)
            {
                shorts[i] = (ushort)indices[i];
            }

            var view = WriteBufferView(MemoryMarshal.AsBytes<ushort>(shorts), ElementArrayBuffer);
            indexAccessor = AddAccessor(view, UnsignedShort, "SCALAR", indices.Length, null, null);
        }
        else
        {
            var view = WriteBufferView(MemoryMarshal.AsBytes(indices), ElementArrayBuffer);
            indexAccessor = AddAccessor(view, UnsignedInt, "SCALAR", indices.Length, null, null);
        }

        return new GlbGeometry(positionAccessor, normalAccessor, indexAccessor);
    }

    public int GetOrAddMaterial(float r, float g, float b, float a, string? name = null)
    {
        var key = ((uint)(Math.Clamp(r, 0f, 1f) * 255f) << 24)
            | ((uint)(Math.Clamp(g, 0f, 1f) * 255f) << 16)
            | ((uint)(Math.Clamp(b, 0f, 1f) * 255f) << 8)
            | (uint)(Math.Clamp(a, 0f, 1f) * 255f);
        if (_materialLookup.TryGetValue(key, out var existing))
        {
            return existing;
        }

        _materials.Add(new MaterialInfo(name, r, g, b, a));
        var index = _materials.Count - 1;
        _materialLookup[key] = index;
        return index;
    }

    public int AddMesh(GlbGeometry geometry, int material, string? name = null)
    {
        _meshes.Add(new MeshInfo(name, geometry, material));
        return _meshes.Count - 1;
    }

    public int AddNode(
        string? name,
        double[]? matrix,
        int? mesh,
        IReadOnlyList<int>? children = null,
        string? ifcType = null,
        int? expressId = null,
        string? elementName = null)
    {
        _nodes.Add(new NodeInfo(name, matrix, mesh, children, ifcType, expressId, elementName));
        return _nodes.Count - 1;
    }

    /// <summary>Assembles header + JSON chunk + binary chunk into <paramref name="outputPath"/>.</summary>
    public long Save(string outputPath, int sceneRootNode, string generator, double[]? originOffsetMetres = null)
    {
        PadBin(4);
        _bin.Flush();
        var binLength = _bin.Length;

        using var jsonStream = new MemoryStream();
        WriteJson(jsonStream, sceneRootNode, generator, binLength, originOffsetMetres);
        while (jsonStream.Length % 4 != 0)
        {
            jsonStream.WriteByte((byte)' ');
        }

        var jsonLength = jsonStream.Length;
        var totalLength = 12L + 8 + jsonLength + 8 + binLength;
        if (totalLength > uint.MaxValue)
        {
            throw new InvalidOperationException(
                $"GLB output would be {totalLength / (1024 * 1024)} MB; the GLB container is limited to 4 GB.");
        }

        using var output = new FileStream(outputPath, FileMode.Create, FileAccess.Write, FileShare.None, 1 << 16);
        using var writer = new BinaryWriter(output);
        writer.Write(Magic);
        writer.Write(2u);
        writer.Write((uint)totalLength);

        writer.Write((uint)jsonLength);
        writer.Write(JsonChunk);
        jsonStream.Position = 0;
        jsonStream.CopyTo(output);

        writer.Write((uint)binLength);
        writer.Write(BinChunk);
        _bin.Position = 0;
        _bin.CopyTo(output);

        return totalLength;
    }

    public void Dispose()
    {
        _bin.Dispose();
    }

    private int WriteBufferView(ReadOnlySpan<byte> data, int target)
    {
        PadBin(4);
        var offset = _bin.Position;
        _bin.Write(data);
        _bufferViews.Add(new BufferViewInfo(offset, data.Length, target));
        return _bufferViews.Count - 1;
    }

    private int AddAccessor(int bufferView, int componentType, string type, int count, float[]? min, float[]? max)
    {
        _accessors.Add(new AccessorInfo(bufferView, componentType, type, count, min, max));
        return _accessors.Count - 1;
    }

    private void PadBin(int alignment)
    {
        while (_bin.Position % alignment != 0)
        {
            _bin.WriteByte(0);
        }
    }

    private void WriteJson(Stream stream, int sceneRootNode, string generator, long binLength, double[]? originOffsetMetres)
    {
        using var json = new Utf8JsonWriter(stream);
        json.WriteStartObject();

        json.WriteStartObject("asset");
        json.WriteString("version", "2.0");
        json.WriteString("generator", generator);
        if (originOffsetMetres is not null && originOffsetMetres.Any(v => v != 0d))
        {
            json.WriteStartObject("extras");
            json.WriteStartArray("originOffsetMetres");
            foreach (var value in originOffsetMetres)
            {
                json.WriteNumberValue(value);
            }

            json.WriteEndArray();
            json.WriteEndObject();
        }

        json.WriteEndObject();

        json.WriteNumber("scene", 0);
        json.WriteStartArray("scenes");
        json.WriteStartObject();
        json.WriteStartArray("nodes");
        json.WriteNumberValue(sceneRootNode);
        json.WriteEndArray();
        json.WriteEndObject();
        json.WriteEndArray();

        json.WriteStartArray("nodes");
        foreach (var node in _nodes)
        {
            json.WriteStartObject();
            if (!string.IsNullOrEmpty(node.Name))
            {
                json.WriteString("name", node.Name);
            }

            if (node.Matrix is not null)
            {
                json.WriteStartArray("matrix");
                foreach (var value in node.Matrix)
                {
                    json.WriteNumberValue(value);
                }

                json.WriteEndArray();
            }

            if (node.Mesh is int mesh)
            {
                json.WriteNumber("mesh", mesh);
            }

            if (node.Children is { Count: > 0 })
            {
                json.WriteStartArray("children");
                foreach (var child in node.Children)
                {
                    json.WriteNumberValue(child);
                }

                json.WriteEndArray();
            }

            if (node.IfcType is not null || node.ExpressId is not null || node.ElementName is not null)
            {
                json.WriteStartObject("extras");
                if (node.IfcType is not null)
                {
                    json.WriteString("ifcType", node.IfcType);
                }

                if (node.ExpressId is int expressId)
                {
                    json.WriteNumber("expressId", expressId);
                }

                if (node.ElementName is not null)
                {
                    json.WriteString("name", node.ElementName);
                }

                json.WriteEndObject();
            }

            json.WriteEndObject();
        }

        json.WriteEndArray();

        if (_meshes.Count > 0)
        {
            json.WriteStartArray("meshes");
            foreach (var mesh in _meshes)
            {
                json.WriteStartObject();
                if (!string.IsNullOrEmpty(mesh.Name))
                {
                    json.WriteString("name", mesh.Name);
                }

                json.WriteStartArray("primitives");
                json.WriteStartObject();
                json.WriteStartObject("attributes");
                json.WriteNumber("POSITION", mesh.Geometry.PositionAccessor);
                if (mesh.Geometry.NormalAccessor >= 0)
                {
                    json.WriteNumber("NORMAL", mesh.Geometry.NormalAccessor);
                }

                json.WriteEndObject();
                json.WriteNumber("indices", mesh.Geometry.IndexAccessor);
                json.WriteNumber("material", mesh.Material);
                json.WriteEndObject();
                json.WriteEndArray();
                json.WriteEndObject();
            }

            json.WriteEndArray();
        }

        if (_materials.Count > 0)
        {
            json.WriteStartArray("materials");
            foreach (var material in _materials)
            {
                json.WriteStartObject();
                if (!string.IsNullOrEmpty(material.Name))
                {
                    json.WriteString("name", material.Name);
                }

                json.WriteStartObject("pbrMetallicRoughness");
                json.WriteStartArray("baseColorFactor");
                json.WriteNumberValue(material.R);
                json.WriteNumberValue(material.G);
                json.WriteNumberValue(material.B);
                json.WriteNumberValue(material.A);
                json.WriteEndArray();
                json.WriteNumber("metallicFactor", 0d);
                json.WriteNumber("roughnessFactor", 0.9d);
                json.WriteEndObject();
                if (material.A < 1f)
                {
                    json.WriteString("alphaMode", "BLEND");
                }

                json.WriteBoolean("doubleSided", true);
                json.WriteEndObject();
            }

            json.WriteEndArray();
        }

        if (_accessors.Count > 0)
        {
            json.WriteStartArray("accessors");
            foreach (var accessor in _accessors)
            {
                json.WriteStartObject();
                json.WriteNumber("bufferView", accessor.BufferView);
                json.WriteNumber("componentType", accessor.ComponentType);
                json.WriteNumber("count", accessor.Count);
                json.WriteString("type", accessor.Type);
                if (accessor.Min is not null)
                {
                    json.WriteStartArray("min");
                    foreach (var value in accessor.Min)
                    {
                        json.WriteNumberValue(value);
                    }

                    json.WriteEndArray();
                }

                if (accessor.Max is not null)
                {
                    json.WriteStartArray("max");
                    foreach (var value in accessor.Max)
                    {
                        json.WriteNumberValue(value);
                    }

                    json.WriteEndArray();
                }

                json.WriteEndObject();
            }

            json.WriteEndArray();

            json.WriteStartArray("bufferViews");
            foreach (var view in _bufferViews)
            {
                json.WriteStartObject();
                json.WriteNumber("buffer", 0);
                json.WriteNumber("byteOffset", view.ByteOffset);
                json.WriteNumber("byteLength", view.ByteLength);
                json.WriteNumber("target", view.Target);
                json.WriteEndObject();
            }

            json.WriteEndArray();

            json.WriteStartArray("buffers");
            json.WriteStartObject();
            json.WriteNumber("byteLength", binLength);
            json.WriteEndObject();
            json.WriteEndArray();
        }

        json.WriteEndObject();
    }
}
