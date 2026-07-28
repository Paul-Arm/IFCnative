/**
 * Rechte Werkzeug-Sidebar: schmale Icon-Leiste (immer sichtbar) + ein Panel,
 * in dem genau EIN Werkzeug offen ist — das VS-Code-Muster als Antwort auf
 * das „100-Fenster"-Problem: die großen Arbeitsflächen bleiben Mosaic-
 * Fenster, der Kleinkram (Baukasten, Katalog, Lens, Prüfzentrum, IDS, Hub,
 * Notizen, Zuletzt) ist hier jederzeit einen Klick entfernt, ohne je das
 * Layout zu zerlegen.
 *
 * Klick auf ein Icon öffnet das Werkzeug, Klick auf das aktive schließt das
 * Panel. Die Breite ist am linken Rand ziehbar und wird gemerkt (useUi).
 */
import { useCallback, useRef } from "react";
import { PANE_TITLES, type ToolPaneId } from "../panes/ids";
import { renderPane } from "../panes/registry";
import { useUi } from "../store/ui";
import {
  IconBuilder,
  IconCatalog,
  IconCheck,
  IconHub,
  IconIds,
  IconLens,
  IconNotes,
  IconRecents,
  type IconComponent,
} from "./ribbon/icons";
import { optionalPane } from "./ribbon/panes";

/** Reihenfolge der Icon-Leiste; unbekannte Ids fallen lautlos weg. */
const TOOLS: ReadonlyArray<{ id: string; icon: IconComponent }> = [
  { id: "builder", icon: IconBuilder },
  { id: "catalog", icon: IconCatalog },
  { id: "lens", icon: IconLens },
  { id: "checks", icon: IconCheck },
  { id: "ids-validation", icon: IconIds },
  { id: "hub", icon: IconHub },
  { id: "notes", icon: IconNotes },
  { id: "recents", icon: IconRecents },
];

export function Sidebar() {
  const tool = useUi((s) => s.sidebarTool);
  const width = useUi((s) => s.sidebarWidth);
  const setTool = useUi((s) => s.setSidebarTool);
  const toggleTool = useUi((s) => s.toggleSidebarTool);
  const setWidth = useUi((s) => s.setSidebarWidth);

  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  const onResizeStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      drag.current = { startX: event.clientX, startWidth: width };
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* ohne Capture weiter */
      }
      event.preventDefault();
    },
    [width],
  );

  const onResizeMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!drag.current) return;
      // Ziehen nach links vergrößert das Panel.
      setWidth(drag.current.startWidth + (drag.current.startX - event.clientX));
    },
    [setWidth],
  );

  const onResizeEnd = useCallback(() => {
    drag.current = null;
  }, []);

  const tools = TOOLS.map((entry) => ({
    ...entry,
    paneId: optionalPane(entry.id) as ToolPaneId | null,
  })).filter(
    (entry): entry is typeof entry & { paneId: ToolPaneId } =>
      entry.paneId !== null,
  );

  const ToolIcon = tools.find((t) => t.paneId === tool)?.icon ?? null;

  return (
    <>
      {tool ? (
        <aside
          className="sidebar-panel"
          style={{ width }}
          aria-label={`Werkzeug: ${PANE_TITLES[tool]}`}
        >
          <div
            className="sidebar-resize"
            role="separator"
            aria-orientation="vertical"
            aria-label="Sidebar-Breite ändern"
            onPointerDown={onResizeStart}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeEnd}
            onPointerCancel={onResizeEnd}
          />
          <header className="sidebar-head">
            {ToolIcon ? <ToolIcon className="tb-icon" /> : null}
            <span className="sidebar-title">{PANE_TITLES[tool]}</span>
            <button
              type="button"
              className="tb-btn tb-btn-ghost tb-btn-icon sidebar-close"
              title="Werkzeug schließen"
              aria-label="Werkzeug schließen"
              onClick={() => setTool(null)}
            >
              ×
            </button>
          </header>
          <div className="sidebar-body">{renderPane(tool)}</div>
        </aside>
      ) : null}

      <nav className="tool-rail" aria-label="Werkzeuge">
        {tools.map((entry) => {
          const Icon = entry.icon;
          const active = tool === entry.paneId;
          return (
            <button
              key={entry.paneId}
              type="button"
              className="rail-btn"
              data-active={active ? "true" : undefined}
              title={PANE_TITLES[entry.paneId]}
              aria-label={PANE_TITLES[entry.paneId]}
              aria-pressed={active}
              onClick={() => toggleTool(entry.paneId)}
            >
              <Icon className="rail-icon" />
            </button>
          );
        })}
      </nav>
    </>
  );
}
