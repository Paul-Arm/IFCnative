import { Model } from "@thatopen/fragments";
import * as flatbuffers from "flatbuffers";

/**
 * Rebase-Transformation, die der IfcImporter (web-ifc COORDINATE_TO_ORIGIN)
 * beim Konvertieren auf die Geometrie angewendet und in der Fragments-Datei
 * abgelegt hat: WELT → URSPRUNG in Viewer-Achsen (Y-up) und Metern.
 * 9 Werte: [px, py, pz, xxx, xxy, xxz, yxx, yxy, yxz] (Position, X-, Y-Achse).
 *
 * Die Umkehrung (Ursprung → Welt) rekonstruiert aus zentrierten
 * Szenen-Koordinaten die echten IFC-Weltkoordinaten.
 */
export type FragmentCoordination = number[];

/**
 * Liest die gespeicherte Rebase-Transformation aus UNKOMPRIMIERTEN
 * Fragments-Bytes (importer.process({ raw: true })). Gibt null zurück, wenn
 * keine (gültige) Transformation vorhanden ist.
 */
export function readFragmentCoordination(
  rawFragments: ArrayBuffer | Uint8Array,
): FragmentCoordination | null {
  try {
    const bytes =
      rawFragments instanceof Uint8Array
        ? rawFragments
        : new Uint8Array(rawFragments);
    const model = Model.getRootAsModel(new flatbuffers.ByteBuffer(bytes));
    const coordinates = model.meshes()?.coordinates();
    const position = coordinates?.position();
    const xDirection = coordinates?.xDirection();
    const yDirection = coordinates?.yDirection();
    if (!position || !xDirection || !yDirection) {
      return null;
    }
    const values = [
      position.x(),
      position.y(),
      position.z(),
      xDirection.x(),
      xDirection.y(),
      xDirection.z(),
      yDirection.x(),
      yDirection.y(),
      yDirection.z(),
    ];
    return values.every((value) => Number.isFinite(value)) ? values : null;
  } catch {
    return null;
  }
}
