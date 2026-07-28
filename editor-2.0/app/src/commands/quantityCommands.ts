/**
 * Command-Familie für Mengen (IfcElementQuantity / Qto_*).
 *
 * Undo-Strategie, abgeleitet aus `MutablePropertyView`:
 *  - `setQuantity` besitzt einen `skipHistory`-Parameter. Existierte die Menge
 *    schon, stellt das Undo den alten Wert damit wieder her, ohne die
 *    Mutationsliste für den Export aufzublähen.
 *  - War die Menge neu, gibt es keinen alten Wert. Dann entfernt
 *    `removeQuantityMutation(id, qset, menge)` den Eintrag vollständig.
 *  - `createQuantitySet` kennt kein `skipHistory`; sein sauberes Gegenstück ist
 *    `removeQuantityMutation(id, qset)` ohne Mengennamen — das löscht den
 *    kompletten neuen Mengensatz inklusive aller Einzelmutationen.
 */
import { QuantityType } from "@ifc-lite/data";
import type { ModelSession } from "../core/session";
import type { EditorCommand } from "./pipeline";

/** Menge in der Form, die `createQuantitySet` erwartet. */
export interface QuantityDraft {
  name: string;
  value: number;
  quantityType: QuantityType;
  unit?: string;
}

interface ExistingQuantity {
  value: number;
  type: QuantityType;
  unit?: string;
}

function findQuantity(
  session: ModelSession,
  expressId: number,
  qsetName: string,
  quantName: string,
): ExistingQuantity | null {
  const qset = session.view
    .getQuantitiesForEntity(expressId)
    .find((entry) => entry.name === qsetName);
  const quantity = qset?.quantities.find((q) => q.name === quantName);
  if (!quantity) return null;
  return { value: quantity.value, type: quantity.type, unit: quantity.unit };
}

/**
 * Einzelne Menge setzen. Existiert der Mengensatz noch nicht, legt das Overlay
 * ihn implizit an — das Undo räumt ihn in dem Fall wieder ab.
 */
export function cmdSetQuantity(
  session: ModelSession,
  expressId: number,
  qsetName: string,
  quantName: string,
  value: number,
  quantityType?: QuantityType,
  unit?: string,
): EditorCommand {
  const view = session.view;
  const previous = findQuantity(session, expressId, qsetName, quantName);
  const type = quantityType ?? previous?.type ?? QuantityType.Count;
  const nextUnit = unit ?? previous?.unit;
  return {
    label: `${qsetName}.${quantName} = ${value} (#${expressId})`,
    run() {
      view.setQuantity(expressId, qsetName, quantName, value, type, nextUnit);
    },
    undo() {
      if (previous) {
        view.setQuantity(
          expressId,
          qsetName,
          quantName,
          previous.value,
          previous.type,
          previous.unit,
          true,
        );
      } else {
        view.removeQuantityMutation(expressId, qsetName, quantName);
      }
    },
  };
}

/** Neuen Mengensatz mit einer oder mehreren Mengen anlegen. */
export function cmdCreateQuantitySet(
  session: ModelSession,
  expressId: number,
  qsetName: string,
  quantities: readonly QuantityDraft[],
): EditorCommand {
  const view = session.view;
  const payload = quantities.map((q) => ({ ...q }));
  return {
    label: `Mengensatz „${qsetName}" angelegt (#${expressId})`,
    run() {
      view.createQuantitySet(expressId, qsetName, payload);
    },
    undo() {
      view.removeQuantityMutation(expressId, qsetName);
    },
  };
}
