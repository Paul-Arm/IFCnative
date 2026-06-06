using System.Text;
using System.Text.RegularExpressions;
using IFCnative.NativeWindows.Models;
using Microsoft.Extensions.Logging.Abstractions;
using Xbim.Common.Configuration;
using Xbim.Common.Step21;
using Xbim.Ifc;
using Xbim.IO;
using Xbim.ModelGeometry.Scene;

namespace IFCnative.NativeWindows.Services;

public static class XbimIfcDocumentService
{
    private static readonly Lock ConfigurationLock = new();
    private static readonly XbimEditorCredentials EditorCredentials = CreateEditorCredentials();
    private static readonly Regex FileSchemaRegex = new(
        @"FILE_SCHEMA\s*\(\s*\((?<schemas>.*?)\)\s*\)",
        RegexOptions.IgnoreCase | RegexOptions.Singleline | RegexOptions.CultureInvariant);
    private static readonly Regex QuotedSchemaRegex = new(
        @"'(?<schema>[^']+)'",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private static bool configurationChecked;

    public static void ConfigureToolkit()
    {
        ConfigureXbim();
    }

    public static IfcDocument OpenPath(string path, IProgress<string>? progress = null)
    {
        ConfigureXbim();
        progress?.Report($"Opening {Path.GetFileName(path)} with xBIM...");
        var store = IfcStore.Open(
            path,
            EditorCredentials,
            ifcDatabaseSizeThreshHold: null,
            progDelegate: null,
            accessMode: XbimDBAccess.ReadWrite);
        return ProjectStore(store, Path.GetFileName(path), progress);
    }

    public static IfcDocument OpenText(string stepText, string fileName, IProgress<string>? progress = null)
    {
        ConfigureXbim();
        progress?.Report($"Opening {fileName} with xBIM...");
        var store = OpenStoreFromText(stepText, fileName);
        return ProjectStore(store, fileName, progress);
    }

    public static IfcDocument CreateSample(IProgress<string>? progress = null)
    {
        return OpenText(SampleIfcText, "IFCnative xBIM Sample.ifc", progress);
    }

    public static IfcStore EnsureStore(IfcDocument document)
    {
        if (document.XbimStore is not null)
        {
            return document.XbimStore;
        }

        document.XbimStore = OpenStoreFromText(IfcStepWriter.Serialize(document), document.FileName);
        document.Diagnostics.Info("xBIM store rebuilt from the current STEP document state.");
        return document.XbimStore;
    }

    public static Xbim3DModelContext EnsureGeometryContext(IfcDocument document)
    {
        if (document.XbimGeometryContext is not null)
        {
            return document.XbimGeometryContext;
        }

        var store = EnsureStore(document);
        var context = new Xbim3DModelContext(store);
        context.CreateContext();
        document.XbimGeometryContext = context;
        document.GeometryBackendStatus = "Using xBIM geometry; BRep and mapped representations are tessellated by xBIM/OpenCascade.";
        return context;
    }

    public static Xbim3DModelContext? TryGetGeometryContext(IfcDocument document)
    {
        return document.XbimGeometryContext;
    }

    public static bool HasGeometryContext(IfcDocument document)
    {
        return document.XbimGeometryContext is not null;
    }

    public static void InvalidateGeometryContext(IfcDocument document)
    {
        document.XbimGeometryContext = null;
        document.GeometryBackendStatus = "xBIM geometry is dirty; regenerate the geometry context before meshing.";
    }

    public static string NormalizeForExport(IfcDocument document)
    {
        var store = EnsureStore(document);
        return SaveStoreAsIfcText(store);
    }

    public static IfcDocument SynchronizeDocument(IfcDocument document, IProgress<string>? progress = null)
    {
        progress?.Report($"Synchronizing {document.FileName} with xBIM...");
        var store = OpenStoreFromText(IfcStepWriter.Serialize(document), document.FileName);
        var synchronized = ProjectStore(store, document.FileName, progress);
        synchronized.Diagnostics.Info("xBIM synchronized the editable store.");
        return synchronized;
    }

    public static IfcDocument ProjectStore(IfcStore store, string fileName, IProgress<string>? progress = null)
    {
        progress?.Report("Projecting IFC from xBIM...");
        var document = XbimDocumentProjector.Project(store, fileName);
        document.XbimStore = store;
        document.GeometryBackendStatus = "Using xBIM geometry; BRep and mapped representations are tessellated by xBIM/OpenCascade.";
        document.Diagnostics.Info($"xBIM opened {fileName} as {store.SchemaVersion}.");
        document.Diagnostics.Info("xBIM is now the IFC data model, import/export and geometry runtime; UI structures are projections.");
        return document;
    }

    private static IfcStore OpenStoreFromText(string stepText, string fileName)
    {
        ConfigureXbim();
        var bytes = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false).GetBytes(stepText);
        var stream = new MemoryStream(bytes);
        return IfcStore.Open(
            stream,
            StorageType.Ifc,
            DetectSchema(stepText),
            XbimModelType.MemoryModel,
            editorDetails: EditorCredentials,
            accessMode: XbimDBAccess.ReadWrite);
    }

    private static string SaveStoreAsIfcText(IfcStore store)
    {
        using var stream = new MemoryStream();
        store.SaveAsIfc(stream);
        return new UTF8Encoding(encoderShouldEmitUTF8Identifier: false).GetString(stream.ToArray());
    }

    private static XbimSchemaVersion DetectSchema(string stepText)
    {
        var headerEnd = stepText.IndexOf("ENDSEC;", StringComparison.OrdinalIgnoreCase);
        var header = headerEnd >= 0
            ? stepText[..Math.Min(stepText.Length, headerEnd + "ENDSEC;".Length)]
            : stepText[..Math.Min(stepText.Length, 4096)];
        var fileSchema = FileSchemaRegex.Match(header);
        if (fileSchema.Success)
        {
            foreach (Match schemaMatch in QuotedSchemaRegex.Matches(fileSchema.Groups["schemas"].Value))
            {
                var schema = schemaMatch.Groups["schema"].Value.Trim();
                var version = DetectSchemaVersion(schema);
                if (version is not null)
                {
                    return version.Value;
                }
            }
        }

        return DetectSchemaVersion(header) ?? XbimSchemaVersion.Ifc4;
    }

    private static XbimSchemaVersion? DetectSchemaVersion(string schemaText)
    {
        if (schemaText.Contains("IFC4X3", StringComparison.OrdinalIgnoreCase))
        {
            return XbimSchemaVersion.Ifc4x3;
        }

        if (schemaText.Contains("IFC4", StringComparison.OrdinalIgnoreCase))
        {
            return XbimSchemaVersion.Ifc4;
        }

        if (schemaText.Contains("IFC2X3", StringComparison.OrdinalIgnoreCase))
        {
            return XbimSchemaVersion.Ifc2X3;
        }

        return null;
    }

    private static void ConfigureXbim()
    {
        if (configurationChecked)
        {
            return;
        }

        lock (ConfigurationLock)
        {
            if (configurationChecked)
            {
                return;
            }

            if (!XbimServices.Current.IsConfigured && !XbimServices.Current.IsBuilt)
            {
                XbimServices.Current.ConfigureServices(services => services.AddXbimToolkit(configuration => configuration.AddLoggerFactory(NullLoggerFactory.Instance)));
            }

            configurationChecked = true;
        }
    }

    private static XbimEditorCredentials CreateEditorCredentials()
    {
        var version = typeof(XbimIfcDocumentService).Assembly.GetName().Version?.ToString(3) ?? "0.1.0";
        var userName = string.IsNullOrWhiteSpace(Environment.UserName) ? "IFCnative user" : Environment.UserName;

        return new XbimEditorCredentials
        {
            ApplicationDevelopersName = "IFCnative",
            ApplicationFullName = "IFCnative Native Windows",
            ApplicationIdentifier = "IFCnative.NativeWindows",
            ApplicationVersion = version,
            EditorsFamilyName = userName,
            EditorsGivenName = "Native",
            EditorsOrganisationName = "IFCnative",
        };
    }

    private const string SampleIfcText = """
ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');
FILE_NAME('IFCnative xBIM Sample.ifc','2026-05-10T00:00:00',('IFCnative'),('IFCnative'),'IFCnative Native Windows','IFCnative','');
FILE_SCHEMA(('IFC4X3_ADD2'));
ENDSEC;
DATA;
#1= IFCPROJECT('2XQ2f8a9b2ff4l$IFCnative',$,'IFCnative xBIM Sample',$,$,$,$,$,$);
#10= IFCSITE('0Site8a9b2ff4l$IFCnative',$,'Sample Site',$,$,$,$,$,$,$,$,$,$,$);
#20= IFCBUILDING('0Build8a9b2ff4l$IFCnative',$,'Sample Building',$,$,$,$,$,$,$,$,$);
#30= IFCBUILDINGSTOREY('0Level8a9b2ff4l$IFCnative',$,'Level 0',$,$,$,$,$,$);
#40= IFCBUILDINGELEMENTPROXY('0Proxy8a9b2ff4l$IFCnative',$,'Sample Inspection Block',$,$,#100,#110,$,$);
#50= IFCRELAGGREGATES('1AggProjectSite000000000',$,'Project Site',$,#1,(#10));
#51= IFCRELAGGREGATES('1AggSiteBuilding00000000',$,'Site Building',$,#10,(#20));
#52= IFCRELAGGREGATES('1AggBuildingLevel000000',$,'Building Level',$,#20,(#30));
#53= IFCRELCONTAINEDINSPATIALSTRUCTURE('1ContLevelProxy0000000',$,'Level Contains Proxy',$,(#40),#30);
#60= IFCPROPERTYSET('1PsetProxy000000000000',$,'Pset_IFCnative',$,(#61,#62));
#61= IFCPROPERTYSINGLEVALUE('ReviewStatus',$,IFCLABEL('Native editable shell'),$);
#62= IFCPROPERTYSINGLEVALUE('Source',$,IFCLABEL('Generated sample'),$);
#63= IFCRELDEFINESBYPROPERTIES('1RelPsetProxy00000000',$,'Proxy Properties',$,(#40),#60);
#100= IFCLOCALPLACEMENT($,#101);
#101= IFCAXIS2PLACEMENT3D(#102,$,$);
#102= IFCCARTESIANPOINT((0.,0.,0.));
#110= IFCPRODUCTDEFINITIONSHAPE($,$,(#120));
#120= IFCSHAPEREPRESENTATION(#130,'Body','SweptSolid',(#140));
#130= IFCGEOMETRICREPRESENTATIONCONTEXT('Body','Model',3,1.E-05,$,$);
#140= IFCEXTRUDEDAREASOLID(#150,#160,#170,2.4);
#150= IFCRECTANGLEPROFILEDEF(.AREA.,'Sample rectangle',#180,2.6,1.4);
#160= IFCAXIS2PLACEMENT3D(#190,$,$);
#170= IFCDIRECTION((0.,0.,1.));
#180= IFCAXIS2PLACEMENT2D(#200,$);
#190= IFCCARTESIANPOINT((0.,0.,0.));
#200= IFCCARTESIANPOINT((0.,0.));
ENDSEC;
END-ISO-10303-21;
""";
}
