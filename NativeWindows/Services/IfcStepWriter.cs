using System.Text;
using IFCnative.NativeWindows.Models;

namespace IFCnative.NativeWindows.Services;

public static class IfcStepWriter
{
    public static string Serialize(IfcDocument document)
    {
        var builder = new StringBuilder();
        builder.Append("ISO-10303-21;\n");
        builder.Append(NormalizeLineEndings(document.HeaderText.TrimEnd()));
        builder.Append('\n');
        builder.Append("DATA;\n");

        foreach (var entity in document.Entities)
        {
            builder.Append(SerializeEntity(entity));
            builder.Append('\n');
        }

        builder.Append("ENDSEC;\n");
        builder.Append("END-ISO-10303-21;\n");
        return builder.ToString();
    }

    public static string SerializeEntity(IfcEntity entity)
    {
        if (!string.IsNullOrWhiteSpace(entity.OriginalStepLine)
            && entity.OriginalArguments.SequenceEqual(entity.Arguments, StringComparer.Ordinal)
            && entity.OriginalStepLine.Contains($"#{entity.Id}", StringComparison.Ordinal))
        {
            return NormalizeLineEndings(entity.OriginalStepLine.TrimEnd());
        }

        return $"#{entity.Id}= {entity.Type}({string.Join(",", entity.Arguments)});";
    }

    private static string NormalizeLineEndings(string text)
    {
        return text.Replace("\r\n", "\n", StringComparison.Ordinal).Replace('\r', '\n');
    }

    public static int NextEntityId(IfcDocument document)
    {
        return document.Entities.Count == 0 ? 1 : document.Entities.Max(entity => entity.Id) + 1;
    }
}
