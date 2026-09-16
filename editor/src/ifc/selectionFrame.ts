import { Box3, Box3Helper, Group, Matrix4, Vector3 } from "three";
import type { MeshData } from "@thatopen/fragments";

/** Imported tessellations can bake their rotation into the vertices. Try frames
 * from the largest faces as well as the placement axes, keeping the tightest.
 * Bound the candidate count so detailed meshes remain cheap to select. */
function fitGeometryFrame(meshes: MeshData[], inverse: Matrix4) {
  const points: Vector3[] = [];
  const faces: { area: number; a: Vector3; b: Vector3; c: Vector3 }[] = [];
  const ab = new Vector3();
  const ac = new Vector3();
  for (const mesh of meshes) {
    if (!mesh.positions) continue;
    const relative = new Matrix4().multiplyMatrices(inverse, mesh.transform);
    const offset = points.length;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      points.push(new Vector3().fromArray(mesh.positions, i).applyMatrix4(relative));
    }
    const count = mesh.indices?.length ?? mesh.positions.length / 3;
    for (let i = 0; i + 2 < count; i += 3) {
      const a = points[offset + (mesh.indices?.[i] ?? i)];
      const b = points[offset + (mesh.indices?.[i + 1] ?? i + 1)];
      const c = points[offset + (mesh.indices?.[i + 2] ?? i + 2)];
      if (!a || !b || !c) continue;
      const area = ab.subVectors(b, a).cross(ac.subVectors(c, a)).lengthSq();
      if (!Number.isFinite(area) || area <= 1e-20 || (faces.length === 8 && area <= faces[7].area)) continue;
      faces.push({ area, a, b, c });
      faces.sort((left, right) => right.area - left.area);
      if (faces.length > 8) faces.pop();
    }
  }
  const bounds = new Box3().setFromPoints(points);
  if (bounds.isEmpty() || ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)) return null;
  // Recenter on the CPU before orienting, including meshes with survey vertices.
  const center = bounds.getCenter(new Vector3());
  for (const point of points) point.sub(center);
  bounds.translate(center.clone().negate());
  let best = { bounds, rotation: new Matrix4() };
  const size = bounds.getSize(new Vector3());
  let volume = size.x * size.y * size.z;
  let surface = size.x * size.y + size.y * size.z + size.z * size.x;
  const tolerance = Math.max(size.length() ** 3 * 1e-12, 1e-18);
  const projected = new Vector3();
  for (const { a, b, c } of faces) {
    const normal = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).normalize();
    for (const [start, end] of [[a, b], [b, c], [c, a]]) {
      const x = new Vector3().subVectors(end, start).normalize();
      const y = new Vector3().crossVectors(normal, x).normalize();
      const rotation = new Matrix4().makeBasis(x, y, normal);
      const toLocal = rotation.clone().transpose();
      const candidate = new Box3();
      for (const point of points) candidate.expandByPoint(projected.copy(point).applyMatrix4(toLocal));
      candidate.getSize(size);
      const nextVolume = size.x * size.y * size.z;
      const nextSurface = size.x * size.y + size.y * size.z + size.z * size.x;
      if (nextVolume < volume - tolerance || (Math.abs(nextVolume - volume) <= tolerance && nextSurface < surface - tolerance)) {
        best = { bounds: candidate, rotation };
        volume = nextVolume;
        surface = nextSurface;
      }
    }
  }
  return { bounds: best.bounds, transform: best.rotation.setPosition(center) };
}

/** Keep bounds in the item's own frame: a scene-axis box loses its rotation. */
export class SelectionFrame extends Group {
  reset() {
    this.traverse((object) => {
      if (object instanceof Box3Helper) object.dispose();
    });
    this.clear();
    this.visible = false;
  }

  addItems(items: MeshData[][], modelWorld: Matrix4) {
    for (const meshes of items) {
      const first = meshes.find((mesh) => mesh.positions?.length);
      if (!first) continue;
      // Worker messages carry matrix elements without Matrix4's prototype.
      const itemTransform = new Matrix4().copy(first.transform);
      if (!itemTransform.elements.every(Number.isFinite) || itemTransform.determinant() === 0) continue;
      const inverse = itemTransform.clone().invert();
      const fitted = fitGeometryFrame(meshes, inverse);
      if (!fitted) continue;

      // Box3Helper updates its own position/scale; rotation belongs on its parent.
      // Small local vertices also retain precision in georeferenced scenes.
      const placement = new Group();
      placement.matrixAutoUpdate = false;
      placement.matrix.multiplyMatrices(modelWorld, itemTransform).multiply(fitted.transform);
      const box = new Box3Helper(fitted.bounds, 0xffb703);
      for (const material of Array.isArray(box.material) ? box.material : [box.material]) {
        material.depthTest = false;
        material.depthWrite = false;
      }
      box.renderOrder = 49;
      placement.add(box);
      this.add(placement);
    }
    this.visible = this.children.length > 0;
  }
}
