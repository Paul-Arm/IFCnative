using System.Text;
using IFCnative.NativeWindows.Models;

namespace IFCnative.NativeWindows.Services;

public static class IfcStepWriter
{
    public static string Serialize(IfcDocument document)
    {
        var builder = new StringBuilder();
        builder.AppendLine("ISO-10303-21;");
        builder.Append(document.HeaderText.TrimEnd());
        builder.AppendLine();
        builder.AppendLine("DATA;");

        foreach (var entity in document.Entities)
        {
            builder.AppendLine(SerializeEntity(entity));
        }

        builder.AppendLine("ENDSEC;");
        builder.AppendLine("END-ISO-10303-21;");
        return builder.ToString();
    }

    public static string SerializeEntity(IfcEntity entity)
    {
        if (!string.IsNullOrWhiteSpace(entity.OriginalStepLine)
            && entity.OriginalArguments.SequenceEqual(entity.Arguments, StringComparer.Ordinal)
            && entity.OriginalStepLine.Contains($"#{entity.Id}", StringComparison.Ordinal))
        {
            return entity.OriginalStepLine.TrimEnd();
        }

        return $"#{entity.Id}= {entity.Type}({string.Join(",", entity.Arguments)});";
    }

    public static int NextEntityId(IfcDocument document)
    {
        return document.Entities.Count == 0 ? 1 : document.Entities.Max(entity => entity.Id) + 1;
    }
}
