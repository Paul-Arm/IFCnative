using System.Reflection;

namespace IFCnative.NativeWindows.Services;

public sealed record NativeDependencyStatus(
    string Name,
    string Version,
    string AssemblyName,
    string Purpose,
    bool CanResolve)
{
    public string Label => CanResolve
        ? $"Ready: {Name} {Version} ({Purpose})"
        : $"Missing: {Name} {Version} ({Purpose})";
}

public static class NativeDependencyCatalog
{
    private static readonly NativeDependencyStatus[] PlannedDependencies =
    [
        new("xBIM Essentials", "6.0.587", "Xbim.Ifc", "IFC/ifcZIP document access and typed xBIM model bridge", false),
        new("xBIM Geometry", "6.3.873-netcore", "Xbim.Geometry.Engine.Interop", "native geometry context and tessellation backend", false),
        new("xBIM IDS Validator", "1.0.187", "Xbim.IDS.Validator.Core", "IDS validation package bridge", false),
        new("HelixToolkit WPF SharpDX", "3.1.2", "HelixToolkit.Wpf.SharpDX", "native viewport rendering backend", false),
        new("Xceed AvalonDock", "5.1.26166.7861", "Xceed.Wpf.AvalonDock", "dockable native workbench panes", false),
        new("MSAGL WPF GraphControl", "1.2.1", "Microsoft.Msagl.WpfGraphControl", "native relationship graph layout/control backend", false),
    ];

    public static IReadOnlyList<NativeDependencyStatus> GetStatuses()
    {
        return PlannedDependencies
            .Select(dependency => dependency with { CanResolve = CanResolve(dependency.AssemblyName) })
            .ToList();
    }

    public static bool CanResolve(string assemblyName)
    {
        if (AppDomain.CurrentDomain.GetAssemblies().Any(assembly => AssemblyNameMatches(assembly, assemblyName)))
        {
            return true;
        }

        try
        {
            Assembly.Load(new AssemblyName(assemblyName));
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static bool AssemblyNameMatches(Assembly assembly, string assemblyName)
    {
        return string.Equals(assembly.GetName().Name, assemblyName, StringComparison.OrdinalIgnoreCase);
    }
}
