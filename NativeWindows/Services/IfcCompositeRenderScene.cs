namespace IFCnative.NativeWindows.Services;

/// <summary>
/// Maps one document session into the composite render-id space: render ids in
/// [BaseId + 1, BaseId + MaxEntityId] belong to this session's entities. Entity
/// labels from different IFC files collide, so the viewport works with offset
/// render ids and translates back on picking/selection.
/// </summary>
public sealed record IfcRenderSessionSlot(string SessionId, int BaseId, int MaxEntityId);

public static class IfcCompositeRenderScene
{
    public sealed record SessionSceneInput(
        string SessionId,
        IfcRenderScene Scene,
        int MaxEntityId,
        bool IsVisible,
        string Label);

    /// <summary>
    /// Merges the per-session scenes into a single viewport scene. Mesh vertex
    /// data is shared (records are copied with an offset ProductId only), so
    /// composition is cheap and re-runs on every visibility or session change.
    /// </summary>
    public static (IfcRenderScene Scene, IReadOnlyList<IfcRenderSessionSlot> Slots) Compose(IReadOnlyList<SessionSceneInput> inputs)
    {
        var slots = new List<IfcRenderSessionSlot>(inputs.Count);
        var nextBase = 0;
        foreach (var input in inputs)
        {
            slots.Add(new IfcRenderSessionSlot(input.SessionId, nextBase, Math.Max(0, input.MaxEntityId)));
            nextBase += Math.Max(0, input.MaxEntityId) + 1;
        }

        var meshes = new List<IfcRenderMesh>();
        var bounds = IfcRenderBounds.Empty;
        var placements = new Dictionary<int, IfcPreviewVertex>();
        var labels = new List<string>();
        var instanceCount = 0;
        var triangleCount = 0;
        for (var index = 0; index < inputs.Count; index++)
        {
            var input = inputs[index];
            if (!input.IsVisible || input.Scene.IsEmpty)
            {
                continue;
            }

            labels.Add(input.Label);
            var baseId = slots[index].BaseId;
            foreach (var mesh in input.Scene.Meshes)
            {
                meshes.Add(baseId == 0 ? mesh : mesh with { ProductId = mesh.ProductId + baseId });
            }

            bounds = bounds.Include(input.Scene.Bounds);
            instanceCount += input.Scene.ShapeInstanceCount;
            triangleCount += input.Scene.TriangleCount;
            if (input.Scene.ProductPlacements is not null)
            {
                foreach (var pair in input.Scene.ProductPlacements)
                {
                    placements[pair.Key + baseId] = pair.Value;
                }
            }
        }

        if (meshes.Count == 0)
        {
            return (IfcRenderScene.Empty("No visible IFC render geometry."), slots);
        }

        var scene = new IfcRenderScene(
            string.Join(" + ", labels),
            meshes,
            bounds,
            instanceCount,
            triangleCount,
            labels.Count == 1
                ? $"{labels[0]}: {meshes.Count:N0} mesh(es), {triangleCount:N0} triangle(s)."
                : $"{labels.Count:N0} files: {meshes.Count:N0} mesh(es), {triangleCount:N0} triangle(s).",
            placements);
        return (scene, slots);
    }

    public static int ToRenderId(IReadOnlyList<IfcRenderSessionSlot> slots, string? sessionId, int entityId)
    {
        if (sessionId is null || entityId <= 0)
        {
            return 0;
        }

        foreach (var slot in slots)
        {
            if (slot.SessionId == sessionId)
            {
                return entityId <= slot.MaxEntityId ? slot.BaseId + entityId : 0;
            }
        }

        return 0;
    }

    public static (string SessionId, int EntityId)? Resolve(IReadOnlyList<IfcRenderSessionSlot> slots, int renderId)
    {
        if (renderId <= 0)
        {
            return null;
        }

        foreach (var slot in slots)
        {
            var entityId = renderId - slot.BaseId;
            if (entityId >= 1 && entityId <= slot.MaxEntityId)
            {
                return (slot.SessionId, entityId);
            }
        }

        return null;
    }
}
