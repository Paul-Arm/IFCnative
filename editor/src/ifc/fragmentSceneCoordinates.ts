import type { Matrix4, Object3D, Vector3 } from "three";

/**
 * Converts a point from the shared Fragments scene into one model's original
 * IFC world coordinates. The model object transform is the coordination
 * offset applied by FragmentsModels.autoCoordinate.
 */
export function fragmentScenePointToIfcWorld(
  point: Vector3,
  modelObject: Object3D,
  modelToIfcWorld: Matrix4 | null,
) {
  const result = point.clone();
  modelObject.updateWorldMatrix(true, false);
  modelObject.worldToLocal(result);
  return modelToIfcWorld ? result.applyMatrix4(modelToIfcWorld) : result;
}

/** Converts a model-local point into the shared coordinated scene. */
export function fragmentModelPointToScene(
  point: Vector3,
  modelObject: Object3D,
) {
  const result = point.clone();
  modelObject.updateWorldMatrix(true, false);
  return modelObject.localToWorld(result);
}
