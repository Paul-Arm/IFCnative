/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Ribbon-Kopfzeile, zweite Generation: die Register (Start/Ansicht/Modell/
 * Prüfen) bleiben, das Band darunter ist aber eine einzeilige, kompakte
 * Befehlsleiste im Design der ersten React-App statt des hohen Office-Bands.
 *
 *  - Registerzeile: Marke, Register mit Teal-Unterstrich, rechts die
 *    ständigen Aktionen (Rückgängig/Wiederholen, Theme) und der
 *    Einklapp-Pfeil,
 *  - Office-Konventionen bleiben: Doppelklick auf das aktive Register (oder
 *    der Pfeil) klappt das Band ein, der Zustand bleibt gespeichert,
 *  - darunter die Dokument-Tabs (Browser-Tab-Optik),
 *  - das versteckte Datei-Input bleibt außerhalb der Register montiert,
 *    damit „IFC öffnen" auch im eingeklappten Zustand weiterläuft.
 */
import { useState } from "react";
import { useCommands, useUndoRedoLabels } from "../../commands/pipeline";
import { loadJson, saveJson } from "../../core/storage";
import { useDocuments } from "../../store/documents";
import { useUi } from "../../store/ui";
import { DocumentTabs } from "../DocumentTabs";
import {
  IconChevronDown,
  IconChevronUp,
  IconMoon,
  IconRedo,
  IconSun,
  IconUndo,
} from "./icons";
import { AnsichtTab } from "./tabs/AnsichtTab";
import { ModellTab } from "./tabs/ModellTab";
import { PruefenTab } from "./tabs/PruefenTab";
import { StartTab } from "./tabs/StartTab";
import { useFileOpen } from "./useFileOpen";

type RibbonTabId = "start" | "ansicht" | "modell" | "pruefen";

const RIBBON_TABS: ReadonlyArray<{ id: RibbonTabId; label: string }> = [
  { id: "start", label: "Start" },
  { id: "ansicht", label: "Ansicht" },
  { id: "modell", label: "Modell" },
  { id: "pruefen", label: "Prüfen" },
];

const COLLAPSED_KEY = "ribbonCollapsed";

export function Ribbon() {
  // Das aktive Register ist bewusst flüchtig, der Einklapp-Zustand dagegen
  // eine Nutzerentscheidung und persistent.
  const [activeTab, setActiveTab] = useState<RibbonTabId>("start");
  const [collapsed, setCollapsedState] = useState(() =>
    loadJson<boolean>(COLLAPSED_KEY, false),
  );
  const fileCommands = useFileOpen();
  const hasDocuments = useDocuments((s) => s.documents.length > 0);

  const setCollapsed = (value: boolean) => {
    saveJson(COLLAPSED_KEY, value);
    setCollapsedState(value);
  };

  const onTabClick = (id: RibbonTabId) => {
    if (id === activeTab && !collapsed) return;
    setActiveTab(id);
    if (collapsed) setCollapsed(false);
  };

  const activeLabel =
    RIBBON_TABS.find((tab) => tab.id === activeTab)?.label ?? "";

  return (
    <div className="ribbon">
      {fileCommands.fileInput}

      <div className="ribbon-tabs">
        <span className="ribbon-brand">IFCnative 2.0</span>
        <div role="tablist" aria-label="Register" className="ribbon-tablist">
          {RIBBON_TABS.map((tab) => {
            const isActive = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`ribbon-tab-${tab.id}`}
                aria-selected={isActive}
                aria-controls="ribbon-band"
                className="ribbon-tab"
                data-active={isActive ? "true" : undefined}
                title={
                  isActive
                    ? "Doppelklick klappt die Befehlsleiste ein bzw. aus"
                    : tab.label
                }
                onClick={() => onTabClick(tab.id)}
                onDoubleClick={() => {
                  if (isActive) setCollapsed(!collapsed);
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <span className="ribbon-spacer" />

        <QuickActions />

        <button
          type="button"
          className="tb-btn tb-btn-ghost tb-btn-icon"
          aria-label={
            collapsed ? "Befehlsleiste ausklappen" : "Befehlsleiste einklappen"
          }
          aria-expanded={!collapsed}
          title={
            collapsed ? "Befehlsleiste ausklappen" : "Befehlsleiste einklappen"
          }
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? (
            <IconChevronDown className="tb-icon" />
          ) : (
            <IconChevronUp className="tb-icon" />
          )}
        </button>
      </div>

      {collapsed ? null : (
        <div
          id="ribbon-band"
          role="tabpanel"
          aria-labelledby={`ribbon-tab-${activeTab}`}
          aria-label={`Befehle: ${activeLabel}`}
          className="ribbon-band"
        >
          {activeTab === "start" ? (
            <StartTab fileCommands={fileCommands} />
          ) : null}
          {activeTab === "ansicht" ? <AnsichtTab /> : null}
          {activeTab === "modell" ? <ModellTab /> : null}
          {activeTab === "pruefen" ? <PruefenTab /> : null}
        </div>
      )}

      {hasDocuments ? (
        <div className="ribbon-doctabs">
          <DocumentTabs />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Ständige Aktionen rechts in der Registerzeile: Rückgängig/Wiederholen und
 * der Theme-Wechsel — erreichbar unabhängig vom aktiven Register.
 */
function QuickActions() {
  const docId = useDocuments((s) => s.activeId);
  const { undoLabel, redoLabel } = useUndoRedoLabels(docId);
  const undo = useCommands((s) => s.undo);
  const redo = useCommands((s) => s.redo);
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);

  return (
    <>
      <button
        type="button"
        className="tb-btn tb-btn-ghost tb-btn-icon"
        title={
          undoLabel ? `Rückgängig: ${undoLabel} (Strg+Z)` : "Rückgängig (Strg+Z)"
        }
        aria-label="Rückgängig"
        disabled={!docId || !undoLabel}
        onClick={() => docId && undo(docId)}
      >
        <IconUndo className="tb-icon" />
      </button>
      <button
        type="button"
        className="tb-btn tb-btn-ghost tb-btn-icon"
        title={
          redoLabel
            ? `Wiederholen: ${redoLabel} (Strg+Y)`
            : "Wiederholen (Strg+Y)"
        }
        aria-label="Wiederholen"
        disabled={!docId || !redoLabel}
        onClick={() => docId && redo(docId)}
      >
        <IconRedo className="tb-icon" />
      </button>
      <span className="tb-divider" aria-hidden="true" />
      <button
        type="button"
        className="tb-btn tb-btn-ghost tb-btn-icon"
        title={theme === "light" ? "Dunkles Theme" : "Helles Theme"}
        aria-label="Theme umschalten"
        onClick={() => setTheme(theme === "light" ? "dark" : "light")}
      >
        {theme === "light" ? (
          <IconMoon className="tb-icon" />
        ) : (
          <IconSun className="tb-icon" />
        )}
      </button>
    </>
  );
}
