import assert from "node:assert/strict";
import { parentPort } from "node:worker_threads";
import { configureFragmentImporter } from "../../src/ifc/fragmentImporter";

async function verify() {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { IfcImporter, SingleThreadedFragmentsModel } = await import("@thatopen/fragments");
  const bytes = readFileSync(new URL("../fixtures/attribution/bauwerksmodell-vlrlp.ifc", import.meta.url));
  const wasmPath = fileURLToPath(new URL("../../node_modules/web-ifc/", import.meta.url));
  const convert = async (allAttributes: boolean) => {
    const importer = new IfcImporter();
    configureFragmentImporter(importer, wasmPath);
    if (allAttributes) importer.addAllAttributes();
    return new SingleThreadedFragmentsModel("bridge", await importer.process({ bytes, raw: true }), true);
  };
  const before = await convert(true);
  const after = await convert(false);
  try {
    const meshIds = before.getItemsOfCategories([/^IFCTRIANGULATEDFACESET$/]).IFCTRIANGULATEDFACESET;
    assert.ok(meshIds.length > 0);
    const ids = (await before.getLocalIds()).filter((id) => !meshIds.includes(id));
    assert.deepEqual(await after.getLocalIds(), ids);
    const geometryIds = after.getItemsWithGeometry();
    assert.ok(geometryIds.includes(66));
    assert.deepEqual(geometryIds, before.getItemsWithGeometry());
    assert.deepEqual(after.getItemsGeometry(geometryIds), before.getItemsGeometry(geometryIds));
    assert.deepEqual(after.getCoordinates(), before.getCoordinates());
    assert.deepEqual(after.getGuidsByLocalIds(ids), before.getGuidsByLocalIds(ids));
    assert.deepEqual(after.getSpatialStructure(), before.getSpatialStructure());
    const dataOptions = {
      attributesDefault: true,
      relationsDefault: { attributes: false, relations: false },
      relations: {
        IsDefinedBy: { attributes: true, relations: true },
        HasProperties: { attributes: true, relations: false },
        HasAssociations: { attributes: true, relations: true },
      },
    };
    assert.deepEqual(after.getItemsData(ids, dataOptions), before.getItemsData(ids, dataOptions));
  } finally {
    before.dispose();
    after.dispose();
  }
}

void verify().then(() => parentPort!.postMessage(true));
