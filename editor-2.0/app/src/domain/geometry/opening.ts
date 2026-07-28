/**
 * Öffnungen (M5): IfcOpeningElement + IfcRelVoidsElement.
 *
 * @ifc-lite/create hat dafür keinen In-Store-Builder — `addDoorToStore` /
 * `addWindowToStore` erzeugen freistehende Bauteile ohne Void. Der Aufbau
 * hier nutzt dieselben Emitter-Bausteine wie die Bauteile.
 *
 * Verortet wird relativ zum durchbrochenen Bauteil: die Elternplatzierung ist
 * dessen ObjectPlacement, `abstand` läuft entlang dessen lokaler X-Achse,
 * `bruestung` entlang der lokalen Z-Achse.
 */
import { generateIfcGuid } from "@ifc-lite/encoding";
import type { IfcAttributeValue } from "@ifc-lite/mutations";
import type { SpatialAnchor } from "@ifc-lite/create";
import { storeyOf } from "../../core/model/spatial";
import { objectPlacementOf } from "./chain";
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
import type { CreateOpeningParams } from "./types";

/**
 * Anker für eine Öffnung: Kontext (OwnerHistory, Body-Kontext, Einheit) kommt
 * vom Geschoss des Bauteils, die Elternplatzierung ist das Bauteil selbst.
 * `objectPlacementOf` liest auch Overlay-Records — ein Bauteil, das in
 * derselben Sitzung entstanden ist, steht nicht im `entityIndex`.
 */
function openingAnchor(context: BuildContext, hostId: number): SpatialAnchor {
  const storeyId =
    storeyOf(context.store, hostId) ??
    context.store.entityIndex.byType.get("IFCBUILDINGSTOREY")?.[0] ??
    null;
  if (storeyId === null) {
    throw new Error("Kein Geschoss im Modell — Öffnung nicht platzierbar.");
  }
  const hostPlacement = objectPlacementOf(context, hostId);
  if (hostPlacement === null) {
    throw new Error(`Bauteil #${hostId} hat keine auflösbare Platzierung.`);
  }
  return {
    ...anchorFor(context.store, storeyId),
    storeyPlacementId: hostPlacement,
  };
}

/** Öffnung in ein Bauteil schneiden (Records + IfcRelVoidsElement). */
export function buildOpening(
  context: BuildContext,
  hostId: number,
  params: CreateOpeningParams,
): BuildResult {
  if (params.breite <= 0 || params.hoehe <= 0 || params.tiefe <= 0) {
    throw new Error("Breite, Höhe und Tiefe der Öffnung müssen größer als 0 sein.");
  }
  const anchor = openingAnchor(context, hostId);
  const { value, created } = captureCreated(context.editor, () => {
    const add = adder(context.editor);
    const placementId = emitPlacement(add, anchor, anchor.storeyPlacementId, [
      params.abstand,
      0,
      params.bruestung,
    ]);
    const profileId = emitProfile(add, anchor, {
      profil: "rechteck",
      breite: params.breite,
      tiefe: params.tiefe,
      radius: 0,
    });
    const productShapeId = emitBody(add, anchor, profileId, params.hoehe);

    const attributes: IfcAttributeValue[] = [
      generateIfcGuid(),
      ownerRef(anchor),
      params.name.trim() || "Öffnung",
      null,
      null,
      `#${placementId}`,
      `#${productShapeId}`,
      null,
    ];
    // IfcOpeningElement.PredefinedType existiert erst ab IFC4.
    if (hasPredefinedType(anchor)) attributes.push(".OPENING.");
    const elementId = add("IfcOpeningElement", attributes);

    const relId = add("IfcRelVoidsElement", [
      generateIfcGuid(),
      ownerRef(anchor),
      null,
      null,
      `#${hostId}`,
      `#${elementId}`,
    ]);
    return { elementId, relId };
  });
  return { elementId: value.elementId, relId: value.relId, created };
}
