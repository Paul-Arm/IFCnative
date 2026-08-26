using System.Text;

namespace IFCnative.NativeWindows;

public static class StepArgumentReader
{
    public static List<string> SplitTopLevel(string text)
    {
        var result = new List<string>();
        var start = 0;
        var depth = 0;
        var inString = false;

        for (var index = 0; index < text.Length; index++)
        {
            var character = text[index];

            if (character == '\'')
            {
                if (inString && index + 1 < text.Length && text[index + 1] == '\'')
                {
                    index++;
                    continue;
                }

                inString = !inString;
                continue;
            }

            if (inString)
            {
                continue;
            }

            if (character == '(')
            {
                depth++;
                continue;
            }

            if (character == ')')
            {
                depth = Math.Max(0, depth - 1);
                continue;
            }

            if (character == ',' && depth == 0)
            {
                result.Add(text[start..index].Trim());
                start = index + 1;
            }
        }

        result.Add(text[start..].Trim());
        return result;
    }

    public static List<int> ReadReferences(string argument)
    {
        var references = new List<int>();

        for (var index = 0; index < argument.Length; index++)
        {
            if (argument[index] != '#')
            {
                continue;
            }

            var start = index + 1;
            var end = start;
            while (end < argument.Length && char.IsDigit(argument[end]))
            {
                end++;
            }

            if (end > start && int.TryParse(argument[start..end], out var id))
            {
                references.Add(id);
            }

            index = end;
        }

        return references;
    }

    public static string? Unquote(string? value)
    {
        if (string.IsNullOrWhiteSpace(value) || value is "$" or "*")
        {
            return null;
        }

        value = value.Trim();
        if (value.Length >= 2 && value[0] == '\'' && value[^1] == '\'')
        {
            return value[1..^1].Replace("''", "'", StringComparison.Ordinal);
        }

        return value;
    }

    public static string Quote(string value)
    {
        return $"'{value.Replace("'", "''", StringComparison.Ordinal)}'";
    }

    public static string CompactPreview(string value, int maxLength = 140)
    {
        var builder = new StringBuilder(value.Length);
        var lastWasSpace = false;

        foreach (var character in value)
        {
            if (char.IsWhiteSpace(character))
            {
                if (!lastWasSpace)
                {
                    builder.Append(' ');
                    lastWasSpace = true;
                }

                continue;
            }

            builder.Append(character);
            lastWasSpace = false;
        }

        var compact = builder.ToString().Trim();
        return compact.Length <= maxLength ? compact : $"{compact[..maxLength]}...";
    }
}

