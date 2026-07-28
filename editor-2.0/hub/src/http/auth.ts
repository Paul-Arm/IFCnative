/**
 * Auth-Vorbereitung: optionales Bearer-Token.
 *
 * Ist `HUB_TOKEN` gesetzt, brauchen alle `/api`-Routen außer `/api/health` den
 * Header `Authorization: Bearer <token>`. Ohne Token bleibt der Hub offen —
 * das ist der Standalone-Fall auf `127.0.0.1`.
 *
 * Bewusst NICHT enthalten (nächste Stufe, siehe README): Rollen je Projekt
 * (Viewer/Commenter/Editor/Admin), JWT und Collab-Räume aus
 * `@ifc-lite/collab-server` via `startCollabServer()`.
 */
import { timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { unauthorized } from "../errors.js";

/** Pfade, die auch mit gesetztem Token frei erreichbar bleiben. */
const PUBLIC_PATHS = new Set(["/api/health"]);

/** Vergleicht laufzeitkonstant, damit das Token nicht erratbar wird. */
function tokenMatches(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(actual, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function bearerOf(header: string | undefined): string {
  if (!header) return "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() ?? "";
}

/**
 * Baut den `onRequest`-Hook. Rückgabe `null`, wenn kein Token konfiguriert
 * ist — dann wird gar kein Hook registriert.
 */
export function makeAuthHook(
  token: string,
): ((request: FastifyRequest, reply: FastifyReply) => Promise<void>) | null {
  if (token === "") return null;
  return async (request: FastifyRequest): Promise<void> => {
    const path = request.url.split("?")[0] ?? request.url;
    if (!path.startsWith("/api/") || PUBLIC_PATHS.has(path)) return;
    const presented = bearerOf(request.headers.authorization);
    if (presented === "") {
      throw unauthorized(
        "Zugriff verweigert: Header „Authorization: Bearer <Token>“ fehlt.",
      );
    }
    if (!tokenMatches(token, presented)) {
      throw unauthorized("Zugriff verweigert: ungültiges Token.");
    }
  };
}
