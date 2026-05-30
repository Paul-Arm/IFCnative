using System.IO;
using System.Text;
using System.Xml.Linq;

namespace IFCnative.NativeWindows.Services;

public static class IfcXmlExchange
{
    private const string StepTextElementName = "stepText";

    public static bool IsIfcXml(string path)
    {
        return Path.GetExtension(path).Equals(".ifcxml", StringComparison.OrdinalIgnoreCase);
    }

    public static async Task<LoadedIfcText> ReadAsync(
        string path,
        IProgress<string>? progress = null,
        CancellationToken cancellationToken = default)
    {
        var fileInfo = new FileInfo(path);
        progress?.Report($"Opening {fileInfo.Name} ({IfcFileLoader.FormatBytes(fileInfo.Length)})...");

        var xml = await File.ReadAllTextAsync(path, Encoding.UTF8, cancellationToken);
        cancellationToken.ThrowIfCancellationRequested();

        var stepText = ExtractStepText(xml);
        if (string.IsNullOrWhiteSpace(stepText))
        {
            throw new InvalidDataException("ifcXML import requires a stepText payload. Full xBIM ifcXML import is available as a dependency bridge but this safe roundtrip path only opens IFCnative ifcXML exports.");
        }

        progress?.Report($"Extracted STEP payload from {fileInfo.Name}...");
        var stepName = Path.ChangeExtension(fileInfo.Name, ".ifc");
        return new LoadedIfcText(stepText, stepName);
    }

    public static void Write(string path, string stepText, string documentFileName)
    {
        var schema = ExtractSchema(stepText);
        var document = new XDocument(
            new XDeclaration("1.0", "utf-8", null),
            new XElement("ifcXML",
                new XAttribute("schema", schema),
                new XAttribute("source", Path.GetFileName(documentFileName)),
                new XAttribute("format", "IFCnative-stepText"),
                new XElement(StepTextElementName, new XCData(stepText))));

        using var writer = new StreamWriter(path, false, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
        document.Save(writer);
    }

    private static string? ExtractStepText(string xml)
    {
        try
        {
            var document = XDocument.Parse(xml, LoadOptions.PreserveWhitespace);
            var stepText = document
                .Descendants()
                .FirstOrDefault(element => string.Equals(element.Name.LocalName, StepTextElementName, StringComparison.OrdinalIgnoreCase))
                ?.Value;

            if (!string.IsNullOrWhiteSpace(stepText))
            {
                return stepText;
            }

            return document
                .Descendants()
                .FirstOrDefault(element => string.Equals(element.Name.LocalName, "iso-10303-21", StringComparison.OrdinalIgnoreCase))
                ?.Value;
        }
        catch (Exception exception) when (exception is not OutOfMemoryException)
        {
            throw new InvalidDataException("The ifcXML file could not be parsed as XML.", exception);
        }
    }

    private static string ExtractSchema(string stepText)
    {
        const string marker = "FILE_SCHEMA";
        var markerIndex = stepText.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
        if (markerIndex < 0)
        {
            return "UNKNOWN";
        }

        var quoteStart = stepText.IndexOf('\'', markerIndex);
        if (quoteStart < 0)
        {
            return "UNKNOWN";
        }

        var quoteEnd = stepText.IndexOf('\'', quoteStart + 1);
        return quoteEnd > quoteStart
            ? stepText[(quoteStart + 1)..quoteEnd]
            : "UNKNOWN";
    }
}
