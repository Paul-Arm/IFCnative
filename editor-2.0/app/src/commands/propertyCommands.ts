/**
 * Kern-Commands für Eigenschaften und Attribute. Weitere Command-Familien
 * (Psets, Beziehungen, Entities) liegen in eigenen Dateien dieses Ordners.
 *
 * Review-Befund 12: Jeder Command, dessen `run()` ohne `skipHistory` in die
 * append-only Mutationshistorie schreibt, bekommt ein `redo()`, das denselben
 * Endzustand mit `skipHistory` herstellt — sonst wächst die Historie bei
 * jedem Undo/Redo-Zyklus. Einzige Ausnahme ist `cmdSetAttribute`: der
 * StepExporter liest UPDATE_ATTRIBUTE aus der Historie (Befund B3), dort MUSS
 * das Redo history-anhängend bleiben.
 */
import { PropertyValueType } from "@ifc-lite/data";
import type { ModelSession } from "../core/session";
import type { EditorCommand } from "./pipeline";

type PropertyValue = string | number | boolean;

/** Property setzen (legt das Pset im Overlay an, falls nötig). */
export function cmdSetProperty(
  session: ModelSession,
  expressId: number,
  psetName: string,
  propName: string,
  value: PropertyValue,
  valueType: PropertyValueType = PropertyValueType.Label,
): EditorCommand {
  const view = session.view;
  const oldValue = view.getPropertyValue(expressId, psetName, propName);
  return {
    label: `${psetName}.${propName} = „${value}" (#${expressId})`,
    run() {
      view.setProperty(expressId, psetName, propName, value, valueType);
    },
    undo() {
      if (oldValue === null) {
        view.deleteProperty(expressId, psetName, propName, true);
      } else {
        view.setProperty(expressId, psetName, propName, oldValue, valueType, undefined, true);
      }
    },
    redo() {
      view.setProperty(expressId, psetName, propName, value, valueType, undefined, true);
    },
  };
}

/** Property löschen. */
export function cmdDeleteProperty(
  session: ModelSession,
  expressId: number,
  psetName: string,
  propName: string,
  valueType: PropertyValueType = PropertyValueType.Label,
): EditorCommand {
  const view = session.view;
  const oldValue = view.getPropertyValue(expressId, psetName, propName);
  return {
    label: `Property ${psetName}.${propName} gelöscht (#${expressId})`,
    run() {
      view.deleteProperty(expressId, psetName, propName);
    },
    undo() {
      if (oldValue !== null) {
        view.setProperty(expressId, psetName, propName, oldValue, valueType, undefined, true);
      }
    },
    redo() {
      view.deleteProperty(expressId, psetName, propName, true);
    },
  };
}

/** IfcRoot-Attribut (Name, Description, ObjectType, Tag …) setzen. */
export function cmdSetAttribute(
  session: ModelSession,
  expressId: number,
  attrName: string,
  value: string,
  oldValue: string,
): EditorCommand {
  const view = session.view;
  return {
    label: `${attrName} = „${value}" (#${expressId})`,
    run() {
      view.setAttribute(expressId, attrName, value, oldValue);
    },
    undo() {
      // Befund B3 (tests/m2-editierkern.test.ts): der StepExporter liest
      // UPDATE_ATTRIBUTE aus der append-only Mutationshistorie, nicht aus der
      // Overlay-Map. `removeAttributeMutation`/skipHistory lassen den neuen
      // Wert daher im Export stehen — Undo muss ein history-anhängendes
      // Gegen-setAttribute sein.
      view.setAttribute(expressId, attrName, oldValue, value);
    },
    /**
     * Befund 12, Sonderfall: Aus demselben Grund (B3) MUSS auch das Redo
     * history-anhängend sein — mit skipHistory bliebe im Export der alte Wert
     * des Undo-Eintrags stehen. Identisch zu `run()`, aber explizit notiert.
     */
    redo() {
      view.setAttribute(expressId, attrName, value, oldValue);
    },
  };
}

/** Batch: dieselbe Property auf mehrere Objekte (ein Undo-Schritt). */
export function cmdSetPropertyOnMany(
  session: ModelSession,
  expressIds: readonly number[],
  psetName: string,
  propName: string,
  value: PropertyValue,
  valueType: PropertyValueType = PropertyValueType.Label,
): EditorCommand {
  const commands = expressIds.map((id) =>
    cmdSetProperty(session, id, psetName, propName, value, valueType),
  );
  return {
    label: `${psetName}.${propName} = „${value}" auf ${expressIds.length} Objekte`,
    run() {
      for (const c of commands) c.run();
    },
    undo() {
      for (const c of [...commands].reverse()) c.undo();
    },
    redo() {
      for (const c of commands) c.redo?.();
    },
  };
}
