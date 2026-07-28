/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Ribbon-Kopfzeile. Aufbau und Bedienlogik folgen dem Ribbon des ifc-lite-
 * Viewers (LTplus-AG/ifc-lite, `apps/viewer/src/components/viewer/ribbon/
 * RibbonToolbar.tsx`, MPL-2.0), nachgebaut ohne dessen Abhängigkeiten:
 *
 *  - schmale Registerleiste, aktives Register mit Unterstrich statt Pille,
 *  - darunter das Band mit beschrifteten Befehlsgruppen,
 *  - Office-Konventionen: Doppelklick auf das aktive Register (oder der
 *    Pfeil rechts) klappt das Band ein, der Zustand bleibt gespeichert;
 *    ein Klick auf irgendein Register klappt es wieder auf,
 *  - das versteckte Datei-Input bleibt außerhalb der Register montiert,
 *    damit „IFC öffnen" auch im eingeklappten Zustand weiterläuft.
 */
import { useState } from "react";
import { loadJson, saveJson } from "../../core/storage";
import { IconChevronDown, IconChevronUp } from "./icons";
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
  // Das aktive Register ist bewusst flüchtig (wie im Original), der
  // Einklapp-Zustand dagegen eine Nutzerentscheidung und persistent.
  const [activeTab, setActiveTab] = useState<RibbonTabId>("start");
  const [collapsed, setCollapsedState] = useState(() =>
    loadJson<boolean>(COLLAPSED_KEY, false),
  );
  const fileCommands = useFileOpen();

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
        <strong className="ribbon-brand">IFCnative 2.0</strong>
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
                    ? "Doppelklick klappt das Menüband ein bzw. aus"
                    : tab.label
                }
                onClick={() => onTabClick(tab.id)}
                onDoubleClick={() => {
                  if (isActive) setCollapsed(!collapsed);
                }}
              >
                {tab.label}
                {isActive ? (
                  <span aria-hidden="true" className="ribbon-tab-underline" />
                ) : null}
              </button>
            );
          })}
        </div>

        <span className="ribbon-tabs-spacer" />

        <button
          type="button"
          className="ribbon-collapse"
          aria-label={
            collapsed ? "Menüband ausklappen" : "Menüband einklappen"
          }
          aria-expanded={!collapsed}
          title={collapsed ? "Menüband ausklappen" : "Menüband einklappen"}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? (
            <IconChevronDown className="ribbon-icon-sm" />
          ) : (
            <IconChevronUp className="ribbon-icon-sm" />
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
    </div>
  );
}
