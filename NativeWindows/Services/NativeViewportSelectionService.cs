namespace IFCnative.NativeWindows.Services;

public sealed record NativeViewportMeshSelection(int ProductSourceId, int PrimitiveSourceId, string Status);

public static class NativeViewportSelectionService
{
    public static NativeViewportMeshSelection? ResolveMeshSelection(IfcDocument document, IfcPreviewMesh mesh, string backendStatus)
    {
        if (!document.MemoryModel.ObjectsBySourceId.ContainsKey(mesh.ProductSourceId))
        {
            return null;
        }

        if (!document.EntityById.ContainsKey(mesh.ProductSourceId))
        {
            return null;
        }

        return new NativeViewportMeshSelection(
            mesh.ProductSourceId,
            mesh.PrimitiveSourceId,
            $"Selected product #{mesh.ProductSourceId} from native mesh #{mesh.PrimitiveSourceId}. {backendStatus}");
    }
}
