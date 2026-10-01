/**
 * Tastenkürzel wie bei GitHub: „/“ bzw. Strg+K öffnet die Befehlspalette,
 * „g“ + Taste springt (g d = Dashboard, g i = Issues …), „?“ zeigt die
 * Übersicht. Greift nicht, solange in ein Eingabefeld geschrieben wird.
 */

export interface ShortcutHelp {
  keys: string[];
  label: string;
  group: string;
}

export const SHORTCUTS: ShortcutHelp[] = [
  { keys: ["/"], label: "Suchen oder springen", group: "Überall" },
  { keys: ["Strg", "K"], label: "Befehlspalette öffnen", group: "Überall" },
  { keys: ["?"], label: "Diese Übersicht", group: "Überall" },
  { keys: ["g", "d"], label: "Dashboard", group: "Überall" },
  { keys: ["g", "p"], label: "Alle Projekte", group: "Überall" },
  { keys: ["g", "b"], label: "Bibliothek", group: "Überall" },
  { keys: ["g", "f"], label: "Dateien", group: "Im Projekt" },
  { keys: ["g", "i"], label: "Issues", group: "Im Projekt" },
  { keys: ["g", "a"], label: "Actions", group: "Im Projekt" },
  { keys: ["g", "3"], label: "3D-Szene", group: "Im Projekt" },
  { keys: ["g", "e"], label: "Einstellungen", group: "Im Projekt" },
  { keys: ["c"], label: "Neues Issue", group: "Im Projekt" },
];

function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    element.isContentEditable ||
    Boolean(element.closest?.("[contenteditable=true], .ProseMirror"))
  );
}

export function useShortcuts() {
  const paletteOpen = useState<boolean>("hub:palette-open", () => false);
  const paletteQuery = useState<string>("hub:palette-query", () => "");
  const helpOpen = useState<boolean>("hub:shortcuts-open", () => false);

  function openPalette(query = ""): void {
    paletteQuery.value = query;
    paletteOpen.value = true;
  }

  function install(): void {
    if (!import.meta.client) return;
    const router = useRouter();
    const route = useRoute();
    let pendingG = 0;

    document.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (paletteOpen.value) {
          paletteOpen.value = false;
        } else {
          openPalette();
        }
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTyping(event.target) || paletteOpen.value || document.querySelector(".dialog-backdrop")) {
        return;
      }
      const project = typeof route.params.project === "string" ? route.params.project : null;

      if (pendingG && Date.now() - pendingG < 1200) {
        pendingG = 0;
        const targets: Record<string, string | null> = {
          d: "/",
          p: "/projects",
          b: "/library",
          f: project ? `/p/${project}` : null,
          i: project ? `/p/${project}/issues` : null,
          a: project ? `/p/${project}/actions` : null,
          "3": project ? `/p/${project}/3d` : null,
          e: project ? `/p/${project}/settings` : null,
        };
        const to = targets[event.key];
        if (to) {
          event.preventDefault();
          void router.push(to);
        }
        return;
      }

      if (event.key === "/") {
        event.preventDefault();
        openPalette();
      } else if (event.key === "?") {
        event.preventDefault();
        helpOpen.value = true;
      } else if (event.key === "g") {
        pendingG = Date.now();
      } else if (event.key === "c" && project) {
        event.preventDefault();
        void router.push(`/p/${project}/issues/new`);
      }
    });
  }

  return { paletteOpen, paletteQuery, helpOpen, openPalette, install };
}
