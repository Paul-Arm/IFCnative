import type { MosaicNode } from "react-mosaic-component";

import { normalizePortalMapping } from "@/portal/mapping";
import {
    createDefaultPortalSettings,
    type PortalSettings,
    type PortalTokens,
} from "@/portal/types";

import {
    createDefaultVcsSettings,
    type VcsAuth,
    type VcsSettings,
} from "@/vcs/types";

import {
    BUILT_IN_WORKSPACES,
    DEFAULT_WORKSPACE_ID,
    MOSAIC_VIEW_IDS,
    type WorkspaceDefinition,
} from "./constants";
import type { MosaicViewId } from "./types";

export { createDefaultPortalSettings } from "@/portal/types";
export { createDefaultVcsSettings } from "@/vcs/types";

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
const PORTAL_SETTINGS_STORAGE_KEY = "ifcnative:portal-settings:v1";
const PORTAL_TOKENS_STORAGE_KEY = "ifcnative:portal-auth:v1";
const RECENT_IFC_STORAGE_KEY = "ifcnative:recent-ifc:v1";
const MAX_RECENT_IFC_FILES = 16;

export function loadActiveWorkspaceId() {
  return readLocalStorage(ACTIVE_WORKSPACE_STORAGE_KEY) ?? DEFAULT_WORKSPACE_ID;
}

export function saveActiveWorkspaceId(id: string) {
  writeLocalStorage(ACTIVE_WORKSPACE_STORAGE_KEY, id);
}

/**
 * Resets the persisted UI layout to the default workspace. Used by the error
 * boundary to recover from a corrupted or crash-inducing layout state.
 */
export function resetWorkspaceUi() {
  writeLocalStorage(ACTIVE_WORKSPACE_STORAGE_KEY, DEFAULT_WORKSPACE_ID);
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
    // In einem Parent-Knoten sind first/second nie null; das ?? beruhigt nur
    // den Typchecker (cloneMosaicNode ist für null-Eingaben null-durchlässig).
    first: cloneMosaicNode(node.first) ?? node.first,
    second: cloneMosaicNode(node.second) ?? node.second,
    splitPercentage: node.splitPercentage,
  };
}

export function loadNotes() {
  return readLocalStorage(NOTES_STORAGE_KEY) ?? "";
}

export function saveNotes(notes: string) {
  writeLocalStorage(NOTES_STORAGE_KEY, notes);
}

export function loadPortalSettings(): PortalSettings {
  const defaults = createDefaultPortalSettings();
  const parsed = readJson<unknown>(PORTAL_SETTINGS_STORAGE_KEY, null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return defaults;
  }
  const candidate = parsed as Record<string, unknown>;
  const psetOptions =
    candidate.psetOptions && typeof candidate.psetOptions === "object"
      ? (candidate.psetOptions as Record<string, unknown>)
      : {};
  return {
    assetBaseUrl: readStringOr(candidate.assetBaseUrl, defaults.assetBaseUrl),
    bauwerkId: readNullableId(candidate.bauwerkId),
    bauwerkName: readStringOr(candidate.bauwerkName, defaults.bauwerkName),
    bauwerkNummer: readStringOr(candidate.bauwerkNummer, defaults.bauwerkNummer),
    bwdBaseUrl: readStringOr(candidate.bwdBaseUrl, defaults.bwdBaseUrl),
    clientId: readStringOr(candidate.clientId, defaults.clientId),
    mapping: normalizePortalMapping(candidate.mapping ?? defaults.mapping),
    monitoringBaseUrl: readStringOr(
      candidate.monitoringBaseUrl,
      defaults.monitoringBaseUrl,
    ),
    projektId: readNullableId(candidate.projektId),
    projektName: readStringOr(candidate.projektName, defaults.projektName),
    psetOptions: {
      writeCatalogPsets: readBooleanOr(
        psetOptions.writeCatalogPsets,
        defaults.psetOptions.writeCatalogPsets,
      ),
      writeLinkPset: readBooleanOr(
        psetOptions.writeLinkPset,
        defaults.psetOptions.writeLinkPset,
      ),
      writeRecordPsets: readBooleanOr(
        psetOptions.writeRecordPsets,
        defaults.psetOptions.writeRecordPsets,
      ),
    },
    tokenUrl: readStringOr(candidate.tokenUrl, defaults.tokenUrl),
    useMockData: readBooleanOr(candidate.useMockData, defaults.useMockData),
  };
}

export function savePortalSettings(settings: PortalSettings) {
  writeJson(PORTAL_SETTINGS_STORAGE_KEY, settings);
}

export function loadPortalTokens(): PortalTokens | null {
  const parsed = readJson<unknown>(PORTAL_TOKENS_STORAGE_KEY, null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const candidate = parsed as Partial<PortalTokens>;
  if (
    typeof candidate.accessToken !== "string" ||
    !candidate.accessToken ||
    typeof candidate.refreshToken !== "string" ||
    !candidate.refreshToken
  ) {
    return null;
  }
  return {
    accessToken: candidate.accessToken,
    obtainedAt:
      typeof candidate.obtainedAt === "number" &&
      Number.isFinite(candidate.obtainedAt)
        ? candidate.obtainedAt
        : 0,
    refreshToken: candidate.refreshToken,
  };
}

export function savePortalTokens(tokens: PortalTokens | null) {
  if (!tokens) {
    removeLocalStorage(PORTAL_TOKENS_STORAGE_KEY);
    return;
  }
  writeJson(PORTAL_TOKENS_STORAGE_KEY, tokens);
}

const VCS_SETTINGS_STORAGE_KEY = "ifcnative:vcs-settings:v1";
const VCS_AUTH_STORAGE_KEY = "ifcnative:vcs-auth:v1";
const VCS_CREDENTIALS_STORAGE_KEY = "ifcnative:vcs-credentials:v1";

/**
 * Gemerkte Anmeldedaten für den IFC Hub, damit nach Ablauf des Tokens nicht
 * alles neu getippt werden muss. E-Mail und Name sind unkritisch und werden
 * immer behalten; das Passwort NUR bei aktivem `remember` — es liegt dann im
 * Klartext im LocalStorage. Die Anmeldemaske weist darauf hin und bietet das
 * Löschen an.
 */
export interface VcsCredentials {
  email: string;
  name: string;
  password: string;
  remember: boolean;
}

export function createEmptyVcsCredentials(): VcsCredentials {
  return { email: "", name: "", password: "", remember: true };
}

export function loadVcsCredentials(): VcsCredentials {
  const defaults = createEmptyVcsCredentials();
  const parsed = readJson<unknown>(VCS_CREDENTIALS_STORAGE_KEY, null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return defaults;
  }
  const candidate = parsed as Record<string, unknown>;
  const remember = readBooleanOr(candidate.remember, defaults.remember);
  return {
    email: readStringOr(candidate.email, defaults.email),
    name: readStringOr(candidate.name, defaults.name),
    // Ohne "remember" gilt ein doch gespeichertes Passwort als ungültig.
    password: remember ? readStringOr(candidate.password, "") : "",
    remember,
  };
}

export function saveVcsCredentials(credentials: VcsCredentials) {
  writeJson(VCS_CREDENTIALS_STORAGE_KEY, {
    email: credentials.email,
    name: credentials.name,
    password: credentials.remember ? credentials.password : "",
    remember: credentials.remember,
  });
}

export function clearVcsCredentials() {
  removeLocalStorage(VCS_CREDENTIALS_STORAGE_KEY);
}

export function loadVcsSettings(): VcsSettings {
  const defaults = createDefaultVcsSettings();
  const parsed = readJson<unknown>(VCS_SETTINGS_STORAGE_KEY, null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return defaults;
  }
  const candidate = parsed as Record<string, unknown>;
  return {
    baseUrl: readStringOr(candidate.baseUrl, defaults.baseUrl),
  };
}

export function saveVcsSettings(settings: VcsSettings) {
  writeJson(VCS_SETTINGS_STORAGE_KEY, settings);
}

export function loadVcsAuth(): VcsAuth | null {
  const parsed = readJson<unknown>(VCS_AUTH_STORAGE_KEY, null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const candidate = parsed as Partial<VcsAuth>;
  const user = candidate.user;
  if (
    typeof candidate.token !== "string" ||
    !candidate.token ||
    !user ||
    typeof user !== "object" ||
    typeof user.id !== "string" ||
    typeof user.email !== "string"
  ) {
    return null;
  }
  return {
    token: candidate.token,
    user: {
      id: user.id,
      email: user.email,
      name: typeof user.name === "string" ? user.name : user.email,
    },
  };
}

export function saveVcsAuth(auth: VcsAuth | null) {
  if (!auth) {
    removeLocalStorage(VCS_AUTH_STORAGE_KEY);
    return;
  }
  writeJson(VCS_AUTH_STORAGE_KEY, auth);
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
  if (candidate.direction !== "row" && candidate.direction !== "column") {
    return undefined;
  }
  const first = sanitizeMosaicNode(candidate.first);
  const second = sanitizeMosaicNode(candidate.second);
  // Entfällt ein Panel (z. B. die früheren "Portal-Einstellungen"), rückt der
  // Geschwisterknoten nach — sonst würde ein einzelnes unbekanntes Blatt das
  // ganze gespeicherte Layout verwerfen.
  if (first == null) {
    return second ?? undefined;
  }
  if (second == null) {
    return first;
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

function readStringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function readBooleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readNullableId(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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

function removeLocalStorage(key: string) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Local persistence is a convenience feature; the workspace can continue.
  }
}
