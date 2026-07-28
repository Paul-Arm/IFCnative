/** Anzeigeformate der Hub-Pane (deutsche Lokalisierung). */
import type { HubVersion } from "../../domain/hub/types";

const UNITS = ["Byte", "KB", "MB", "GB"] as const;

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < UNITS.length - 1) {
    size /= 1024;
    unit++;
  }
  const digits = unit === 0 || size >= 100 ? 0 : 1;
  return `${size.toLocaleString("de-DE", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  })} ${UNITS[unit]}`;
}

export function formatCount(value: number): string {
  return Number.isFinite(value) && value > 0
    ? value.toLocaleString("de-DE")
    : "—";
}

/** ISO-Zeitstempel des Hubs; unparsbare Werte bleiben unverändert sichtbar. */
export function formatDate(iso: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString("de-DE");
}

/** Kurzform einer Id für Tabellen und Dateinamen. */
export function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

/** Beschriftung eines Standes — leere Nachrichten fallen auf die Id zurück. */
export function versionLabel(version: HubVersion): string {
  return version.message.trim() || `Stand ${shortId(version.id)}`;
}

/** Dateiname für ein aus dem Hub geöffnetes Dokument. */
export function documentNameFor(
  modelName: string,
  version: HubVersion,
): string {
  const base = modelName.trim() || "Hub-Modell";
  return `${base} @ ${shortId(version.id)}.ifc`;
}
