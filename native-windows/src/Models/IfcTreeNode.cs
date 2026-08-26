namespace IFCnative.NativeWindows.Models;

public sealed class IfcTreeNode
{
    public IfcTreeNode(IfcEntity entity, string relation)
    {
        Entity = entity;
        Relation = relation;
    }

    public IfcEntity Entity { get; }

    public string Relation { get; }

    public List<IfcTreeNode> Children { get; } = [];

    public string Label => $"{Entity.DisplayName}  ({Entity.TypeName()})";

    public string DisplayName => Entity.DisplayName;

    public string TypeLabel => Entity.TypeName();
}

public static class IfcEntityDisplayExtensions
{
    public static string TypeName(this IfcEntity entity)
    {
        return entity.Type.StartsWith("IFC", StringComparison.OrdinalIgnoreCase)
            ? entity.Type[3..]
            : entity.Type;
    }
}

