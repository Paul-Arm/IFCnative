/**
 * Brücke Lens → Viewer: ein minimaler Store für Farb-Overrides und
 * Lens-Ausblendungen. Das Lens-Pane schreibt, das Viewer-Pane liest und
 * reicht die Werte an `renderer.getScene().setColorOverrides()` bzw. an
 * `render({ hiddenIds })` weiter. Bewusst getrennt von der Auswahl:
 * Overrides sind Darstellungszustand, keine Selektion.
 */
import { create } from "zustand";
import type { ViewerColor } from "../../core/viewer";

export interface ViewerOverrides {
  /** Dokument, für das die Overrides gelten (Tab-Wechsel setzt zurück). */
  docId: string | null;
  /** Kurzer Name der Quelle für die Statuszeile, z. B. der Lens-Name. */
  source: string | null;
  colors: ReadonlyMap<number, ViewerColor> | null;
  hidden: ReadonlySet<number>;

  setColorOverrides(
    docId: string,
    source: string,
    colors: ReadonlyMap<number, ViewerColor>,
    hidden: ReadonlySet<number>,
  ): void;
  clear(): void;
}

const NO_IDS: ReadonlySet<number> = new Set<number>();

export const useViewerOverrides = create<ViewerOverrides>((set) => ({
  docId: null,
  source: null,
  colors: null,
  hidden: NO_IDS,

  setColorOverrides(docId, source, colors, hidden) {
    set({ docId, source, colors, hidden });
  },

  clear() {
    set({ docId: null, source: null, colors: null, hidden: NO_IDS });
  },
}));

/** Overrides nur, wenn sie zum aktiven Dokument gehören. */
export function overridesFor(
  state: ViewerOverrides,
  docId: string | null,
): { colors: ReadonlyMap<number, ViewerColor> | null; hidden: ReadonlySet<number> } {
  if (!docId || state.docId !== docId) return { colors: null, hidden: NO_IDS };
  return { colors: state.colors, hidden: state.hidden };
}
