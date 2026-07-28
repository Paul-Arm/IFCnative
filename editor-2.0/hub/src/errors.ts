/**
 * Fehler mit HTTP-Status. Die HTTP-Schicht macht daraus `{ error }`.
 * Alle Meldungen sind deutsch und für die Anzeige in der App gedacht.
 */
export class HubError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HubError";
  }
}

/** 404 — angefragte Ressource existiert nicht. */
export function notFound(what: string): HubError {
  return new HubError(404, `${what} nicht gefunden.`);
}

/** 400 — Anfrage ist syntaktisch da, aber inhaltlich unbrauchbar. */
export function badRequest(message: string): HubError {
  return new HubError(400, message);
}

/** 401 — Bearer-Token fehlt oder passt nicht. */
export function unauthorized(message: string): HubError {
  return new HubError(401, message);
}

/** 422 — Nutzdaten sind kein verarbeitbares IFC. */
export function unprocessable(message: string): HubError {
  return new HubError(422, message);
}
