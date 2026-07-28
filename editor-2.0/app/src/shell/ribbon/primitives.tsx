/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Ribbon-Bausteine. Aufbau und Benennung folgen dem Ribbon des ifc-lite-
 * Viewers (LTplus-AG/ifc-lite, `apps/viewer/src/components/viewer/ribbon/
 * primitives.tsx`, MPL-2.0): eine beschriftete Gruppe hält entweder große
 * Ein-Befehl-Schalter (Icon über zweizeiliger Beschriftung) oder Stapel
 * kleiner Icon+Text-Zeilen, der Gruppenname steht darunter in Kapitälchen.
 *
 * Nachgebaut statt kopiert: das Original hängt an Tailwind, shadcn/ui und
 * lucide-react — hier tragen die Klassen aus `global.css` das Aussehen und
 * binden es an unsere Token (--bg-panel/--border/--accent/--text-dim).
 */
import type { MouseEvent, ReactNode } from "react";
import type { IconComponent } from "./icons";
import { IconChevronDown } from "./icons";

export interface RibbonButtonProps {
  icon: IconComponent;
  label: string;
  /** Tooltip-Text; ohne Angabe dient die Beschriftung als Titel. */
  tooltip?: string;
  /** Tastenkürzel, erscheint in Klammern im Tooltip. */
  shortcut?: string;
  /** Gedrückt-Zustand (setzt zusätzlich aria-pressed). */
  active?: boolean;
  disabled?: boolean;
  /** Zeigt den Menü-Pfeil an. */
  hasMenu?: boolean;
  badge?: ReactNode;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
}

function titleOf(label: string, tooltip?: string, shortcut?: string): string {
  const base = tooltip ?? label;
  return shortcut ? `${base} (${shortcut})` : base;
}

/**
 * Fokusring nach dem Klick abwerfen — wie im Original, sonst bleibt der
 * zuletzt gedrückte Ribbon-Schalter dauerhaft hervorgehoben.
 */
function blurThenRun(
  event: MouseEvent<HTMLButtonElement>,
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void,
): void {
  event.currentTarget.blur();
  onClick?.(event);
}

export function RibbonLargeButton({
  icon: Icon,
  label,
  tooltip,
  shortcut,
  active,
  disabled,
  hasMenu,
  badge,
  onClick,
}: RibbonButtonProps) {
  return (
    <button
      type="button"
      className="ribbon-btn ribbon-btn-large"
      title={titleOf(label, tooltip, shortcut)}
      aria-label={tooltip ?? label}
      aria-pressed={active}
      data-active={active ? "true" : undefined}
      disabled={disabled}
      onClick={(event) => blurThenRun(event, onClick)}
    >
      <Icon className="ribbon-icon-lg" />
      <span className="ribbon-btn-label">
        <span className="ribbon-btn-text">{label}</span>
        {hasMenu ? <IconChevronDown className="ribbon-icon-xs" /> : null}
      </span>
      {badge}
    </button>
  );
}

export function RibbonSmallButton({
  icon: Icon,
  label,
  tooltip,
  shortcut,
  active,
  disabled,
  hasMenu,
  badge,
  onClick,
}: RibbonButtonProps) {
  return (
    <button
      type="button"
      className="ribbon-btn ribbon-btn-small"
      title={titleOf(label, tooltip, shortcut)}
      aria-label={tooltip ?? label}
      aria-pressed={active}
      data-active={active ? "true" : undefined}
      disabled={disabled}
      onClick={(event) => blurThenRun(event, onClick)}
    >
      <Icon className="ribbon-icon-sm" />
      <span className="ribbon-btn-text">{label}</span>
      {hasMenu ? <IconChevronDown className="ribbon-icon-xs" /> : null}
      {badge}
    </button>
  );
}

/** Senkrechter Stapel kleiner Schalter (bis zu drei je Ribbon-Höhe). */
export function RibbonSmallStack({ children }: { children: ReactNode }) {
  return <div className="ribbon-stack">{children}</div>;
}

/** Beschriftete Befehlsgruppe: Inhalt oben, Gruppenname darunter. */
export function RibbonGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div role="group" aria-label={label} className="ribbon-group">
      <div className="ribbon-group-items">{children}</div>
      <div className="ribbon-group-label">{label}</div>
    </div>
  );
}

/** Haarlinie zwischen zwei Gruppen. */
export function RibbonGroupDivider() {
  return <div aria-hidden="true" className="ribbon-divider" />;
}
