import { Vector3, type Box3, type Object3D } from "three";

interface FragmentBoundsSource {
  object: Object3D;
  getMergedBox(ids: number[]): Promise<Box3>;
}

/** Fragments returns an absolute scene box, including the model's placement. */
export async function getFragmentCutPlaneBounds(model: FragmentBoundsSource, id: number) {
  model.object.updateWorldMatrix(true, false);
  const box = await model.getMergedBox([id]);
  if (box.isEmpty()) return null;
  const center = box.getCenter(new Vector3());
  const diagonal = box.getSize(new Vector3()).length();
  if (![center.x, center.y, center.z, diagonal].every(Number.isFinite)) return null;
  // The diagonal covers the element in every plane orientation; add a margin.
  return { center, size: Math.max(0.1, diagonal * 1.5) };
}
