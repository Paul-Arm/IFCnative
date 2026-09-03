import type { ActionRun } from "~/types/api";

/**
 * Live-Events eines Action-Runs (Server-Sent Events über fetch, weil
 * EventSource keinen Authorization-Header setzen kann).
 *
 * Ereignisse: `status` (Run inkl. Log), `log` (Ausgabe-Chunk), `done`.
 * Endet, wenn der Run abgeschlossen ist oder `signal` abbricht.
 */

export interface RunStreamHandlers {
  onStatus?: (run: ActionRun & { log?: string }) => void;
  onLog?: (chunk: string) => void;
  onDone?: () => void;
}

export async function streamRunEvents(
  url: string,
  options: { token: string | null; signal?: AbortSignal } & RunStreamHandlers,
): Promise<void> {
  const headers: Record<string, string> = { accept: "text/event-stream" };
  if (options.token) {
    headers.authorization = `Bearer ${options.token}`;
  }
  const response = await fetch(url, { headers, signal: options.signal });
  if (!response.ok || !response.body) {
    let message = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // kein JSON-Body
    }
    throw new Error(message);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const dispatch = (block: string) => {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) {
        event = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        data.push(line.slice(5).trimStart());
      }
      // Kommentarzeilen (": ping") ignorieren.
    }
    if (!data.length) return;
    const payload = JSON.parse(data.join("\n")) as unknown;
    if (event === "status") {
      options.onStatus?.(payload as ActionRun & { log?: string });
    } else if (event === "log") {
      options.onLog?.((payload as { chunk: string }).chunk);
    } else if (event === "done") {
      options.onDone?.();
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = buffer.replace(/\r\n/g, "\n");
    let separator = buffer.indexOf("\n\n");
    while (separator >= 0) {
      const block = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      if (block.trim()) dispatch(block);
      separator = buffer.indexOf("\n\n");
    }
  }
  if (buffer.trim()) dispatch(buffer);
}
