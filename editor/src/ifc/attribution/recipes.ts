/**
 * Schreib-Rezepte als reine Funktionen Dokument → Dokument. Schreiben ohne
 * Katalogsuffix (`_Name`) in Psets mit Portal-Namen (`ePset_<Name>`), weil
 * das sowohl der Importer als auch die IDS-Dateien des Portals annehmen.
 */
import {
  addNativePropertySetValues,
  addNativePropertyToSet,
  getNativeLengthUnitScale,
  getNativePlacement,
  getNativePlacementWorld,
  nativeWorldToLocalPlacementPoint,
  updateNativePlacement,
  updateNativePropertyValue,
  type NativeIfcDocument,
} from "../nativeDocument";

import { findPset, findPsets, getProperty, getValue, stripPsetPrefix } from "./normalize";
import { classifyMethodPset, fachmodellSchema, katalogFor, type Importart, type KatalogKlasse } from "./schema";
import { parseMeters, valueTypeFor, type TableColumn } from "./table";
import type { TreeNodeKind } from "./tree";

/** Tabellenzelle schreiben: Pset-Zeile → in ihr Pset, Entity-Zeile → Pset per Muster suchen oder anlegen. */
export function writeCell(document: NativeIfcDocument, row: { entityId: number; psetId?: number }, column: TableColumn, value: string, importart: Importart): NativeIfcDocument {
  if (column.position) return moveAlongAxis(document, row.entityId, column.position, value);
  const valueType = valueTypeFor(importart, column.catalog);
  if (row.psetId != null) return upsertPropertyInSet(document, row.entityId, row.psetId, column.property, value, valueType, column.aliase);
  const patterns = column.psetPattern === "Objektinformation(en)?" ? ["Objektinformationen", "Objektinformation"] : [column.psetPattern];
  const canonical = column.psetLabel.replace(/\d[*+]$/, "0");
  return upsertProperty(document, row.entityId, patterns, canonical, column.property, value, valueType, column.aliase);
}

/** Property setzen oder anlegen; Pset anlegen, wenn es fehlt. Gibt dasselbe Dokument zurück, wenn nichts zu tun ist. */
export function upsertProperty(
  document: NativeIfcDocument,
  entityId: number,
  psetPatterns: string[],
  canonicalPset: string,
  property: string,
  value: string,
  valueType: string,
  aliase: string[] = [],
): NativeIfcDocument {
  const set = findPset(document, entityId, ...psetPatterns);
  if (!set) {
    return addNativePropertySetValues(document, entityId, `ePset_${canonicalPset}`, [{ name: `_${property}`, value, valueType }]);
  }
  const hit = getProperty(set, property, ...aliase);
  if (hit) {
    if (hit.value === value) return document;
    // Name explizit mitgeben: updateNativePropertyValue baut die Property aus
    // entity.name neu auf, und das ist bei Property-Entities nicht gesetzt.
    return updateNativePropertyValue(document, hit.propertyId, { name: hit.rawName, value });
  }
  return addNativePropertyToSet(document, set.id, `_${property}`, value, valueType);
}

/** Objekt verschieben: eine Welt-Koordinate (Meter) setzen, die anderen Achsen und die Platzierungskette bleiben. */
export function moveAlongAxis(document: NativeIfcDocument, entityId: number, axis: "x" | "y" | "z", text: string): NativeIfcDocument {
  const meters = parseMeters(text);
  const world = getNativePlacementWorld(document, entityId);
  if (meters == null || !world) return document;
  const scale = getNativeLengthUnitScale(document);
  const target = { x: world.worldX, y: world.worldY, z: world.worldZ };
  if (Math.abs(target[axis] - meters / scale) < 1e-9) return document;
  target[axis] = meters / scale;
  const local = nativeWorldToLocalPlacementPoint(document, entityId, target);
  const placement = getNativePlacement(document, entityId);
  if (!local || !placement) return document;
  // Nur wirklich geaenderte Achsen schreiben, damit unveraenderte Koordinaten ihre volle Praezision behalten.
  const patch: { x?: number; y?: number; z?: number } = {};
  for (const key of ["x", "y", "z"] as const) if (Math.abs(local[key] - placement[key]) > 1e-9) patch[key] = local[key];
  return Object.keys(patch).length ? updateNativePlacement(document, entityId, patch) : document;
}

/** Property in einem bestimmten Pset setzen oder anlegen — für Pset-Zeilen (Ziel, Bereich, Messanlage, Maßnahme, Kanal). */
export function upsertPropertyInSet(
  document: NativeIfcDocument,
  entityId: number,
  psetId: number,
  property: string,
  value: string,
  valueType: string,
  aliase: string[] = [],
): NativeIfcDocument {
  const set = (document.propertySetsByEntity.get(entityId) ?? []).find((entry) => entry.id === psetId);
  if (!set) return document;
  const hit = getProperty(set, property, ...aliase);
  if (hit) return hit.value === value ? document : updateNativePropertyValue(document, hit.propertyId, { name: hit.rawName, value });
  return addNativePropertyToSet(document, set.id, `_${property}`, value, valueType);
}

/** Wiederholgruppen: nummerierte Psets, die das Portal als eigene Objekte liest. */
export interface RepeatGroup {
  familie: string;
  /** Pset-Name ohne Index, z. B. `Untersuchungsziel` → `ePset_Untersuchungsziel3`. */
  base: string;
  /** Katalogklasse, deren Textfelder beim Anlegen entstehen. */
  code: string;
  label: string;
  /** Portal-Pflichtfelder, die auch ohne Katalog angelegt werden. */
  hard: string[];
  /** Träger: IfcBuilding (Projekt) oder der Sensor. */
  parent: "projekt" | "sensor";
}

export const REPEAT_GROUPS: Partial<Record<TreeNodeKind, RepeatGroup>> = {
  untersuchungsziel: { familie: "Untersuchungsziel\\d*", base: "Untersuchungsziel", code: "BWD - UZ", label: "Untersuchungsziel", hard: ["ID", "Bezeichnung"], parent: "projekt" },
  untersuchungsbereich: { familie: "Untersuchungsbereich\\d*", base: "Untersuchungsbereich", code: "BWD - UB", label: "Untersuchungsbereich", hard: ["ID", "Bezeichnung"], parent: "projekt" },
  messanlage: { familie: "Messanlage\\d*", base: "Messanlage", code: "MON - MA", label: "Messanlage", hard: ["ID", "Bezeichnung"], parent: "projekt" },
  massnahme: { familie: "Maßnahme\\d*", base: "Maßnahme", code: "MON - MASSN", label: "Maßnahme", hard: ["ID", "Bezeichnung"], parent: "projekt" },
  kanal: { familie: "Kanal\\d*", base: "Kanal", code: "MON - K", label: "Kanal", hard: ["ID", "Bezeichnung", "MaßnahmeID"], parent: "sensor" },
};

/** Nächster freier Index einer Pset-Familie am Träger (0-basiert, Lücken werden nicht gefüllt). */
export function nextRepeatIndex(document: NativeIfcDocument, entityId: number, familie: string): number {
  const base = familie.replace(/\\d[*+]$/, "");
  let next = 0;
  for (const set of findPsets(document, entityId, familie)) {
    const digits = stripPsetPrefix(set.name).slice(base.length);
    const index = digits ? Number(digits) : 0;
    if (Number.isFinite(index) && index >= next) next = index + 1;
  }
  return next;
}

/** ID eines Kindes aus Eltern-ID und Bezeichnung, wie in den Zieldateien (`<Projekt>.<Bezeichnung>`, `<Sensor>.<Kanal>`). */
export function childId(parentId: string, bezeichnung: string): string {
  return parentId ? `${parentId}.${bezeichnung}` : bezeichnung;
}

/** Neues nummeriertes Pset anlegen: Portal-Pflichtfelder plus Textfelder der Katalogklasse, Werte aus `values`. */
export function addRepeatPset(document: NativeIfcDocument, entityId: number, kind: TreeNodeKind, importart: Importart, values: Record<string, string> = {}): NativeIfcDocument {
  const group = REPEAT_GROUPS[kind];
  if (!group || !document.entityById.has(entityId)) return document;
  const index = nextRepeatIndex(document, entityId, group.familie);
  const valueType = valueTypeFor(importart);
  const klasse = katalogFor(importart)?.objektklassen.find((entry) => entry.code === group.code);
  const names = new Set<string>(group.hard);
  for (const property of klasse?.psets[0]?.properties ?? []) {
    if (property.typ === "IFCLABEL" || property.typ === "IFCTEXT") names.add(property.kurz);
  }
  const properties = [...names].map((name) => ({ name: `_${name}`, value: values[name] ?? "", valueType }));
  return addNativePropertySetValues(document, entityId, `ePset_${group.base}${index}`, properties);
}

/** `Objektinformation.ID` eines Bauteils im Bauwerksmodell (Ziel eines Viewer-Klicks). */
export function readBauteilId(bauwerksmodell: NativeIfcDocument, entityId: number): string {
  const info = findPset(bauwerksmodell, entityId, "Objektinformation");
  if (!info || !getValue(info, "IDEbene1")) return "";
  return getValue(info, "ID");
}

/** Bauteil-Referenz schreiben und, falls die Ebenen-Felder existieren und leer sind, aus der ID ableiten. */
export function writeBauteilReference(document: NativeIfcDocument, entityId: number, componentId: string, importart: Importart): NativeIfcDocument {
  const valueType = valueTypeFor(importart);
  const patterns = ["Objektinformationen", "Objektinformation"];
  let next = upsertProperty(document, entityId, patterns, "Objektinformation", "BauteilID", componentId, valueType);
  const segments = componentId.split(".");
  if (segments.length === 6) {
    const set = findPset(next, entityId, ...patterns);
    for (const [index, property] of ["IDEbene1", "IDEbene2", "IDEbene3"].entries()) {
      const hit = getProperty(set, property);
      if (hit && !hit.value) next = updateNativePropertyValue(next, hit.propertyId, { name: hit.rawName, value: segments[index + 2]! });
    }
  }
  return next;
}

/** Beliebiges Katalog-Pset am Objekt anlegen (Verfahren oder Basis-Pset wie Untersuchungsstelle), leer; idempotent. */
export function attachPset(document: NativeIfcDocument, entityId: number, psetPattern: string, psetLabel: string, importart: Importart): NativeIfcDocument {
  if (findPset(document, entityId, psetPattern)) return document;
  const method = classifyMethodPset(psetLabel);
  if (method?.kind === "main") return addMethodPset(document, entityId, method.verfahren.pset, importart);
  const canonical = psetLabel.replace(/\\d[*+]$/, "0").replace(/\(en\)\?$/, "");
  const klasse = katalogklasseForPset(canonical);
  const valueType = valueTypeFor(importart);
  const properties = (klasse?.psets[0]?.properties ?? [])
    .filter((property) => property.typ === "IFCLABEL" || property.typ === "IFCTEXT")
    .map((property) => ({ name: `_${property.kurz}`, value: "", valueType }));
  if (!properties.length) return document;
  return addNativePropertySetValues(document, entityId, `ePset_${canonical}`, properties);
}

/** Verfahrens-Pset mit den Textfeldern des Katalogs anlegen (leer, kein Platzhalter in Zahltypen). */
export function addMethodPset(document: NativeIfcDocument, entityId: number, verfahrenPset: string, importart: Importart): NativeIfcDocument {
  const canonical = verfahrenPset.replace(/\\d[*+]$/, "0").replace(/\\d\*/, "0");
  if (findPset(document, entityId, verfahrenPset)) return document;
  const klasse = katalogklasseForPset(canonical);
  const valueType = valueTypeFor(importart);
  const properties = (klasse?.psets[0]?.properties ?? [])
    .filter((property) => property.typ === "IFCLABEL" || property.typ === "IFCTEXT")
    .map((property) => ({ name: `_${property.kurz}`, value: "", valueType }));
  if (!properties.length) properties.push({ name: "_UntersuchungszielID", value: "", valueType });
  return addNativePropertySetValues(document, entityId, `ePset_${canonical}`, properties);
}

export function katalogklasseForPset(portalName: string): KatalogKlasse | undefined {
  const target = portalName.toLowerCase();
  for (const katalog of [fachmodellSchema.katalog.bwd, fachmodellSchema.katalog.mon]) {
    const klasse = katalog.objektklassen.find((entry) => entry.psets.some((pset) => pset.portalName.toLowerCase() === target || pset.portalName.toLowerCase().replace(/[xn]$/, "") === target.replace(/\d+$/, "")));
    if (klasse) return klasse;
  }
  return undefined;
}
