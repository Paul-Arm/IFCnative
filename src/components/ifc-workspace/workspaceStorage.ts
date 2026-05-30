import type { MosaicNode } from "react-mosaic-component";

import {
  BUILT_IN_WORKSPACES,
  DEFAULT_WORKSPACE_ID,
  MOSAIC_VIEW_IDS,
  type WorkspaceDefinition,
} from "./constants";
import type { MosaicViewId } from "./types";

export interface RecentIfcFileEntry {
  documentId?: string;
  entityCount?: number;
  id: string;
  name: string;
  openedAt: string;
  path?: string;
  schema?: string;
  size?: number;
  source: "opened" | "added" | "sample";
}

const ACTIVE_WORKSPACE_STORAGE_KEY = "ifcnative:active-workspace:v1";
const CUSTOM_WORKSPACES_STORAGE_KEY = "ifcnative:custom-workspaces:v1";
const NOTES_STORAGE_KEY = "ifcnative:notes:v1";
const RECENT_IFC_STORAGE_KEY = "ifcnative:recent-ifc:v1";
const MAX_RECENT_IFC_FILES = 16;

export function loadActiveWorkspaceId() {
  return readLocalStorage(ACTIVE_WORKSPACE_STORAGE_KEY) ?? DEFAULT_WORKSPACE_ID;
}

export function saveActiveWorkspaceId(id: string) {
  writeLocalStorage(ACTIVE_WORKSPACE_STORAGE_KEY, id);
}

export function loadCustomWorkspaces(): WorkspaceDefinition[] {
  const parsed = readJson<unknown[]>(CUSTOM_WORKSPACES_STORAGE_KEY, []);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const candidate = item as Partial<WorkspaceDefinition>;
    const layout = sanitizeMosaicNode(candidate.layout);
    if (!candidate.id || !candidate.name || !layout) {
      return [];
    }
    return [
      {
        description: candidate.description || "Eigenes gespeichertes Layout.",
        id: String(candidate.id),
        layout,
        name: String(candidate.name),
        updatedAt:
          typeof candidate.updatedAt === "string"
            ? candidate.updatedAt
            : undefined,
      },
    ];
  });
}

export function saveCustomWorkspaces(workspaces: WorkspaceDefinition[]) {
  writeJson(
    CUSTOM_WORKSPACES_STORAGE_KEY,
    workspaces
      .filter((workspace) => !workspace.builtIn && workspace.layout)
      .map((workspace) => ({
        description: workspace.description,
        id: workspace.id,
        layout: workspace.layout,
        name: workspace.name,
        updatedAt: workspace.updatedAt,
      })),
  );
}

export function createCustomWorkspace(
  name: string,
  layout: MosaicNode<MosaicViewId> | null,
): WorkspaceDefinition {
  return {
    description: "Eigenes gespeichertes Layout.",
    id: `custom:${Date.now().toString(36)}:${Math.random()
      .toString(36)
      .slice(2, 7)}`,
    layout: cloneMosaicNode(layout),
    name: name.trim() || "Eigener Workspace",
    updatedAt: new Date().toISOString(),
  };
}

export function resolveWorkspace(
  id: string,
  customWorkspaces: WorkspaceDefinition[],
) {
  return (
    [...BUILT_IN_WORKSPACES, ...customWorkspaces].find(
      (workspace) => workspace.id === id,
    ) ?? BUILT_IN_WORKSPACES[0]
  );
}

export function cloneMosaicNode<T extends string | number>(
  node: MosaicNode<T> | null,
): MosaicNode<T> | null {
  if (node == null || typeof node !== "object") {
    return node;
  }
  return {
    direction: node.direction,
    first: cloneMosaicNode(node.first),
    second: cloneMosaicNode(node.second),
    splitPercentage: node.splitPercentage,
  };
}

export function loadNotes() {
  return readLocalStorage(NOTES_STORAGE_KEY) ?? "";
}

export function saveNotes(notes: string) {
  writeLocalStorage(NOTES_STORAGE_KEY, notes);
}

export function loadRecentIfcFiles(): RecentIfcFileEntry[] {
  const parsed = readJson<unknown[]>(RECENT_IFC_STORAGE_KEY, []);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const candidate = item as Partial<RecentIfcFileEntry>;
    if (!candidate.id || !candidate.name || !candidate.openedAt) {
      return [];
    }
    return [
      {
        documentId:
          typeof candidate.documentId === "string"
            ? candidate.documentId
            : undefined,
        entityCount:
          typeof candidate.entityCount === "number"
            ? candidate.entityCount
            : undefined,
        id: String(candidate.id),
        name: String(candidate.name),
        openedAt: String(candidate.openedAt),
        path: typeof candidate.path === "string" ? candidate.path : undefined,
        schema: typeof candidate.schema === "string" ? candidate.schema : "",
        size: typeof candidate.size === "number" ? candidate.size : undefined,
        source:
          candidate.source === "added" || candidate.source === "sample"
            ? candidate.source
            : "opened",
      },
    ];
  });
}

export function saveRecentIfcFiles(entries: RecentIfcFileEntry[]) {
  writeJson(RECENT_IFC_STORAGE_KEY, entries.slice(0, MAX_RECENT_IFC_FILES));
}

export function mergeRecentIfcFile(
  current: RecentIfcFileEntry[],
  entry: RecentIfcFileEntry,
) {
  const dedupeKey = entry.path || entry.name;
  return [
    entry,
    ...current.filter((item) => (item.path || item.name) !== dedupeKey),
  ].slice(0, MAX_RECENT_IFC_FILES);
}

function sanitizeMosaicNode(
  node: unknown,
): MosaicNode<MosaicViewId> | null | undefined {
  if (node == null) {
    return null;
  }
  if (typeof node === "string") {
    return MOSAIC_VIEW_IDS.includes(node as MosaicViewId)
      ? (node as MosaicViewId)
      : undefined;
  }
  if (!node || typeof node !== "object") {
    return undefined;
  }

  const candidate = node as Partial<{
    direction: "row" | "column";
    first: unknown;
    second: unknown;
    splitPercentage: number;
  }>;
  const first = sanitizeMosaicNode(candidate.first);
  const second = sanitizeMosaicNode(candidate.second);
  if (
    (candidate.direction !== "row" && candidate.direction !== "column") ||
    first == null ||
    second == null
  ) {
    return undefined;
  }
  return {
    direction: candidate.direction,
    first,
    second,
    splitPercentage:
      typeof candidate.splitPercentage === "number"
        ? Math.min(90, Math.max(10, candidate.splitPercentage))
        : 50,
  };
}

function readJson<T>(key: string, fallback: T): T {
  const value = readLocalStorage(key);
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  writeLocalStorage(key, JSON.stringify(value));
}

function readLocalStorage(key: string) {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string, value: string) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Local persistence is a convenience feature; the workspace can continue.
  }
}
