/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Ribbon-Bausteine, zweite Generation: statt des Office-Bands (große
 * Icon-über-Text-Schalter, Stapel, Gruppenlabels) eine einzeilige, kompakte
 * Befehlsleiste im Design der ersten React-App — 28px-Buttons mit Icon und
 * Text nebeneinander, Toggles als Teal-Tönung, Gruppen nur noch durch
 * Haarlinien getrennt (der Gruppenname bleibt als aria-label erhalten).
 *
 * Die Export-Namen (RibbonLargeButton/RibbonSmallButton/RibbonSmallStack)
 * bleiben bestehen, damit die Register-Dateien unverändert weiterlaufen —
 * groß und klein rendern jetzt denselben Baustein.
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
  /** "primary" = gefüllter Teal-Button (Hauptbefehl des Registers). */
  variant?: "primary";
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
}

function titleOf(label: string, tooltip?: string, shortcut?: string): string {
  const base = tooltip ?? label;
  return shortcut ? `${base} (${shortcut})` : base;
}

/**
 * Fokusring nach dem Klick abwerfen — sonst bleibt der zuletzt gedrückte
 * Schalter dauerhaft hervorgehoben.
 */
function blurThenRun(
  event: MouseEvent<HTMLButtonElement>,
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void,
): void {
  event.currentTarget.blur();
  onClick?.(event);
}

function RibbonButton({
  icon: Icon,
  label,
  tooltip,
  shortcut,
  active,
  disabled,
  hasMenu,
  badge,
  variant,
  onClick,
}: RibbonButtonProps) {
  const variantClass =
    variant === "primary" ? "tb-btn-primary" : "tb-btn-ghost";
  return (
    <button
      type="button"
      className={`tb-btn ${variantClass} rb-btn`}
      title={titleOf(label, tooltip, shortcut)}
      aria-label={tooltip ?? label}
      aria-pressed={active}
      data-active={active ? "true" : undefined}
      disabled={disabled}
      onClick={(event) => blurThenRun(event, onClick)}
    >
      <Icon className="tb-icon" />
      <span className="rb-btn-text">{label}</span>
      {hasMenu ? <IconChevronDown className="tb-icon-xs" /> : null}
      {badge}
    </button>
  );
}

export function RibbonLargeButton(props: RibbonButtonProps) {
  return <RibbonButton {...props} />;
}

export function RibbonSmallButton(props: RibbonButtonProps) {
  return <RibbonButton {...props} />;
}

/** Früher ein senkrechter Stapel — jetzt fließen die Schalter in der Zeile. */
export function RibbonSmallStack({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/** Befehlsgruppe: nur noch logisch (aria-label), optisch eine Button-Reihe. */
export function RibbonGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div role="group" aria-label={label} className="rb-group">
      {children}
    </div>
  );
}

/** Haarlinie zwischen zwei Gruppen. */
export function RibbonGroupDivider() {
  return <span aria-hidden="true" className="rb-divider" />;
}
