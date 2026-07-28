/**
 * Datentypen der Hub-API (editor-2.0/hub, parallel im Bau).
 *
 * Die Typen bilden den vereinbarten Vertrag ab — NICHT den Code des Dienstes.
 * Alles, was über die Leitung kommt, läuft vorher durch `normalize.ts`; die
 * Felder hier sind deshalb garantiert vorhanden und richtig typisiert.
 */

/** Basis-URL + optionales Bearer-Token einer Hub-Verbindung. */
export interface HubConfig {
  baseUrl: string;
  token: string;
}

/** GET /api/health */
export interface HubHealth {
  ok: boolean;
  version: string;
}

/** GET/POST /api/projects */
export interface HubProject {
  id: string;
  name: string;
}

/** GET/POST /api/projects/:pid/models */
export interface HubModel {
  id: string;
  name: string;
}

/** GET /api/projects/:pid/models/:mid/versions */
export interface HubVersion {
  id: string;
  message: string;
  author: string;
  /** ISO-Zeitstempel; kann leer sein, wenn der Hub nichts liefert. */
  createdAt: string;
  schema: string;
  entityCount: number;
  byteSize: number;
  blobHash: string;
}

/**
 * Ein Element im Vergleich. `globalId` ist der einzige verlässliche Anker in
 * ein lokal geöffnetes Modell — `expressId` gilt nur innerhalb des Standes,
 * aus dem der Hub den Vergleich gerechnet hat, und dient allein der Anzeige.
 */
export interface HubDiffElement {
  globalId: string;
  expressId?: number;
  label?: string;
}

export interface HubDiffSummary {
  added: number;
  removed: number;
  modified: number;
}

/** GET /api/projects/:pid/models/:mid/versions/:vid/diff/:otherVid */
export interface HubDiff {
  added: HubDiffElement[];
  removed: HubDiffElement[];
  modified: HubDiffElement[];
  summary: HubDiffSummary;
}

/** Art eines Hub-Fehlers — steuert die Meldung und die Statusanzeige. */
export type HubErrorKind =
  | "config"
  | "offline"
  | "timeout"
  | "http"
  | "format";
