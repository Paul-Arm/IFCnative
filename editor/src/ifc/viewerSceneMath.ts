import { Box3, Vector3, type Object3D } from "three";

/** The mesh translation is subtracted from the camera on the CPU (float64).
 * Only the small local plane coordinates reach the vertex shader. */
export function gridAnchor(camera: { x: number; z: number }, period = 10) {
  const x = Math.round(camera.x / period) * period;
  const z = Math.round(camera.z / period) * period;
  return { x, z, relativeX: camera.x - x, relativeZ: camera.z - z };
}

export function isFiniteSceneBox(box: Box3) {
  return !box.isEmpty() && [...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite);
}

/** Storey Elevation is often 0 even when its placement is georeferenced.
 * Such metadata must not put the ground far below the actual geometry. */
export function modelGridElevation(box: Box3 | null, storeyElevation?: number) {
  if (!box || !isFiniteSceneBox(box)) return Number.isFinite(storeyElevation) ? storeyElevation! : 0;
  const tolerance = Math.max(1, (box.max.y - box.min.y) * 0.1);
  return Number.isFinite(storeyElevation) && Math.abs(storeyElevation! - box.min.y) <= tolerance
    ? storeyElevation!
    : box.min.y;
}

export function cameraClipping(position: Vector3, target: Vector3) {
  const distance = position.distanceTo(target);
  return {
    near: Math.max(0.001, Math.min(0.1, distance / 10_000)),
    far: Math.max(2_000, distance * 20),
  };
}

export function viewerSyncPolicy(previous: Iterable<string>, next: Iterable<string>) {
  const before = new Set(previous);
  const after = new Set(next);
  const added = [...after].some((id) => !before.has(id));
  const removed = [...before].some((id) => !after.has(id));
  return { fit: added || removed, preserveOrigin: [...after].some((id) => before.has(id)) };
}

/** Shift a coordinated scene without changing any model-local IFC data. */
export function rebaseSceneObjects(objects: Iterable<Object3D>, referencePosition: Vector3, base: number[]) {
  const shift = referencePosition.clone().negate();
  for (const object of objects) {
    object.position.add(shift);
    object.updateWorldMatrix(true, true);
  }
  return { shift, base: base.map((value, index) => index < 3 ? value + shift.getComponent(index) : value) };
}
