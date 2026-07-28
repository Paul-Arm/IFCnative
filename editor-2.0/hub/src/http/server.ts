/**
 * Fastify-Instanz des Hubs. `buildServer()` ist bewusst von `listen()`
 * getrennt: die Tests fahren dieselbe App über `inject()`, ohne einen Port zu
 * belegen, und `main.ts` bindet sie an die konfigurierte Adresse.
 */
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { HubService } from "../service.js";
import { HubError } from "../errors.js";
import { makeAuthHook } from "./auth.js";
import { registerRoutes } from "./routes.js";

/** 1 GiB — IFC-Dateien sind groß; der Standard von Fastify (1 MiB) reicht nicht. */
const BODY_LIMIT = 1024 * 1024 * 1024;

export interface ServerOptions {
  service: HubService;
  /** Leerer String = keine Token-Prüfung. */
  token?: string;
  logger?: boolean;
}

export async function buildServer(
  options: ServerOptions,
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: BODY_LIMIT,
  });

  // Offen für die App: im Standalone-Betrieb ruft ein Tauri-WebView mit
  // wechselnder Origin an, im Team-Betrieb schützt das Bearer-Token.
  await app.register(cors, { origin: true, exposedHeaders: ["x-hub-blob-hash"] });

  // IFC-Rümpfe unverändert als Buffer durchreichen. Der `*`-Fallback fängt
  // Clients ab, die keinen oder einen abweichenden Content-Type senden;
  // `application/json` bleibt vom eingebauten Parser bedient.
  const raw = (
    _request: unknown,
    body: Buffer,
    done: (error: Error | null, result?: unknown) => void,
  ): void => done(null, body);
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer" },
    raw,
  );
  app.addContentTypeParser("*", { parseAs: "buffer" }, raw);

  const authHook = makeAuthHook(options.token ?? "");
  if (authHook) app.addHook("onRequest", authHook);

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof HubError) {
      reply.code(error.status).send({ error: error.message });
      return;
    }
    // Fastify-eigene Fehler (Body zu groß, kaputtes JSON …) tragen statusCode.
    const carrier = error as { statusCode?: unknown; message?: unknown };
    const status =
      typeof carrier.statusCode === "number" ? carrier.statusCode : 500;
    if (status >= 500) {
      request.log.error({ err: error }, "Unbehandelter Fehler im Hub");
      reply.code(status).send({ error: "Interner Fehler im Hub." });
      return;
    }
    const message =
      typeof carrier.message === "string" ? carrier.message : "Fehlerhafte Anfrage.";
    reply.code(status).send({ error: message });
  });

  app.setNotFoundHandler((request, reply) => {
    reply
      .code(404)
      .send({ error: `Route ${request.method} ${request.url} gibt es nicht.` });
  });

  registerRoutes(app, options.service);
  await app.ready();
  return app;
}
