/**
 * Command-Familie für Eigenschaftssätze (Psets): anlegen, löschen, umbenennen,
 * duplizieren. Ein Command beschreibt nur die Änderung — ausgeführt wird er von
 * `useCommands.execute()`.
 *
 * Undo-Strategie: `createPropertySet`/`deletePropertySet` im Mutations-Overlay
 * kennen keinen `skipHistory`-Parameter, deshalb ist das Gegenstück einer
 * Anlage immer ein Löschen (und umgekehrt). Vor einem Löschen sichert der
 * Command die vorhandenen Properties über `getForEntity`, damit das Undo den
 * Satz wertgetreu — inklusive Werttypen und Einheiten — wiederherstellt.
 */
import type { PropertyValue, PropertyValueType } from "@ifc-lite/data";
import type { ModelSession } from "../core/session";
import type { EditorCommand } from "./pipeline";

/** Property-Definition in der Form, die `createPropertySet` erwartet. */
export interface PsetProperty {
  name: string;
  value: PropertyValue;
  type?: PropertyValueType;
  unit?: string;
}

/** Suffix für Kopien — auch von der UI für Namensvorschläge genutzt. */
export const COPY_SUFFIX = " (Kopie)";

/**
 * Momentaufnahme der Properties eines Psets aus dem Overlay (Basis + Mutationen).
 * Leerer Satz, wenn das Pset nicht existiert.
 */
export function snapshotPset(
  session: ModelSession,
  expressId: number,
  psetName: string,
): PsetProperty[] {
  const pset = session.view
    .getForEntity(expressId)
    .find((entry) => entry.name === psetName);
  if (!pset) return [];
  return pset.properties.map((property) => ({
    name: property.name,
    value: property.value,
    type: property.type,
    unit: property.unit,
  }));
}

/** Neues Pset anlegen — leer oder direkt mit Properties gefüllt. */
export function cmdCreatePset(
  session: ModelSession,
  expressId: number,
  psetName: string,
  properties: readonly PsetProperty[] = [],
): EditorCommand {
  const view = session.view;
  const payload = properties.map((p) => ({ ...p }));
  return {
    label: `Eigenschaftssatz „${psetName}" angelegt (#${expressId})`,
    run() {
      view.createPropertySet(expressId, psetName, payload);
    },
    undo() {
      view.deletePropertySet(expressId, psetName);
    },
  };
}

/** Pset samt aller Properties löschen; das Undo legt es wieder an. */
export function cmdDeletePset(
  session: ModelSession,
  expressId: number,
  psetName: string,
): EditorCommand {
  const view = session.view;
  // Vor dem Löschen sichern — danach liefert getForEntity das Pset nicht mehr.
  const saved = snapshotPset(session, expressId, psetName);
  return {
    label: `Eigenschaftssatz „${psetName}" gelöscht (#${expressId})`,
    run() {
      view.deletePropertySet(expressId, psetName);
    },
    undo() {
      view.createPropertySet(expressId, psetName, saved);
    },
  };
}

/**
 * Pset umbenennen. Das Overlay kennt keine Umbenennung, deshalb Komposition:
 * unter dem neuen Namen mit allen Properties anlegen, den alten Satz löschen.
 * Das Undo läuft exakt invers.
 */
export function cmdRenamePset(
  session: ModelSession,
  expressId: number,
  oldName: string,
  newName: string,
): EditorCommand {
  const view = session.view;
  const saved = snapshotPset(session, expressId, oldName);
  return {
    label: `Eigenschaftssatz „${oldName}" in „${newName}" umbenannt (#${expressId})`,
    run() {
      view.createPropertySet(expressId, newName, saved);
      view.deletePropertySet(expressId, oldName);
    },
    undo() {
      view.createPropertySet(expressId, oldName, saved);
      view.deletePropertySet(expressId, newName);
    },
  };
}

/** Pset als „<Name> (Kopie)" duplizieren; das Undo löscht die Kopie. */
export function cmdDuplicatePset(
  session: ModelSession,
  expressId: number,
  psetName: string,
  copyName = `${psetName}${COPY_SUFFIX}`,
): EditorCommand {
  const view = session.view;
  const saved = snapshotPset(session, expressId, psetName);
  return {
    label: `Eigenschaftssatz „${psetName}" als „${copyName}" dupliziert (#${expressId})`,
    run() {
      view.createPropertySet(expressId, copyName, saved);
    },
    undo() {
      view.deletePropertySet(expressId, copyName);
    },
  };
}
