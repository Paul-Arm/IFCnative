/**
 * Gemeinsamer Befund-Vertrag des Prüfzentrums (M5). Alle Prüfquellen
 * (Modell-Diagnostik, Objektinfo, IDS, Clash) liefern CheckFinding-Listen;
 * die UI aggregiert, filtert und koppelt sie an Auswahl und 3D.
 */
export type CheckSeverity = "error" | "warning" | "info";

export type CheckSourceId = "diagnostics" | "object-info" | "ids" | "clash";

export interface CheckFinding {
  /** stabil innerhalb eines Laufs: `${source}:${kind}:${entityId}:${n}` */
  id: string;
  source: CheckSourceId;
  /** maschinenlesbare Befundart, z. B. "duplicate-global-id" */
  kind: string;
  severity: CheckSeverity;
  /** deutscher Meldungstext */
  message: string;
  /** betroffene Objekte (expressIds); erste Id = primäres Ziel */
  entityIds: number[];
  /** optionale Zusatzinfo (Pset/Property, IDS-Spezifikation, Distanz …) */
  detail?: string;
}

export interface CheckRunResult {
  source: CheckSourceId;
  findings: CheckFinding[];
  /** Laufzeit in ms, für die Statuszeile */
  durationMs: number;
  /** Anzahl geprüfter Objekte (für „bestanden"-Statistik) */
  checkedCount: number;
}

export const SEVERITY_LABELS: Record<CheckSeverity, string> = {
  error: "Fehler",
  warning: "Warnung",
  info: "Hinweis",
};

export const SOURCE_LABELS: Record<CheckSourceId, string> = {
  diagnostics: "Modell-Diagnostik",
  "object-info": "Objektinfo-IDs",
  ids: "IDS",
  clash: "Kollisionen",
};
