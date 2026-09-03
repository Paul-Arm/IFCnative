import type { FastifyError, FastifyInstance, FastifyRequest } from "fastify";

/**
 * Zeilenbasiertes Request- und Fehler-Log auf stdout/stderr.
 *
 * Bewusst kein pino/JSON: Die Zeilen sollen in Dokploy/`docker logs` direkt
 * lesbar sein. Je Request eine Zeile mit Methode, Pfad, Status, Dauer,
 * Client-IP (per trustProxy aus X-Forwarded-For) und angemeldetem Benutzer;
 * Fehler zusaetzlich mit Stacktrace.
 */

export interface RequestLogOptions {
  /** Requests protokollieren (Fehler werden immer protokolliert). */
  requests?: boolean;
  /** Healthchecks vom lokalen Host (Docker) nicht protokollieren. */
  skipLocalHealth?: boolean;
}

function timestamp(): string {
  return new Date().toISOString();
}

function clientInfo(request: FastifyRequest): string {
  const raw = request.socket?.remoteAddress ?? "-";
  const forwarded = request.headers["x-forwarded-for"];
  const fwd = Array.isArray(forwarded) ? forwarded.join(",") : forwarded;
  // request.ip ist bei trustProxy bereits die erste X-Forwarded-For-Adresse.
  const parts = [`ip=${request.ip}`];
  if (fwd && fwd !== request.ip) parts.push(`xff=${fwd}`);
  if (raw !== request.ip) parts.push(`peer=${raw}`);
  const user = (request as { user?: { email?: string } }).user?.email;
  if (user) parts.push(`user=${user}`);
  return parts.join(" ");
}

function isLocalHealth(request: FastifyRequest): boolean {
  const ip = request.socket?.remoteAddress ?? "";
  return (
    request.url === "/api/health" &&
    (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1")
  );
}

export function registerRequestLog(
  app: FastifyInstance,
  options: RequestLogOptions = {},
): void {
  const logRequests = options.requests ?? true;
  const skipLocalHealth = options.skipLocalHealth ?? true;

  if (logRequests) {
    app.addHook("onResponse", (request, reply, done) => {
      if (!(skipLocalHealth && isLocalHealth(request))) {
        const ms = reply.elapsedTime.toFixed(1);
        const ua = request.headers["user-agent"];
        console.log(
          `${timestamp()} ${request.method} ${request.url} ${reply.statusCode} ${ms}ms ${clientInfo(request)}` +
            (ua ? ` ua="${ua}"` : ""),
        );
      }
      done();
    });
  }

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status =
      typeof error.statusCode === "number" && error.statusCode >= 400
        ? error.statusCode
        : 500;
    const head = `${timestamp()} ERROR ${request.method} ${request.url} ${status} ${clientInfo(request)}`;
    if (status >= 500) {
      console.error(head);
      console.error(error.stack ?? error);
    } else {
      // Client-Fehler (413 Body zu gross, 415, JWT-Fehler ...) ohne Stack.
      console.error(`${head} ${error.code ?? ""} ${error.message}`.trimEnd());
    }
    if (reply.sent) return;
    reply.code(status).send({
      error: status >= 500 ? "Internal Server Error" : error.message,
      ...(error.code ? { code: error.code } : {}),
    });
  });
}

/** Unbehandelte Fehler des Prozesses sichtbar machen statt stumm zu sterben. */
export function installProcessErrorLog(): void {
  process.on("unhandledRejection", (reason) => {
    console.error(`${timestamp()} UNHANDLED REJECTION`);
    console.error(reason instanceof Error ? (reason.stack ?? reason) : reason);
  });
  process.on("uncaughtException", (error) => {
    console.error(`${timestamp()} UNCAUGHT EXCEPTION`);
    console.error(error.stack ?? error);
    process.exit(1);
  });
}
