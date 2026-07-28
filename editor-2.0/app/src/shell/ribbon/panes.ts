/**
 * Fenster-Logik der Kopfleiste. Seit dem Sidebar-Umbau zweigleisig:
 *  - HAUPTFENSTER (MainPaneId) werden im Mosaic-Layout ein-/ausgeblendet
 *    (reine Layout-Arbeit über `useUi.setLayout`),
 *  - WERKZEUGE (ToolPaneId) öffnen/schließen das Panel der rechten Sidebar
 *    (`useUi.toggleSidebarTool` — genau ein Werkzeug offen).
 * Die Schalter-API (`togglePane`/`usePaneVisible`) bleibt für beide gleich,
 * damit Ribbon-Schnellzugriffe nicht wissen müssen, wo ein Pane lebt.
 */
import type { MosaicNode } from "react-mosaic-component";
import {
  PANE_IDS,
  PANE_TITLES,
  isToolPane,
  type MainPaneId,
  type PaneId,
} from "../../panes/ids";
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

function contains(node: MosaicNode<MainPaneId>, id: MainPaneId): boolean {
  if (typeof node === "string") return node === id;
  if (node.type === "tabs") return node.tabs.includes(id);
  return node.children.some((child) => contains(child, id));
}

function withoutPane(
  node: MosaicNode<MainPaneId>,
  id: MainPaneId,
): MosaicNode<MainPaneId> | null {
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
    .filter((child): child is MosaicNode<MainPaneId> => child !== null);
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

/** Hauptfenster sichtbar machen (rechts andocken), falls nicht im Baum. */
function showMainPane(id: MainPaneId): void {
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

/** Hauptfenster schließen; das letzte verbleibende Pane bleibt bestehen. */
function hideMainPane(id: MainPaneId): void {
  const { layout, setLayout } = useUi.getState();
  if (layout === null) return;
  const next = withoutPane(layout, id);
  if (next === null) return;
  setLayout(next);
}

/** Office-Verhalten der Fenster-Schalter: gedrückt = sichtbar/offen. */
export function togglePane(id: PaneId): void {
  if (isToolPane(id)) {
    useUi.getState().toggleSidebarTool(id);
    return;
  }
  const { layout } = useUi.getState();
  const main = id as MainPaneId;
  if (layout !== null && contains(layout, main)) hideMainPane(main);
  else showMainPane(main);
}

/** Pane anzeigen (Werkzeug: Sidebar öffnen; Hauptfenster: andocken). */
export function showPane(id: PaneId): void {
  if (isToolPane(id)) {
    useUi.getState().setSidebarTool(id);
    return;
  }
  showMainPane(id as MainPaneId);
}

/** Reaktive Sichtbarkeit für den Gedrückt-Zustand der Schalter. */
export function usePaneVisible(id: PaneId | null): boolean {
  return useUi((s) => {
    if (id === null) return false;
    if (isToolPane(id)) return s.sidebarTool === id;
    return s.layout !== null && contains(s.layout, id as MainPaneId);
  });
}
