/**
 * 3D-Markierung der Befunde über die bestehende Lens/Viewer-Brücke
 * (`panes/viewer/overrides.ts`): Fehler rot, Warnungen orange. Ausgeblendet
 * wird nichts — Isolieren bleibt Sache der Viewer-Werkzeugleiste.
 */
import type { ViewerColor } from "../../core/viewer";
import type { CheckFinding } from "../../domain/checks/types";

/** Quellenname in der Statuszeile des Viewers. */
export const HIGHLIGHT_SOURCE = "Prüfzentrum";

const COLORS: Partial<Record<CheckFinding["severity"], ViewerColor>> = {
  error: [0.85, 0.16, 0.16, 1],
  warning: [0.95, 0.55, 0.1, 1],
};

/** Keine Ausblendungen — konstante Referenz für den Overrides-Store. */
export const NO_HIDDEN: ReadonlySet<number> = new Set<number>();

/**
 * Farb-Map der Fehlschläge. Ein Objekt mit mehreren Befunden bekommt die
 * Farbe des höchsten Schweregrads (Fehler schlägt Warnung).
 */
export function findingColors(
  findings: readonly CheckFinding[],
): Map<number, ViewerColor> {
  const colors = new Map<number, ViewerColor>();
  for (const finding of findings) {
    const color = COLORS[finding.severity];
    if (!color) continue;
    for (const entityId of finding.entityIds) {
      if (finding.severity === "error" || !colors.has(entityId))
        colors.set(entityId, color);
    }
  }
  return colors;
}

/** Alle betroffenen Objekte der übergebenen Befunde, ohne Dubletten. */
export function affectedEntityIds(findings: readonly CheckFinding[]): number[] {
  const ids = new Set<number>();
  for (const finding of findings) for (const id of finding.entityIds) ids.add(id);
  return [...ids];
}
