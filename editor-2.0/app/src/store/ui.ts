/**
 * UI-Slice: Theme, UI-Skalierung, Workspaces (Mosaic-Layouts der
 * Hauptfenster + Sidebar-Werkzeug), Notizen, zuletzt verwendete Dateien.
 * Persistiert über core/storage.
 *
 * Sidebar-Umbau: Layout-Bäume enthalten nur noch HAUPTFENSTER (MainPaneId).
 * Werkzeuge (builder/catalog/lens/checks/ids/hub/notes/recents) leben in der
 * rechten Sidebar — genau eines offen, Zustand in `sidebarTool`.
 */
import { create } from "zustand";
import type { MosaicNode } from "react-mosaic-component";
import { loadJson, saveJson } from "../core/storage";
import {
  MAIN_PANE_IDS,
  TOOL_PANE_IDS,
  type MainPaneId,
  type PaneId,
  type ToolPaneId,
} from "../panes/ids";
import { BUILTIN_WORKSPACES } from "../panes/workspaces";

const MAIN_PANES = new Set<string>(MAIN_PANE_IDS);
const TOOL_PANES = new Set<string>(TOOL_PANE_IDS);

/**
 * Befund 10: Gespeicherte Layouts stammen aus dem localStorage und können
 * Pane-Ids enthalten, die es in dieser Version nicht mehr gibt (umbenannt,
 * entfernt — oder seit dem Sidebar-Umbau keine Mosaic-Fenster mehr sind).
 * Ein solcher Baum ließe das Mosaic-Rendering auflaufen, deshalb wird jedes
 * Blatt rekursiv geprüft — Split-Knoten über `children`, Tabs über `tabs`.
 */
function isValidLayout(node: unknown): node is MosaicNode<MainPaneId> {
  if (typeof node === "string") return MAIN_PANES.has(node);
  if (!node || typeof node !== "object") return false;
  const candidate = node as {
    type?: unknown;
    children?: unknown;
    tabs?: unknown;
  };
  if (candidate.type === "split") {
    return (
      Array.isArray(candidate.children) &&
      candidate.children.length > 0 &&
      candidate.children.every(isValidLayout)
    );
  }
  if (candidate.type === "tabs") {
    return (
      Array.isArray(candidate.tabs) &&
      candidate.tabs.length > 0 &&
      candidate.tabs.every(
        (tab: unknown) => typeof tab === "string" && MAIN_PANES.has(tab),
      )
    );
  }
  return false;
}

/**
 * Migration alter Layouts: Werkzeug-Panes (vor dem Sidebar-Umbau normale
 * Mosaic-Fenster) aus dem Baum streichen statt den ganzen Workspace zu
 * verwerfen. Leere Splits kollabieren; bleibt nichts übrig → null.
 */
function stripToolPanes(node: MosaicNode<PaneId>): MosaicNode<MainPaneId> | null {
  if (typeof node === "string") {
    return MAIN_PANES.has(node) ? (node as MainPaneId) : null;
  }
  if (node.type === "tabs") {
    const tabs = node.tabs.filter((tab) => MAIN_PANES.has(tab)) as MainPaneId[];
    if (tabs.length === 0) return null;
    if (tabs.length === 1) return tabs[0];
    return {
      ...node,
      tabs,
      activeTabIndex: Math.min(node.activeTabIndex, tabs.length - 1),
    };
  }
  const children = node.children
    .map(stripToolPanes)
    .filter((child): child is MosaicNode<MainPaneId> => child !== null);
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  return {
    type: "split",
    direction: node.direction,
    children,
    ...(children.length === node.children.length
      ? { splitPercentages: node.splitPercentages }
      : {}),
  };
}

/** Erstes Werkzeug-Pane eines Alt-Layouts — wird zum Sidebar-Werkzeug. */
function firstToolPane(node: MosaicNode<PaneId>): ToolPaneId | null {
  if (typeof node === "string") {
    return TOOL_PANES.has(node) ? (node as ToolPaneId) : null;
  }
  if (node.type === "tabs") {
    return (node.tabs.find((tab) => TOOL_PANES.has(tab)) as ToolPaneId) ?? null;
  }
  for (const child of node.children) {
    const tool = firstToolPane(child);
    if (tool !== null) return tool;
  }
  return null;
}

export type Theme = "light" | "dark";

export interface RecentFile {
  fileName: string;
  entityCount: number;
  schema: string;
  openedAt: string;
}

export interface CustomWorkspace {
  name: string;
  layout: MosaicNode<MainPaneId>;
  /** Sidebar-Werkzeug des Workspace (null = Sidebar zu). */
  tool?: ToolPaneId | null;
}

/**
 * Gespeicherte Workspaces übernehmen: Alt-Layouts mit Werkzeug-Panes werden
 * migriert (Werkzeuge raus aus dem Baum, erstes wird Sidebar-Werkzeug);
 * unbrauchbare Einträge fallen weg.
 */
function migrateWorkspaces(entries: CustomWorkspace[]): CustomWorkspace[] {
  const result: CustomWorkspace[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry.name !== "string" || entry.name.length === 0) {
      continue;
    }
    if (isValidLayout(entry.layout)) {
      result.push(entry);
      continue;
    }
    const layout = stripToolPanes(entry.layout as MosaicNode<PaneId>);
    if (layout === null || !isValidLayout(layout)) continue;
    const tool = entry.tool ?? firstToolPane(entry.layout as MosaicNode<PaneId>);
    result.push({ name: entry.name, layout, tool });
  }
  return result;
}

interface UiState {
  theme: Theme;
  uiScale: number;
  workspaceName: string;
  layout: MosaicNode<MainPaneId> | null;
  customWorkspaces: CustomWorkspace[];
  /** Offenes Sidebar-Werkzeug (null = Sidebar eingeklappt). */
  sidebarTool: ToolPaneId | null;
  /** Breite des Sidebar-Panels in px (Icon-Leiste kommt hinzu). */
  sidebarWidth: number;
  notes: string;
  recents: RecentFile[];

  setTheme(theme: Theme): void;
  setUiScale(scale: number): void;
  setLayout(layout: MosaicNode<MainPaneId> | null): void;
  setSidebarTool(tool: ToolPaneId | null): void;
  toggleSidebarTool(tool: ToolPaneId): void;
  setSidebarWidth(width: number): void;
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

const SIDEBAR_MIN = 240;
const SIDEBAR_MAX = 640;

const initialTheme = loadJson<Theme>("theme", "light");
const initialScale = loadJson<number>("uiScale", 100);
const initialWorkspace = loadJson<string>("workspace", "Editor");
const initialCustom = migrateWorkspaces(
  loadJson<CustomWorkspace[]>("customWorkspaces", []) ?? [],
);

interface ResolvedWorkspace {
  layout: MosaicNode<MainPaneId> | null;
  tool: ToolPaneId | null;
}

function workspaceFor(
  name: string,
  custom: CustomWorkspace[],
): ResolvedWorkspace {
  const own = custom.find((w) => w.name === name);
  if (own) return { layout: own.layout, tool: own.tool ?? null };
  const builtin = BUILTIN_WORKSPACES[name] ?? BUILTIN_WORKSPACES["Editor"];
  return { layout: builtin.layout, tool: builtin.tool ?? null };
}

const initialResolved = workspaceFor(initialWorkspace, initialCustom);

/** Gespeichertes Sidebar-Werkzeug — gegen die bekannten Ids validiert. */
function initialSidebarTool(): ToolPaneId | null {
  const stored = loadJson<ToolPaneId | null>("sidebarTool", initialResolved.tool);
  return stored !== null && TOOL_PANES.has(stored) ? stored : null;
}

export const useUi = create<UiState>((set, get) => ({
  theme: initialTheme,
  uiScale: initialScale,
  workspaceName: initialWorkspace,
  layout: initialResolved.layout,
  customWorkspaces: initialCustom,
  sidebarTool: initialSidebarTool(),
  sidebarWidth: loadJson<number>("sidebarWidth", 320),
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

  setSidebarTool(sidebarTool) {
    saveJson("sidebarTool", sidebarTool);
    set({ sidebarTool });
  },

  toggleSidebarTool(tool) {
    const next = get().sidebarTool === tool ? null : tool;
    saveJson("sidebarTool", next);
    set({ sidebarTool: next });
  },

  setSidebarWidth(width) {
    const clamped = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(width)));
    saveJson("sidebarWidth", clamped);
    set({ sidebarWidth: clamped });
  },

  switchWorkspace(name) {
    saveJson("workspace", name);
    const resolved = workspaceFor(name, get().customWorkspaces);
    saveJson("sidebarTool", resolved.tool);
    set({
      workspaceName: name,
      layout: resolved.layout,
      sidebarTool: resolved.tool,
    });
  },

  saveCurrentAsWorkspace(name) {
    const layout = get().layout;
    if (!layout) return;
    const customWorkspaces = [
      ...get().customWorkspaces.filter((w) => w.name !== name),
      { name, layout, tool: get().sidebarTool },
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
    const resolved = workspaceFor(workspaceName, customWorkspaces);
    set({
      customWorkspaces,
      workspaceName,
      layout: resolved.layout,
      sidebarTool: resolved.tool,
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
