import { useCallback, useSyncExternalStore } from "react";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "ifcnative:theme:v1";

let currentPreference: ThemePreference = readStoredPreference();
const listeners = new Set<() => void>();

function readStoredPreference(): ThemePreference {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") {
      return raw;
    }
  } catch {
    // localStorage unavailable (e.g. detached window bootstrap)
  }
  return "system";
}

// Einmalig erzeugen: matchMedia() alloziert sonst bei jedem Snapshot-Read
// eine neue MediaQueryList.
const darkSchemeQuery: MediaQueryList | undefined = globalThis.matchMedia?.(
  "(prefers-color-scheme: dark)",
);

function systemPrefersDark(): boolean {
  return darkSchemeQuery?.matches ?? false;
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === "system") {
    return systemPrefersDark() ? "dark" : "light";
  }
  return preference;
}

export function applyThemeToDocument(doc: Document = globalThis.document) {
  const resolved = resolveTheme(currentPreference);
  doc.documentElement.classList.toggle("dark", resolved === "dark");
  doc.documentElement.style.colorScheme = resolved;
}

function setPreference(next: ThemePreference) {
  currentPreference = next;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, next);
  } catch {
    // ignore
  }
  applyThemeToDocument();
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Initialize theming once at startup (before first paint if possible). */
export function initTheme() {
  applyThemeToDocument();
  darkSchemeQuery?.addEventListener("change", () => {
    if (currentPreference === "system") {
      applyThemeToDocument();
      for (const listener of listeners) {
        listener();
      }
    }
  });
}

export function useTheme() {
  const preference = useSyncExternalStore(
    subscribe,
    () => currentPreference,
    () => currentPreference,
  );
  const resolved = useSyncExternalStore(
    subscribe,
    () => resolveTheme(currentPreference),
    () => resolveTheme(currentPreference),
  );

  const setTheme = useCallback((next: ThemePreference) => {
    setPreference(next);
  }, []);

  // Anwendung aufs Dokument passiert zentral in setPreference/initTheme;
  // abgedockte Kindfenster spiegeln die Root-Klasse selbst (child-window.tsx).
  return { theme: preference, resolvedTheme: resolved, setTheme };
}
