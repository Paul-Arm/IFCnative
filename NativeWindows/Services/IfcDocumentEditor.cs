using System.Globalization;

namespace IFCnative.NativeWindows.Services;

public static class IfcDocumentEditor
{
    public static IfcDocument UpdatePlacement(IfcDocument document, int productId, string xText, string yText, string zText)
    {
        if (!document.PlacementsByEntity.TryGetValue(productId, out var placement)
            || !document.EntityById.TryGetValue(placement.PointId, out var point))
        {
            return document;
        }

        var x = ParseCoordinate(xText, placement.X);
        var y = ParseCoordinate(yText, placement.Y);
        var z = ParseCoordinate(zText, placement.Z);

        while (point.Arguments.Count == 0)
        {
            point.Arguments.Add("(0.,0.,0.)");
        }

        point.Arguments[0] = $"({FormatCoordinate(x)},{FormatCoordinate(y)},{FormatCoordinate(z)})";
        return IfcStepParser.Parse(document.ToStepText(), document.FileName);
    }

    private static double ParseCoordinate(string value, double fallback)
    {
        return double.TryParse(value.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out var number)
            ? number
            : fallback;
    }

    private static string FormatCoordinate(double value)
    {
        return value.ToString("0.########", CultureInfo.InvariantCulture);
    }
}
