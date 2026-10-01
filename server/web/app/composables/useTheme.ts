/**
 * Farbschema: "system" folgt dem Betriebssystem, "light"/"dark" sind fest.
 *
 * Die Wahl liegt in localStorage (`ifc-hub:theme`) und wird als
 * <html data-theme="…"> gesetzt; tokens.css schaltet darüber `color-scheme`
 * und damit alle light-dark()-Tokens. Ein Inline-Skript im <head>
 * (nuxt.config) setzt das Attribut schon vor dem ersten Paint.
 */

export type ThemePreference = "system" | "light" | "dark";

const STORAGE_KEY = "ifc-hub:theme";

function readPreference(): ThemePreference {
  if (!import.meta.client) return "system";
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

function systemPrefersDark(): boolean {
  return import.meta.client
    ? window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false
    : false;
}

export function useTheme() {
  const preference = useState<ThemePreference>("hub:theme", readPreference);
  const systemDark = useState<boolean>("hub:theme-system-dark", systemPrefersDark);

  const resolved = computed<"light" | "dark">(() =>
    preference.value === "system"
      ? systemDark.value
        ? "dark"
        : "light"
      : preference.value,
  );

  function apply(value: ThemePreference): void {
    if (!import.meta.client) return;
    const root = document.documentElement;
    if (value === "system") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", value);
    }
  }

  function setPreference(value: ThemePreference): void {
    preference.value = value;
    apply(value);
    try {
      if (value === "system") {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, value);
      }
    } catch {
      // Ohne Storage gilt die Wahl nur bis zum Neuladen.
    }
  }

  /** Einmalig im App-Root: System-Wechsel beobachten. */
  function install(): void {
    if (!import.meta.client) return;
    apply(preference.value);
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    media?.addEventListener("change", (event) => {
      systemDark.value = event.matches;
    });
  }

  return { preference, resolved, setPreference, install };
}

/** Inline-Skript für den <head>: data-theme vor dem ersten Paint setzen. */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem("${STORAGE_KEY}");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;
