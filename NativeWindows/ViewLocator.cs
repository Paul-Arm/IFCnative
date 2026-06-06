using Avalonia.Controls;
using Avalonia.Controls.Templates;
using Dock.Model.Core;

namespace IFCnative.NativeWindows;

public sealed class ViewLocator : IDataTemplate
{
    public Control Build(object? data)
    {
        if (data is null)
        {
            return new TextBlock { Text = string.Empty };
        }

        if (data is IDockable { Context: { } context })
        {
            var control = Build(context);
            control.DataContext = context;
            return control;
        }

        var type = ResolveViewType(data);

        return type is null
            ? new TextBlock { Text = $"No view for {data.GetType().Name}" }
            : (Control)Activator.CreateInstance(type)!;
    }

    public bool Match(object? data)
    {
        if (data is IDockable dockable)
        {
            return dockable.Context is not null;
        }

        if (data is null)
        {
            return false;
        }

        return ResolveViewType(data) is not null;
    }

    private static Type? ResolveViewType(object data)
    {
        var viewModelType = data.GetType();
        if (viewModelType.Namespace is null || !viewModelType.Namespace.StartsWith("IFCnative.NativeWindows.ViewModels", StringComparison.Ordinal))
        {
            return null;
        }

        var name = viewModelType.FullName?
            .Replace(".ViewModels.", ".Views.", StringComparison.Ordinal)
            .Replace("ViewModel", "View", StringComparison.Ordinal);

        return name is null ? null : viewModelType.Assembly.GetType(name) ?? Type.GetType(name);
    }
}
