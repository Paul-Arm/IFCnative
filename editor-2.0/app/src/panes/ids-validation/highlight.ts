/**
 * 3D-Kopplung über die bestehende Viewer-Brücke (`panes/viewer/overrides.ts`) —
 * nach dem Muster des ifc-lite-Viewers: „Fehlschläge rot markieren" und
 * „Bestandene grün markieren" sind zwei unabhängige Umschalter.
 *
 * Ein Objekt kann in mehreren Spezifikationen vorkommen und dort
 * unterschiedlich abschneiden; Rot gewinnt in diesem Fall gegen Grün.
 */
import type { ViewerColor } from "../../core/viewer";
import type { IdsRunResult } from "./model";

/** Quellenname in der Statuszeile des Viewers. */
export const IDS_HIGHLIGHT_SOURCE = "IDS-Validierung";

const FAILED_COLOR: ViewerColor = [0.85, 0.16, 0.16, 1];
const PASSED_COLOR: ViewerColor = [0.16, 0.65, 0.32, 1];

/** Keine Ausblendungen — konstante Referenz für den Overrides-Store. */
export const NO_HIDDEN: ReadonlySet<number> = new Set<number>();

export interface HighlightModes {
  failed: boolean;
  passed: boolean;
}

/**
 * Farb-Map des Laufs. Grün wird zuerst gesetzt, Rot überschreibt — so bleibt
 * ein Objekt, das irgendwo durchfällt, auch rot.
 */
export function idsColors(
  result: IdsRunResult | null,
  modes: HighlightModes,
): Map<number, ViewerColor> {
  const colors = new Map<number, ViewerColor>();
  if (!result) return colors;
  if (modes.passed)
    for (const doc of result.documents)
      for (const spec of doc.specs)
        for (const entity of spec.entities)
          if (entity.passed) colors.set(entity.expressId, PASSED_COLOR);
  if (modes.failed)
    for (const doc of result.documents)
      for (const spec of doc.specs)
        for (const entity of spec.entities)
          if (!entity.passed) colors.set(entity.expressId, FAILED_COLOR);
  return colors;
}
