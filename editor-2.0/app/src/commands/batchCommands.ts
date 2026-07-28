/**
 * Command-Familie für Massenänderungen (Pset-Batch-Pane).
 *
 * Leitgedanke: eine fachliche Operation über beliebig viele Objekte ist genau
 * EIN Eintrag im Undo-Stapel. Deshalb sammeln die Commands ihre Vorzustände
 * beim Bauen ein (wie `cmdSetProperty`) und spielen sie im `undo()` in
 * umgekehrter Reihenfolge zurück.
 *
 * Undo-Details, die aus dem Overlay-Verhalten von ifc-lite folgen:
 *   - `setProperty`/`deleteProperty` kennen `skipHistory` — das Gegenstück
 *     landet also nicht in der Mutationsliste des Exports.
 *   - `createPropertySet`/`deletePropertySet` kennen kein `skipHistory`; das
 *     Gegenstück einer Anlage ist immer ein Löschen. Deshalb merken sich die
 *     Pset-Commands, wo sie tatsächlich angelegt haben, und löschen beim Undo
 *     ausschließlich dort (Idempotenz-Anforderung der Pane).
 */
import type { PropertyValue, PropertyValueType } from "@ifc-lite/data";
import type { ModelSession } from "../core/session";
import type { EditorCommand } from "./pipeline";

/** Werte, die aus der Matrix bzw. dem CSV-Import kommen können. */
export type BatchValue = string | number | boolean;

/** Zielzelle einer Massenänderung. */
export interface CellTarget {
  expressId: number;
  psetName: string;
  propName: string;
}

/** Eine geplante Zelländerung (Vorschau-Zeile und Ausführungsauftrag zugleich). */
export interface CellChange extends CellTarget {
  value: BatchValue;
  valueType: PropertyValueType;
}

/** Psets eines Objekts nach heutigem Overlay-Stand (Namen genügen hier). */
function psetNamesOf(session: ModelSession, expressId: number): string[] {
  return session.view.getForEntity(expressId).map((pset) => pset.name);
}

/**
 * Beliebig viele Einzelzellen in einem Rutsch setzen — der Rückweg des
 * CSV-Imports und jeder anderen heterogenen Änderungsliste.
 */
export function cmdSetCells(
  session: ModelSession,
  changes: readonly CellChange[],
  label: string,
): EditorCommand {
  const view = session.view;
  const payload = changes.map((change) => ({ ...change }));
  const before: Array<PropertyValue | null> = payload.map((change) =>
    view.getPropertyValue(change.expressId, change.psetName, change.propName),
  );
  return {
    label,
    run() {
      for (const change of payload) {
        view.setProperty(
          change.expressId,
          change.psetName,
          change.propName,
          change.value,
          change.valueType,
        );
      }
    },
    undo() {
      for (let index = payload.length - 1; index >= 0; index -= 1) {
        const change = payload[index];
        const old = before[index];
        if (old === null) {
          view.deleteProperty(
            change.expressId,
            change.psetName,
            change.propName,
            true,
          );
        } else {
          view.setProperty(
            change.expressId,
            change.psetName,
            change.propName,
            old,
            change.valueType,
            undefined,
            true,
          );
        }
      }
    },
  };
}

/** Dieselbe Property auf allen Objekten löschen (ein Undo-Schritt). */
export function cmdDeletePropertyOnMany(
  session: ModelSession,
  expressIds: readonly number[],
  psetName: string,
  propName: string,
  valueType: PropertyValueType,
): EditorCommand {
  const view = session.view;
  const ids = [...expressIds];
  const before: Array<PropertyValue | null> = ids.map((id) =>
    view.getPropertyValue(id, psetName, propName),
  );
  return {
    label: `Property ${psetName}.${propName} auf ${ids.length} Objekten gelöscht`,
    run() {
      for (const id of ids) view.deleteProperty(id, psetName, propName);
    },
    undo() {
      for (let index = ids.length - 1; index >= 0; index -= 1) {
        const old = before[index];
        if (old === null) continue;
        view.setProperty(
          ids[index],
          psetName,
          propName,
          old,
          valueType,
          undefined,
          true,
        );
      }
    },
  };
}

/**
 * Leeres Pset auf allen Objekten anlegen — idempotent: wo der Satz schon
 * existiert, passiert nichts, und das Undo löscht ihn dort auch nicht.
 */
export function cmdCreatePsetOnMany(
  session: ModelSession,
  expressIds: readonly number[],
  psetName: string,
): EditorCommand {
  const view = session.view;
  const targets = [...expressIds].filter(
    (id) => !psetNamesOf(session, id).includes(psetName),
  );
  return {
    label: `Eigenschaftssatz „${psetName}" auf ${targets.length} von ${expressIds.length} Objekten angelegt`,
    run() {
      for (const id of targets) view.createPropertySet(id, psetName, []);
    },
    undo() {
      for (let index = targets.length - 1; index >= 0; index -= 1) {
        view.deletePropertySet(targets[index], psetName);
      }
    },
  };
}

/**
 * Neue Property auf allen Objekten anlegen. `setProperty` legt das Pset bei
 * Bedarf mit an; das Undo entfernt deshalb zusätzlich die Sätze, die erst
 * durch diesen Command entstanden sind — sonst bliebe ein leeres Pset zurück.
 */
export function cmdAddPropertyOnMany(
  session: ModelSession,
  expressIds: readonly number[],
  psetName: string,
  propName: string,
  value: BatchValue,
  valueType: PropertyValueType,
): EditorCommand {
  const view = session.view;
  const ids = [...expressIds];
  const createdPsetOn = ids.filter(
    (id) => !psetNamesOf(session, id).includes(psetName),
  );
  const before: Array<PropertyValue | null> = ids.map((id) =>
    view.getPropertyValue(id, psetName, propName),
  );
  return {
    label: `${psetName}.${propName} = „${value}" auf ${ids.length} Objekten angelegt`,
    run() {
      for (const id of ids) {
        view.setProperty(id, psetName, propName, value, valueType);
      }
    },
    undo() {
      for (let index = ids.length - 1; index >= 0; index -= 1) {
        const old = before[index];
        if (old === null) {
          view.deleteProperty(ids[index], psetName, propName, true);
        } else {
          view.setProperty(
            ids[index],
            psetName,
            propName,
            old,
            valueType,
            undefined,
            true,
          );
        }
      }
      for (let index = createdPsetOn.length - 1; index >= 0; index -= 1) {
        view.deletePropertySet(createdPsetOn[index], psetName);
      }
    },
  };
}
