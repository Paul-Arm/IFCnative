/**
 * Bauteile mit Extrusionskörper anlegen (M5).
 *
 * BEFUND (Kernfrage des Auftrags): Die In-Store-Builder aus @ifc-lite/create
 * (`addWallToStore`, `addSlabToStore`, `addColumnToStore`, `addBeamToStore`)
 * arbeiten direkt auf dem `StoreEditor` aus @ifc-lite/mutations — also exakt
 * auf `session.editor()` — und `resolveSpatialAnchor` liest den Anker aus
 * einem geparsten `IfcDataStore`. Beides passt ohne Adapter zu unserem
 * IfcDataStore + MutablePropertyView-Setup und wird deshalb für die vier
 * Klassen mit RECHTECKPROFIL genutzt.
 *
 * Nicht abgedeckt und deshalb hier selbst emittiert (siehe `emit.ts`):
 *   - Kreisprofil (IfcCircleProfileDef) — kein In-Store-Builder kennt es,
 *   - IfcBuildingElementProxy — kein In-Store-Builder vorhanden,
 *   - Öffnungen — siehe `opening.ts`.
 *
 * Die Parameterformen der Builder sind je Klasse verschieden (Achse vs.
 * Position); `emitViaInStoreBuilder` bildet die einheitliche Formulareingabe
 * darauf ab (Bedeutung je Klasse: `BuilderClassDef.hint`).
 */
import {
  addBeamToStore,
  addColumnToStore,
  addSlabToStore,
  addWallToStore,
  type SpatialAnchor,
} from "@ifc-lite/create";
import { generateIfcGuid } from "@ifc-lite/encoding";
import type { IfcAttributeValue, StoreEditor } from "@ifc-lite/mutations";
import {
  adder,
  anchorFor,
  captureCreated,
  emitBody,
  emitPlacement,
  emitProfile,
  hasPredefinedType,
  ownerRef,
  type BuildContext,
  type BuildResult,
} from "./emit";
import {
  builderClass,
  type BuilderClassDef,
  type CreateElementParams,
} from "./types";

/** Eigenbau-Pfad: Kreisprofile und Klassen ohne In-Store-Builder. */
function emitExtrusionElement(
  editor: StoreEditor,
  anchor: SpatialAnchor,
  def: BuilderClassDef,
  params: CreateElementParams,
): { elementId: number; relId: number } {
  const add = adder(editor);
  const placementId = emitPlacement(add, anchor, anchor.storeyPlacementId, [
    params.x,
    params.y,
    params.z,
  ]);
  const profileId = emitProfile(add, anchor, params);
  const productShapeId = emitBody(add, anchor, profileId, params.hoehe);

  const attributes: IfcAttributeValue[] = [
    generateIfcGuid(),
    ownerRef(anchor),
    params.name.trim() || def.label,
    null,
    null,
    `#${placementId}`,
    `#${productShapeId}`,
    params.tag.trim() || null,
  ];
  if (hasPredefinedType(anchor)) attributes.push(`.${def.predefinedType}.`);
  const elementId = add(def.entityName, attributes);

  const relId = add("IfcRelContainedInSpatialStructure", [
    generateIfcGuid(),
    ownerRef(anchor),
    null,
    null,
    [`#${elementId}`],
    `#${anchor.storeyId}`,
  ]);
  return { elementId, relId };
}

/** In-Store-Builder von @ifc-lite/create für die Rechteck-Varianten. */
function emitViaInStoreBuilder(
  editor: StoreEditor,
  anchor: SpatialAnchor,
  params: CreateElementParams,
): { elementId: number; relId: number } {
  const shared = {
    Name: params.name.trim() || undefined,
    Tag: params.tag.trim() || undefined,
  };
  const position: [number, number, number] = [params.x, params.y, params.z];
  switch (params.klasse) {
    case "wall": {
      const built = addWallToStore(editor, anchor, {
        ...shared,
        Start: position,
        End: [params.x + params.breite, params.y, params.z],
        Thickness: params.tiefe,
        Height: params.hoehe,
      });
      return { elementId: built.wallId, relId: built.relContainedId };
    }
    case "slab": {
      const built = addSlabToStore(editor, anchor, {
        ...shared,
        Position: position,
        Width: params.breite,
        Depth: params.tiefe,
        Thickness: params.hoehe,
      });
      return { elementId: built.slabId, relId: built.relContainedId };
    }
    case "column": {
      const built = addColumnToStore(editor, anchor, {
        ...shared,
        Position: position,
        Width: params.breite,
        Depth: params.tiefe,
        Height: params.hoehe,
      });
      return { elementId: built.columnId, relId: built.relContainedId };
    }
    default: {
      const built = addBeamToStore(editor, anchor, {
        ...shared,
        Start: position,
        End: [params.x + params.hoehe, params.y, params.z],
        Width: params.breite,
        Height: params.tiefe,
      });
      return { elementId: built.beamId, relId: built.relContainedId };
    }
  }
}

/** Bauteil mit Extrusionskörper unterhalb eines räumlichen Knotens anlegen. */
export function buildElement(
  context: BuildContext,
  parentId: number,
  params: CreateElementParams,
): BuildResult {
  const def = builderClass(params.klasse);
  if (params.hoehe <= 0) {
    throw new Error("Höhe / Extrusionslänge muss größer als 0 sein.");
  }
  const anchor = anchorFor(context.store, parentId);
  const useInStore = def.hasInStoreBuilder && params.profil === "rechteck";
  const { value, created } = captureCreated(context.editor, () =>
    useInStore
      ? emitViaInStoreBuilder(context.editor, anchor, params)
      : emitExtrusionElement(context.editor, anchor, def, params),
  );
  return { elementId: value.elementId, relId: value.relId, created };
}
