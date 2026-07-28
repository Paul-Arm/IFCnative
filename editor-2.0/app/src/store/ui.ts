/**
 * UI-Slice: Theme, UI-Skalierung, Workspaces (Mosaic-Layouts), Notizen,
 * zuletzt verwendete Dateien. Persistiert über core/storage.
 */
import { create } from "zustand";
import type { MosaicNode } from "react-mosaic-component";
import { loadJson, saveJson } from "../core/storage";
import type { PaneId } from "../panes/ids";
import { BUILTIN_WORKSPACES } from "../panes/workspaces";

export type Theme = "light" | "dark";

export interface RecentFile {
  fileName: string;
  entityCount: number;
  schema: string;
  openedAt: string;
}

export interface CustomWorkspace {
  name: string;
  layout: MosaicNode<PaneId>;
}

interface UiState {
  theme: Theme;
  uiScale: number;
  workspaceName: string;
  layout: MosaicNode<PaneId> | null;
  customWorkspaces: CustomWorkspace[];
  notes: string;
  recents: RecentFile[];

  setTheme(theme: Theme): void;
  setUiScale(scale: number): void;
  setLayout(layout: MosaicNode<PaneId> | null): void;
  switchWorkspace(name: string): void;
  saveCurrentAsWorkspace(name: string): void;
  deleteWorkspace(name: string): void;
  setNotes(notes: string): void;
  addRecent(entry: RecentFile): void;
  clearRecents(): void;
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

function applyScale(scale: number): void {
  document.documentElement.style.fontSize = `${scale}%`;
}

const initialTheme = loadJson<Theme>("theme", "light");
const initialScale = loadJson<number>("uiScale", 100);
const initialWorkspace = loadJson<string>("workspace", "Editor");
const initialCustom = loadJson<CustomWorkspace[]>("customWorkspaces", []);

function layoutFor(
  name: string,
  custom: CustomWorkspace[],
): MosaicNode<PaneId> | null {
  return (
    custom.find((w) => w.name === name)?.layout ??
    BUILTIN_WORKSPACES[name] ??
    BUILTIN_WORKSPACES["Editor"]
  );
}

export const useUi = create<UiState>((set, get) => ({
  theme: initialTheme,
  uiScale: initialScale,
  workspaceName: initialWorkspace,
  layout: layoutFor(initialWorkspace, initialCustom),
  customWorkspaces: initialCustom,
  notes: loadJson<string>("notes", ""),
  recents: loadJson<RecentFile[]>("recents", []),

  setTheme(theme) {
    applyTheme(theme);
    saveJson("theme", theme);
    set({ theme });
  },

  setUiScale(uiScale) {
    const clamped = Math.min(125, Math.max(70, uiScale));
    applyScale(clamped);
    saveJson("uiScale", clamped);
    set({ uiScale: clamped });
  },

  setLayout(layout) {
    set({ layout });
  },

  switchWorkspace(name) {
    saveJson("workspace", name);
    set({
      workspaceName: name,
      layout: layoutFor(name, get().customWorkspaces),
    });
  },

  saveCurrentAsWorkspace(name) {
    const layout = get().layout;
    if (!layout) return;
    const customWorkspaces = [
      ...get().customWorkspaces.filter((w) => w.name !== name),
      { name, layout },
    ];
    saveJson("customWorkspaces", customWorkspaces);
    set({ customWorkspaces, workspaceName: name });
  },

  deleteWorkspace(name) {
    const customWorkspaces = get().customWorkspaces.filter(
      (w) => w.name !== name,
    );
    saveJson("customWorkspaces", customWorkspaces);
    const workspaceName =
      get().workspaceName === name ? "Editor" : get().workspaceName;
    set({
      customWorkspaces,
      workspaceName,
      layout: layoutFor(workspaceName, customWorkspaces),
    });
  },

  setNotes(notes) {
    saveJson("notes", notes);
    set({ notes });
  },

  addRecent(entry) {
    const recents = [
      entry,
      ...get().recents.filter((r) => r.fileName !== entry.fileName),
    ].slice(0, 16);
    saveJson("recents", recents);
    set({ recents });
  },

  clearRecents() {
    saveJson("recents", []);
    set({ recents: [] });
  },
}));

// Beim App-Start anwenden
applyTheme(initialTheme);
applyScale(initialScale);
