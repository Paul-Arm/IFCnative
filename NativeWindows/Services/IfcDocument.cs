using System.Text;
using IFCnative.NativeWindows.Models;

namespace IFCnative.NativeWindows.Services;

public sealed class IfcDocument
{
    public string FileName { get; init; } = "Untitled.ifc";

    public string HeaderText { get; init; } = string.Empty;

    public string Schema { get; init; } = "UNKNOWN";

    public List<IfcEntity> Entities { get; } = [];

    public Dictionary<int, IfcEntity> EntityById { get; } = [];

    public Dictionary<string, List<IfcEntity>> EntitiesByType { get; } = new(StringComparer.OrdinalIgnoreCase);

    public Dictionary<int, List<IfcEntity>> IncomingReferences { get; } = [];

    public List<IfcTreeNode> SpatialRoots { get; } = [];

    public IfcDiagnostics Diagnostics { get; } = new();

    public string ToStepText()
    {
        var builder = new StringBuilder();
        builder.AppendLine("ISO-10303-21;");
        builder.Append(HeaderText.TrimEnd());
        builder.AppendLine();
        builder.AppendLine("DATA;");

        foreach (var entity in Entities.OrderBy(entity => entity.Id))
        {
            builder.AppendLine(entity.ToStepLine());
        }

        builder.AppendLine("ENDSEC;");
        builder.AppendLine("END-ISO-10303-21;");
        return builder.ToString();
    }
}

