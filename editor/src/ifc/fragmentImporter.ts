import type { IfcImporter } from "@thatopen/fragments";
import { IFCTRIANGULATEDFACESET } from "web-ifc";

/** Shared configuration for worker and main-thread viewer conversion. */
export function configureFragmentImporter(importer: IfcImporter, wasmPath: string) {
  importer.wasm = { absolute: true, path: wasmPath };
  // Keep georeferenced vertices near the origin for float32 precision.
  // fragmentCoordination retains the transform for world-coordinate edits.
  importer.webIfcSettings = { COORDINATE_TO_ORIGIN: true };
  importer.addAllAttributes();
  importer.addAllRelations();
  // Fragments 3.4 omits IfcTriangulatedFaceSet from its geometry exclusion
  // list. Reading its large index arrays again as properties is redundant:
  // the geometry processor handles them, and the native document owns STEP.
  importer.classes.abstract.delete(IFCTRIANGULATEDFACESET);
}
