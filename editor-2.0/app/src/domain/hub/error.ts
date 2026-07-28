/**
 * Fehlerobjekt des Hub-Clients. Jede Meldung ist deutsch und für die
 * Statuszeile einer Pane gedacht — die UI zeigt `error.message` unverändert.
 */
import type { HubErrorKind } from "./types";

/** Hinweis für den häufigsten Fall: der Dienst läuft schlicht nicht. */
export const HUB_OFFLINE_HINT =
  "Hub nicht erreichbar — läuft der Dienst? editor-2.0/hub: npm start";

export class HubError extends Error {
  constructor(
    message: string,
    readonly kind: HubErrorKind,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "HubError";
  }

  /** Verbindung steht grundsätzlich nicht (Statuspunkt auf „getrennt"). */
  get isOffline(): boolean {
    return this.kind === "offline" || this.kind === "timeout";
  }
}

/**
 * Beliebigen Fehlerwert in eine anzeigbare deutsche Meldung übersetzen.
 * Panes rufen das in jedem catch-Zweig auf.
 */
export function hubErrorMessage(cause: unknown): string {
  if (cause instanceof HubError) return cause.message;
  if (cause instanceof Error && cause.message) return cause.message;
  return String(cause);
}

/** Fehlertexte des Servers werden gekürzt an die Meldung gehängt. */
const DETAIL_LIMIT = 200;

/** Antwortkörper für die Fehlermeldung aufbereiten (JSON-Feld oder Rohtext). */
async function detailOf(response: Response): Promise<string> {
  let body = "";
  try {
    body = (await response.text()).trim();
  } catch {
    return "";
  }
  if (!body) return "";
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed !== null && typeof parsed === "object") {
      const source = parsed as Record<string, unknown>;
      const field = source["error"] ?? source["message"];
      if (typeof field === "string" && field) body = field;
    }
  } catch {
    // Kein JSON — Rohtext verwenden.
  }
  return body.length > DETAIL_LIMIT ? `${body.slice(0, DETAIL_LIMIT)} …` : body;
}

/** HTTP-Status in eine deutsche, handlungsleitende Meldung übersetzen. */
export async function httpError(response: Response): Promise<HubError> {
  const detail = await detailOf(response);
  const suffix = detail ? ` — ${detail}` : "";
  const status = response.status;
  if (status === 401 || status === 403) {
    return new HubError(
      `Zugriff verweigert (HTTP ${status}) — Token prüfen.${suffix}`,
      "http",
      status,
    );
  }
  if (status === 404) {
    return new HubError(
      `Nicht gefunden (HTTP 404) — Projekt, Modell oder Stand existiert nicht (mehr).${suffix}`,
      "http",
      404,
    );
  }
  if (status >= 500) {
    return new HubError(
      `Der Hub meldet einen Serverfehler (HTTP ${status}).${suffix}`,
      "http",
      status,
    );
  }
  return new HubError(
    `Der Hub hat die Anfrage abgelehnt (HTTP ${status}).${suffix}`,
    "http",
    status,
  );
}
