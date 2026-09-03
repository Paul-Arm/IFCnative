/**
 * Fragments eines Commits laden — mit Warten auf die Server-Konvertierung
 * und Download-Fortschritt.
 *
 * Der Server antwortet 202 + `{ status: "converting", elapsedMs }`, solange
 * die IFC noch konvertiert wird (kann bei großen Modellen Minuten dauern);
 * dann wird alle paar Sekunden erneut gefragt. Bei 200 kommt der Body als
 * Stream, damit der Viewer einen echten Prozentbalken zeigen kann.
 */

export type FragmentsPhase = "converting" | "downloading";

export interface FragmentsProgress {
  phase: FragmentsPhase;
  /** Konvertierung: Laufzeit auf dem Server. */
  elapsedMs?: number;
  /** Download: empfangene / erwartete Bytes (total fehlt ohne Content-Length). */
  received?: number;
  total?: number;
}

export interface FetchFragmentsOptions {
  token: string | null;
  signal?: AbortSignal;
  onProgress?: (progress: FragmentsProgress) => void;
  /** Abstand der Polls während der Konvertierung (ms). */
  pollMs?: number;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Abgebrochen", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Abgebrochen", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    if (body?.error) return body.error;
  } catch {
    // kein JSON-Body
  }
  return `HTTP ${response.status}`;
}

export function isAbortError(error: unknown): boolean {
  return (
    (error as { name?: string })?.name === "AbortError" ||
    (error as { code?: number })?.code === 20
  );
}

export async function fetchFragments(
  url: string,
  options: FetchFragmentsOptions,
): Promise<ArrayBuffer> {
  const headers: Record<string, string> = {};
  if (options.token) {
    headers.authorization = `Bearer ${options.token}`;
  }
  const pollMs = options.pollMs ?? 3000;

  for (;;) {
    const response = await fetch(url, { headers, signal: options.signal });
    if (response.status === 202) {
      const body = (await response.json().catch(() => ({}))) as {
        elapsedMs?: number;
      };
      options.onProgress?.({ phase: "converting", elapsedMs: body.elapsedMs });
      await sleep(pollMs, options.signal);
      continue;
    }
    if (!response.ok) {
      throw new Error(await errorMessage(response));
    }

    const total = Number(response.headers.get("content-length")) || undefined;
    options.onProgress?.({ phase: "downloading", received: 0, total });
    if (!response.body) {
      return response.arrayBuffer();
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      options.onProgress?.({ phase: "downloading", received, total });
    }
    const result = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result.buffer;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function formatElapsed(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${String(seconds % 60).padStart(2, "0")} s`;
}
