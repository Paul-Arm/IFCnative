/** Used inside the Web Worker; failed requests pause reporting instead of retrying. */
export function createTelemetryTransport(
  isOnline: () => boolean,
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
) {
  let retryAfter = 0;
  const canSend = () => isOnline() && now() >= retryAfter;
  const send: typeof fetch = async (input, init) => {
    if (!canSend()) throw new Error("Telemetry paused");
    try {
      const response = await fetcher(input, {
        ...init, signal: AbortSignal.timeout(4000), credentials: "omit", referrerPolicy: "no-referrer", redirect: "error",
      });
      if (!response.ok) {
        const delay = Number(response.headers.get("Retry-After")) || 60;
        retryAfter = now() + Math.min(3600, Math.max(60, delay)) * 1000;
      }
      return response;
    } catch {
      retryAfter = now() + 60_000;
      throw new Error("Telemetry unavailable");
    }
  };
  return { canSend, send };
}
