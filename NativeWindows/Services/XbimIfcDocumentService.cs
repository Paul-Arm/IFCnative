using System.Text;
using System.Text.RegularExpressions;
using IFCnative.NativeWindows.Models;
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
        progress?.Report($"Reading {Path.GetFileName(path)}...");
        var loaded = IfcFileLoader.ReadAsync(path, progress).GetAwaiter().GetResult();
        return OpenText(loaded.Text, loaded.FileName, progress);
    }

    public static IfcDocument OpenText(string stepText, string fileName, IProgress<string>? progress = null)
    {
        ConfigureXbim();
        progress?.Report($"Opening {fileName} with xBIM...");
        var store = OpenStoreFromText(stepText, fileName);
        return ProjectStore(store, fileName, progress);
    }

    public static IfcStore EnsureStore(IfcDocument document)
    {
        if (document.XbimStore is not null)
        {
            return document.XbimStore;
        }

        document.XbimStore = OpenStoreFromText(document.ToStepText(), document.FileName);
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

    public static string NormalizeForExport(IfcDocument document)
    {
        var store = EnsureStore(document);
        return SaveStoreAsIfcText(store);
    }

    public static IfcDocument SynchronizeDocument(IfcDocument document, IProgress<string>? progress = null)
    {
        progress?.Report($"Synchronizing {document.FileName} with xBIM...");
        var store = OpenStoreFromText(document.ToStepText(), document.FileName);
        var synchronized = ProjectStore(store, document.FileName, progress);
        synchronized.Diagnostics.Info("xBIM synchronized the editable in-memory model.");
        return synchronized;
    }

    private static IfcDocument ProjectStore(IfcStore store, string fileName, IProgress<string>? progress)
    {
        progress?.Report("Normalizing IFC through xBIM...");
        var normalizedStep = SaveStoreAsIfcText(store);
        var document = IfcStepParser.Parse(normalizedStep, fileName);
        document.XbimStore = store;
        document.GeometryBackendStatus = "Using xBIM geometry; BRep and mapped representations are tessellated by xBIM/OpenCascade.";
        document.Diagnostics.Info($"xBIM opened {fileName} as {store.SchemaVersion}.");
        document.Diagnostics.Info("xBIM is now the IFC import/export and geometry runtime; native STEP structures are UI projections.");
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
                XbimServices.Current.ConfigureServices(services => services.AddXbimToolkit());
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
}
