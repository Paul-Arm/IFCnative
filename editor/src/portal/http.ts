/**
 * Fetch-Wrapper für das MKP-Portal. Im Browser-Dev-Modus laufen die
 * "/mkp/*"-Pfade über den Vite-Dev-Proxy (vite.config.mts). Im gepackten
 * Tauri-Build gibt es diesen Proxy nicht: dort werden die Pfade auf die
 * echten Hosts umgeschrieben und die Requests über das Tauri-HTTP-Plugin
 * geschickt (umgeht CORS der WebView).
 */

/** Muss zu server.proxy in vite.config.mts passen. */
const DEV_PROXY_TARGETS: Record<string, string> = {
  "/mkp/auth": "https://auth.marxkrontal.com",
  "/mkp/local": "http://localhost:8000",
  "/mkp/portal": "https://portal.dev.marxkrontal.com",
};

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Übersetzt Dev-Proxy-Pfade ("/mkp/*") in absolute URLs (nur unter Tauri). */
export function resolvePortalUrl(url: string): string {
  if (!isTauri()) {
    return url;
  }
  for (const [prefix, target] of Object.entries(DEV_PROXY_TARGETS)) {
    if (url === prefix || url.startsWith(`${prefix}/`)) {
      return `${target}${url.slice(prefix.length)}`;
    }
  }
  return url;
}

/** fetch-Ersatz: Tauri-HTTP-Plugin unter Tauri, sonst window.fetch. */
export async function portalFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const resolved = resolvePortalUrl(url);
  if (isTauri()) {
    const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
    return tauriFetch(resolved, init);
  }
  return fetch(resolved, init);
}
