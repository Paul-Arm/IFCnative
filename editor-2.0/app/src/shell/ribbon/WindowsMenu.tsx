/**
 * Fenster-Dropdown im Register „Ansicht": die HAUPTFENSTER des Mosaic-
 * Layouts (Haken = sichtbar, Badge = Anzahl offener Fenster). Werkzeuge
 * (Baukasten, Katalog, Lens, Prüfzentrum, IDS, Hub, Notizen, Zuletzt)
 * liegen seit dem Sidebar-Umbau in der Icon-Leiste rechts und tauchen hier
 * nicht mehr auf.
 */
import { useCallback, useRef, useState } from "react";
import type { MosaicNode } from "react-mosaic-component";
import {
  MAIN_PANE_IDS,
  PANE_TITLES,
  type MainPaneId,
} from "../../panes/ids";
import { useUi } from "../../store/ui";
import { DropMenu } from "./DropMenu";
import {
  IconChevronDown,
  IconCube,
  IconDrawing,
  IconGraph,
  IconInspector,
  IconLayout,
  IconLens,
  IconStructure,
  IconTable,
  type IconComponent,
} from "./icons";
import { togglePane, usePaneVisible } from "./panes";

const WINDOW_ICONS: Record<MainPaneId, IconComponent> = {
  structure: IconStructure,
  viewer: IconCube,
  inspector: IconInspector,
  graph: IconGraph,
  "pset-batch": IconTable,
  lists: IconTable,
  drawing: IconDrawing,
};

function countPanes(layout: MosaicNode<MainPaneId> | null): number {
  if (layout === null) return 0;
  if (typeof layout === "string") return 1;
  if (layout.type === "tabs") return layout.tabs.length;
  return layout.children.reduce((sum, child) => sum + countPanes(child), 0);
}

export function WindowsMenu() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const visibleCount = useUi((s) => countPanes(s.layout));

  return (
    <div className="tb-menu-box" ref={box}>
      <button
        type="button"
        className="tb-btn tb-btn-outline"
        title="Hauptfenster ein-/ausblenden"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <IconLayout className="tb-icon" />
        <span className="tb-btn-text">Fenster</span>
        <span className="tb-badge">{visibleCount}</span>
        <IconChevronDown className="tb-icon-xs" />
      </button>
      <DropMenu anchorRef={box} open={open} onDismiss={close}>
        <div className="tb-menu-heading">Hauptfenster</div>
        {MAIN_PANE_IDS.map((id) => (
          <WindowItem key={id} id={id} icon={WINDOW_ICONS[id] ?? IconLens} />
        ))}
      </DropMenu>
    </div>
  );
}

function WindowItem({ id, icon: Icon }: { id: MainPaneId; icon: IconComponent }) {
  const visible = usePaneVisible(id);
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={visible}
      className="tb-menu-item"
      data-active={visible ? "true" : undefined}
      onClick={() => togglePane(id)}
    >
      <Icon className="tb-icon" />
      <span className="tb-menu-item-text">{PANE_TITLES[id]}</span>
      <span className="tb-menu-check" aria-hidden="true">
        {visible ? "✓" : ""}
      </span>
    </button>
  );
}
