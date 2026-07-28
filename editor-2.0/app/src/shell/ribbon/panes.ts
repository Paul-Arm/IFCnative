/**
 * Fenster-Logik des Ribbons: Panes im aktuellen Mosaic-Layout ein- und
 * ausblenden. Reine Layout-Arbeit über `useUi.setLayout` — es entstehen
 * keine neuen Fachfunktionen, nur andere Bäume aus bekannten Pane-Ids.
 */
import type { MosaicNode } from "react-mosaic-component";
import { PANE_IDS, PANE_TITLES, type PaneId } from "../../panes/ids";
import { useUi } from "../../store/ui";

const KNOWN_PANES = new Set<string>(PANE_IDS);

/**
 * Pane-Id nur zurückgeben, wenn es sie in dieser Version wirklich gibt.
 * So kann das Ribbon Einträge für Panes anbieten, die parallel entstehen
 * (z. B. „ids-validation"), ohne bei deren Fehlen zu brechen.
 */
export function optionalPane(id: string): PaneId | null {
  return KNOWN_PANES.has(id) ? (id as PaneId) : null;
}

/** Anzeigename eines Panes (Fallback: die Id selbst). */
export function paneTitle(id: PaneId): string {
  return PANE_TITLES[id] ?? id;
}

function contains(node: MosaicNode<PaneId>, id: PaneId): boolean {
  if (typeof node === "string") return node === id;
  if (node.type === "tabs") return node.tabs.includes(id);
  return node.children.some((child) => contains(child, id));
}

function withoutPane(
  node: MosaicNode<PaneId>,
  id: PaneId,
): MosaicNode<PaneId> | null {
  if (typeof node === "string") return node === id ? null : node;
  if (node.type === "tabs") {
    const tabs = node.tabs.filter((tab) => tab !== id);
    if (tabs.length === 0) return null;
    if (tabs.length === 1) return tabs[0];
    return {
      ...node,
      tabs,
      activeTabIndex: Math.min(node.activeTabIndex, tabs.length - 1),
    };
  }
  const children = node.children
    .map((child) => withoutPane(child, id))
    .filter((child): child is MosaicNode<PaneId> => child !== null);
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  return {
    type: "split",
    direction: node.direction,
    children,
    // Prozentwerte müssen zur Kinderzahl passen — bei Wegfall neu verteilen.
    ...(children.length === node.children.length
      ? { splitPercentages: node.splitPercentages }
      : {}),
  };
}

/** Pane sichtbar machen (rechts andocken), falls es noch nicht im Baum ist. */
export function showPane(id: PaneId): void {
  const { layout, setLayout } = useUi.getState();
  if (layout === null) {
    setLayout(id);
    return;
  }
  if (contains(layout, id)) return;
  setLayout({
    type: "split",
    direction: "row",
    children: [layout, id],
    splitPercentages: [70, 30],
  });
}

/** Pane schließen; das letzte verbleibende Pane bleibt bestehen. */
export function hidePane(id: PaneId): void {
  const { layout, setLayout } = useUi.getState();
  if (layout === null) return;
  const next = withoutPane(layout, id);
  if (next === null) return;
  setLayout(next);
}

/** Office-Verhalten der Fenster-Schalter: gedrückt = sichtbar. */
export function togglePane(id: PaneId): void {
  const { layout } = useUi.getState();
  if (layout !== null && contains(layout, id)) hidePane(id);
  else showPane(id);
}

/** Reaktive Sichtbarkeit für den Gedrückt-Zustand der Schalter. */
export function usePaneVisible(id: PaneId | null): boolean {
  return useUi((s) => id !== null && s.layout !== null && contains(s.layout, id));
}
