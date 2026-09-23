/**
 * Zuletzt besuchte Projekte, Modelle und Issues (localStorage, max. 10) —
 * die Befehlspalette zeigt sie ohne Suchbegriff als Sprungziele.
 */

export interface RecentEntry {
  type: "project" | "model" | "issue";
  title: string;
  subtitle?: string;
  to: string;
  /** Für Modell-Icons. */
  kind?: "ifc" | "md" | "file";
  state?: "open" | "closed";
  at: number;
}

const KEY = "ifc-hub:recent";
const MAX = 10;

function load(): RecentEntry[] {
  if (!import.meta.client) return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]") as RecentEntry[];
    return Array.isArray(parsed) ? parsed.slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function useRecent() {
  const entries = useState<RecentEntry[]>("hub:recent", load);

  function track(entry: Omit<RecentEntry, "at">): void {
    const next = [
      { ...entry, at: Date.now() },
      ...entries.value.filter((existing) => existing.to !== entry.to),
    ].slice(0, MAX);
    entries.value = next;
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // nur Komfort
    }
  }

  function forget(prefix: string): void {
    entries.value = entries.value.filter((entry) => !entry.to.startsWith(prefix));
    try {
      localStorage.setItem(KEY, JSON.stringify(entries.value));
    } catch {
      // nur Komfort
    }
  }

  return { entries, track, forget };
}
