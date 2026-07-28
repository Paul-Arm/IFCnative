/**
 * Persistenz für UI-Zustand (Workspaces, Theme, Notizen, Recents).
 * M1: localStorage; die Tauri-Store-Ablage ersetzt das später transparent.
 */
const PREFIX = "ifcnative2:";

export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // volle/gesperrte Storage niemals zum App-Fehler machen
  }
}
