import assert from "node:assert/strict";
import { parentPort } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { Box3, Vector3 } from "three";
import { IfcImporter, SingleThreadedFragmentsModel } from "@thatopen/fragments";
import { configureFragmentImporter } from "../../src/ifc/fragmentImporter";
import { createNativeSampleDocument, extractNativeSubsetIfc, splitNativeBodyByPlane, updateNativePlacement, updateNativePlacementRotation } from "../../src/ifc/nativeDocument";

async function verify() {
  const sample = createNativeSampleDocument();
  const product = sample.entities.find((entity) => entity.type === "IFCBUILTELEMENT")!;
  let source = updateNativePlacement(sample, product.id, { x: "32555405.364", y: "5792521.487", z: "35" });
  source = updateNativePlacementRotation(source, product.id, { axis: { x: 0, y: 0, z: 1 }, refDirection: { x: 1, y: 1, z: 0 } });
  let modelCounter = 0;
  const convert = async (text: string) => {
    const importer = new IfcImporter();
    configureFragmentImporter(importer, fileURLToPath(new URL("../../node_modules/web-ifc/", import.meta.url)));
    return new SingleThreadedFragmentsModel(`split-${++modelCounter}`, await importer.process({ bytes: new TextEncoder().encode(text), raw: true }), true);
  };
  const bounds = (model: SingleThreadedFragmentsModel, id: number) => {
    const box = new Box3();
    const [x, y, z] = model.getCoordinates();
    for (const mesh of model.getItemsGeometry([id]).flat()) {
      const positions = mesh.positions!;
      for (let i = 0; i < positions.length; i += 3) {
        box.expandByPoint(new Vector3(positions[i], positions[i + 1], positions[i + 2])
          .applyMatrix4(mesh.transform).sub(new Vector3(x, y, z)));
      }
    }
    assert.ok(!box.isEmpty(), `geometry for ${id}`);
    return box;
  };
  const originalModel = await convert(extractNativeSubsetIfc(source, [product.id])!.text);
  const original = bounds(originalModel, product.id);
  const center = original.getCenter(new Vector3());
  const split = splitNativeBodyByPlane(source, product.id, { point: { x: center.x, y: -center.z, z: center.y }, normal: { x: 1, y: 0, z: 0 } })!;
  assert.ok(split);
  const splitModel = await convert(extractNativeSubsetIfc(split.document, split.partIds)!.text);
  try {
    const halves = split.partIds.map((id) => bounds(splitModel, id)).sort((a, b) => a.min.x - b.min.x);
    assert.ok(Math.abs(halves[0].max.x - center.x) < 0.001, JSON.stringify({ original, halves }));
    assert.ok(Math.abs(halves[1].min.x - center.x) < 0.001, JSON.stringify({ original, halves }));
    const union = halves[0].clone().union(halves[1]);
    assert.ok(union.min.distanceTo(original.min) < 0.001, JSON.stringify({ original, halves }));
    assert.ok(union.max.distanceTo(original.max) < 0.001, JSON.stringify({ original, halves }));
  } finally { originalModel.dispose(); splitModel.dispose(); }
}
void verify().then(() => parentPort!.postMessage(true));
