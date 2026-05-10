using System.Text.RegularExpressions;
using IFCnative.NativeWindows;
using IFCnative.NativeWindows.Models;

namespace IFCnative.NativeWindows.Services;

public static partial class IfcStepParser
{
    public static IfcDocument Parse(string text, string fileName)
    {
        var document = new IfcDocument
        {
            FileName = fileName,
            HeaderText = ExtractSection(text, "HEADER") ?? DefaultHeader(fileName),
            Schema = ExtractSchema(text) ?? "UNKNOWN",
        };

        RunPreflight(text, document.Diagnostics);

        var data = ExtractSection(text, "DATA");
        if (data is null)
        {
            document.Diagnostics.Error("DATA section was not found.");
            return document;
        }

        foreach (var entity in ReadEntities(data, document.Diagnostics))
        {
            document.Entities.Add(entity);
            document.EntityById[entity.Id] = entity;

            if (!document.EntitiesByType.TryGetValue(entity.Type, out var bucket))
            {
                bucket = [];
                document.EntitiesByType[entity.Type] = bucket;
            }

            bucket.Add(entity);

            foreach (var argument in entity.Arguments)
            {
                foreach (var targetId in StepArgumentReader.ReadReferences(argument))
                {
                    if (!document.IncomingReferences.TryGetValue(targetId, out var incoming))
                    {
                        incoming = [];
                        document.IncomingReferences[targetId] = incoming;
                    }

                    incoming.Add(entity);
                }
            }
        }

        BuildSpatialTree(document);
        document.Diagnostics.Info($"Loaded {document.Entities.Count:N0} STEP entities.");
        document.Diagnostics.Info($"Detected schema: {document.Schema}.");

        return document;
    }

    public static IfcDocument CreateSample()
    {
        return Parse(SampleIfcText, "IFCnative Native Sample.ifc");
    }

    private static void RunPreflight(string text, IfcDiagnostics diagnostics)
    {
        if (!text.TrimStart().StartsWith("ISO-10303-21;", StringComparison.OrdinalIgnoreCase))
        {
            diagnostics.Error("File does not start with ISO-10303-21.");
        }

        if (!text.Contains("HEADER;", StringComparison.OrdinalIgnoreCase))
        {
            diagnostics.Error("HEADER section is missing.");
        }

        if (!text.Contains("DATA;", StringComparison.OrdinalIgnoreCase))
        {
            diagnostics.Error("DATA section is missing.");
        }

        if (!text.TrimEnd().EndsWith("END-ISO-10303-21;", StringComparison.OrdinalIgnoreCase))
        {
            diagnostics.Error("File does not end with END-ISO-10303-21.");
        }
    }

    private static string? ExtractSection(string text, string sectionName)
    {
        var pattern = $@"{sectionName}\s*;(.*?)ENDSEC\s*;";
        var match = Regex.Match(text, pattern, RegexOptions.IgnoreCase | RegexOptions.Singleline);
        return match.Success ? $"{sectionName.ToUpperInvariant()};{match.Groups[1].Value}ENDSEC;" : null;
    }

    private static string? ExtractSchema(string text)
    {
        var match = SchemaRegex().Match(text);
        return match.Success ? match.Groups[1].Value.Trim().Trim('\'') : null;
    }

    private static IEnumerable<IfcEntity> ReadEntities(string data, IfcDiagnostics diagnostics)
    {
        var index = 0;
        while (index < data.Length)
        {
            SkipWhitespaceAndComments(data, ref index);
            if (index >= data.Length)
            {
                yield break;
            }

            if (data[index] != '#')
            {
                index++;
                continue;
            }

            var idStart = ++index;
            while (index < data.Length && char.IsDigit(data[index]))
            {
                index++;
            }

            if (!int.TryParse(data[idStart..index], out var id))
            {
                diagnostics.Warn($"Skipped malformed STEP id near offset {idStart}.");
                continue;
            }

            SkipWhitespaceAndComments(data, ref index);
            if (index >= data.Length || data[index] != '=')
            {
                diagnostics.Warn($"Skipped #{id}; missing '='.");
                continue;
            }

            index++;
            SkipWhitespaceAndComments(data, ref index);

            var typeStart = index;
            while (index < data.Length && (char.IsLetterOrDigit(data[index]) || data[index] == '_'))
            {
                index++;
            }

            var type = data[typeStart..index].Trim().ToUpperInvariant();
            SkipWhitespaceAndComments(data, ref index);

            if (index >= data.Length || data[index] != '(')
            {
                diagnostics.Warn($"Skipped #{id}; missing argument list.");
                continue;
            }

            var args = ReadParenthesized(data, ref index);
            while (index < data.Length && data[index] != ';')
            {
                index++;
            }

            if (index < data.Length && data[index] == ';')
            {
                index++;
            }

            var entity = new IfcEntity { Id = id, Type = type };
            entity.Arguments.AddRange(StepArgumentReader.SplitTopLevel(args));
            yield return entity;
        }
    }

    private static void SkipWhitespaceAndComments(string text, ref int index)
    {
        while (index < text.Length)
        {
            if (char.IsWhiteSpace(text[index]))
            {
                index++;
                continue;
            }

            if (index + 1 < text.Length && text[index] == '/' && text[index + 1] == '*')
            {
                index += 2;
                while (index + 1 < text.Length && (text[index] != '*' || text[index + 1] != '/'))
                {
                    index++;
                }

                index = Math.Min(text.Length, index + 2);
                continue;
            }

            break;
        }
    }

    private static string ReadParenthesized(string text, ref int index)
    {
        var start = index + 1;
        var depth = 0;
        var inString = false;

        for (; index < text.Length; index++)
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
            }
            else if (character == ')')
            {
                depth--;
                if (depth == 0)
                {
                    var value = text[start..index];
                    index++;
                    return value;
                }
            }
        }

        return text[start..];
    }

    private static void BuildSpatialTree(IfcDocument document)
    {
        var childrenByParent = new Dictionary<int, List<(int ChildId, string Relation)>>();
        var childIds = new HashSet<int>();

        foreach (var rel in document.Entities.Where(entity => entity.Type == "IFCRELAGGREGATES"))
        {
            var parent = StepArgumentReader.ReadReferences(rel.Arguments.ElementAtOrDefault(4) ?? string.Empty).FirstOrDefault();
            var children = StepArgumentReader.ReadReferences(rel.Arguments.ElementAtOrDefault(5) ?? string.Empty);
            AddChildren(childrenByParent, childIds, parent, children, "aggregate");
        }

        foreach (var rel in document.Entities.Where(entity => entity.Type == "IFCRELCONTAINEDINSPATIALSTRUCTURE"))
        {
            var parent = StepArgumentReader.ReadReferences(rel.Arguments.ElementAtOrDefault(5) ?? string.Empty).FirstOrDefault();
            var children = StepArgumentReader.ReadReferences(rel.Arguments.ElementAtOrDefault(4) ?? string.Empty);
            AddChildren(childrenByParent, childIds, parent, children, "contains");
        }

        var roots = document.Entities
            .Where(entity => (entity.Type is "IFCPROJECT" or "IFCPROJECTLIBRARY") || IsSpatial(entity.Type))
            .Where(entity => !childIds.Contains(entity.Id))
            .OrderBy(entity => entity.Type == "IFCPROJECT" ? 0 : 1)
            .ThenBy(entity => entity.Id);

        foreach (var root in roots)
        {
            document.SpatialRoots.Add(BuildNode(document, root, "root", childrenByParent, []));
        }
    }

    private static void AddChildren(
        Dictionary<int, List<(int ChildId, string Relation)>> childrenByParent,
        HashSet<int> childIds,
        int parent,
        IEnumerable<int> children,
        string relation)
    {
        if (parent == 0)
        {
            return;
        }

        if (!childrenByParent.TryGetValue(parent, out var bucket))
        {
            bucket = [];
            childrenByParent[parent] = bucket;
        }

        foreach (var child in children)
        {
            bucket.Add((child, relation));
            childIds.Add(child);
        }
    }

    private static IfcTreeNode BuildNode(
        IfcDocument document,
        IfcEntity entity,
        string relation,
        Dictionary<int, List<(int ChildId, string Relation)>> childrenByParent,
        HashSet<int> path)
    {
        var node = new IfcTreeNode(entity, relation);
        if (!path.Add(entity.Id))
        {
            return node;
        }

        if (childrenByParent.TryGetValue(entity.Id, out var children))
        {
            foreach (var child in children.OrderBy(child => child.ChildId))
            {
                if (document.EntityById.TryGetValue(child.ChildId, out var childEntity))
                {
                    node.Children.Add(BuildNode(document, childEntity, child.Relation, childrenByParent, path));
                }
            }
        }

        path.Remove(entity.Id);
        return node;
    }

    private static bool IsSpatial(string type)
    {
        return type is "IFCSITE" or "IFCBUILDING" or "IFCBUILDINGSTOREY" or "IFCSPACE" or "IFCFACILITY"
            or "IFCFACILITYPART" or "IFCROAD" or "IFCRAILWAY" or "IFCBRIDGE";
    }

    private static string DefaultHeader(string fileName)
    {
        return $"""
HEADER;
FILE_DESCRIPTION(('ViewDefinition [Native IFCnative]'),'2;1');
FILE_NAME('{fileName}','2026-05-10T00:00:00',('IFCnative'),('IFCnative'),'IFCnative Native Windows','IFCnative','');
FILE_SCHEMA(('IFC4X3_ADD2'));
ENDSEC;
""";
    }

    private const string SampleIfcText = """
ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');
FILE_NAME('IFCnative Native Sample.ifc','2026-05-10T00:00:00',('IFCnative'),('IFCnative'),'IFCnative Native Windows','IFCnative','');
FILE_SCHEMA(('IFC4X3_ADD2'));
ENDSEC;
DATA;
#1= IFCPROJECT('2XQ2f8a9b2ff4l$IFCnative',$,'IFCnative Native Sample',$,$,$,$,$,$);
#10= IFCSITE('0Site8a9b2ff4l$IFCnative',$,'Sample Site',$,$,$,$,$,$,$,$,$,$,$);
#20= IFCBUILDING('0Build8a9b2ff4l$IFCnative',$,'Sample Building',$,$,$,$,$,$,$,$,$);
#30= IFCBUILDINGSTOREY('0Level8a9b2ff4l$IFCnative',$,'Level 0',$,$,$,$,$,$);
#40= IFCBUILDINGELEMENTPROXY('0Proxy8a9b2ff4l$IFCnative',$,'Sample Inspection Block',$,$,$,$,$,$);
#50= IFCRELAGGREGATES('1AggProjectSite000000000',$,'Project Site',$,#1,(#10));
#51= IFCRELAGGREGATES('1AggSiteBuilding00000000',$,'Site Building',$,#10,(#20));
#52= IFCRELAGGREGATES('1AggBuildingLevel000000',$,'Building Level',$,#20,(#30));
#53= IFCRELCONTAINEDINSPATIALSTRUCTURE('1ContLevelProxy0000000',$,'Level Contains Proxy',$,(#40),#30);
#60= IFCPROPERTYSET('1PsetProxy000000000000',$,'Pset_IFCnative',$,(#61,#62));
#61= IFCPROPERTYSINGLEVALUE('ReviewStatus',$,'Native editable shell',$);
#62= IFCPROPERTYSINGLEVALUE('Source',$,'Generated sample',$);
#63= IFCRELDEFINESBYPROPERTIES('1RelPsetProxy00000000',$,'Proxy Properties',$,(#40),#60);
ENDSEC;
END-ISO-10303-21;
""";

    [GeneratedRegex(@"FILE_SCHEMA\s*\(\s*\(\s*([^)]+?)\s*\)\s*\)", RegexOptions.IgnoreCase | RegexOptions.Singleline)]
    private static partial Regex SchemaRegex();
}
