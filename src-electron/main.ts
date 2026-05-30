import { app, BrowserWindow, ipcMain, Menu, net, protocol, shell } from "electron";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

const appId = "com.ifcnative.desktop";
const appScheme = "ifcnative";
const appHost = "app";
const devServerUrl = process.env.ELECTRON_DEV_SERVER_URL;
const detachedViewOpenChannel = "ifcnative:detached-view-open";
const detachedViewPayloadChannel = "ifcnative:detached-view-payload";
const workspaceSyncBroadcastChannel = "ifcnative:workspace-sync-broadcast";
const workspaceSyncPublishChannel = "ifcnative:workspace-sync-publish";
const workspaceSyncSnapshotChannel = "ifcnative:workspace-sync-snapshot";
const detachedViewIds = new Set([
  "structure",
  "viewer",
  "inspector",
  "builder",
  "catalog",
  "catalog-review",
  "object-info",
  "console",
  "diagnostics",
  "recent",
  "notes",
]);
const detachedViewPayloads = new Map<string, DetachedViewRequest>();
let latestWorkspaceSnapshot: WorkspaceSyncSnapshot | null = null;

interface DetachedViewRequest {
  activeDocumentId?: string;
  documentText?: string;
  fileName?: string;
  notes?: string;
  recentIfcFiles?: unknown[];
  selectedId?: number;
  snapshot?: WorkspaceSyncSnapshot;
  title?: string;
  viewId: string;
  workspaceName?: string;
}

interface WorkspaceSyncSnapshot {
  activeDocumentId: string;
  documentText: string;
  fileName: string;
  notes: string;
  recentIfcFiles: unknown[];
  selectedId: number;
  ui: WorkspaceSyncUiState;
  version: number;
}

interface WorkspaceSyncUiState {
  graphDepth: number;
  graphPreset: string;
  graphRelationshipTypes: string[];
  inspectorMode: string;
  search: string;
  structureMode: "tree" | "graph";
}

interface WorkspaceSyncMessage {
  clientId: string;
  snapshot: WorkspaceSyncSnapshot;
  type: "snapshot";
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: appScheme,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

void app
  .whenReady()
  .then(async () => {
    app.setAppUserModelId(appId);
    Menu.setApplicationMenu(null);

    if (!devServerUrl) {
      registerRendererProtocol();
    }
    registerDetachedWindowHandlers();

    await createMainWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createMainWindow();
      }
    });
  })
  .catch((error) => {
    console.error("Failed to start IFCnative desktop app.", error);
    app.quit();
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

function registerRendererProtocol() {
  protocol.handle(appScheme, (request) => {
    const requestUrl = new URL(request.url);
    if (requestUrl.host !== appHost) {
      return new Response("Not found", { status: 404 });
    }

    const requestedPath = decodeURIComponent(requestUrl.pathname);
    const relativePath =
      requestedPath === "/" ? "index.html" : requestedPath.replace(/^\/+/, "");
    const rendererRoot = getRendererDistPath();
    const filePath = path.join(rendererRoot, relativePath);
    const relativeToRoot = path.relative(rendererRoot, filePath);

    if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
      return new Response("Not found", { status: 404 });
    }

    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function registerDetachedWindowHandlers() {
  ipcMain.handle(detachedViewOpenChannel, async (event, payload: unknown) => {
    const request = normalizeDetachedViewRequest(payload);
    if (!request) {
      return { ok: false, reason: "invalid-request" };
    }

    const token = randomUUID();
    if (request.snapshot) {
      latestWorkspaceSnapshot = request.snapshot;
    }
    detachedViewPayloads.set(token, request);
    const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    await createDetachedWindow(request, token, parent);
    return { ok: true };
  });

  ipcMain.handle(
    detachedViewPayloadChannel,
    (_event, token: unknown): DetachedViewRequest | null => {
      if (typeof token !== "string") {
        return null;
      }
      return detachedViewPayloads.get(token) ?? null;
    },
  );

  ipcMain.handle(workspaceSyncSnapshotChannel, () => latestWorkspaceSnapshot);

  ipcMain.on(workspaceSyncPublishChannel, (event, payload: unknown) => {
    const message = normalizeWorkspaceSyncMessage(payload);
    if (!message) {
      return;
    }
    latestWorkspaceSnapshot = message.snapshot;
    for (const window of BrowserWindow.getAllWindows()) {
      if (
        window.isDestroyed() ||
        window.webContents.isDestroyed() ||
        window.webContents === event.sender
      ) {
        continue;
      }
      window.webContents.send(workspaceSyncBroadcastChannel, message);
    }
  });
}

async function createMainWindow() {
  const mainWindow = new BrowserWindow({
    title: "IFCnative",
    width: 1440,
    height: 940,
    minWidth: 1024,
    minHeight: 720,
    backgroundColor: "#f8fafc",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  configureAppWindow(mainWindow);

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  if (devServerUrl) {
    await mainWindow.loadURL(createRendererUrl());
    mainWindow.webContents.openDevTools({ mode: "detach" });
    return;
  }

  await mainWindow.loadURL(createRendererUrl());
}

async function createDetachedWindow(
  request: DetachedViewRequest,
  token: string,
  parent?: BrowserWindow,
) {
  const detachedWindow = new BrowserWindow({
    title: `IFCnative - ${request.title || request.viewId}`,
    width: 1100,
    height: 780,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: "#f8fafc",
    autoHideMenuBar: true,
    parent,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  configureAppWindow(detachedWindow);

  detachedWindow.once("ready-to-show", () => {
    detachedWindow.show();
  });
  detachedWindow.once("closed", () => {
    detachedViewPayloads.delete(token);
  });

  await detachedWindow.loadURL(
    createRendererUrl({
      detachedToken: token,
      detachedView: request.viewId,
    }),
  );
}

function configureAppWindow(window: BrowserWindow) {
  window.setMenuBarVisibility(false);

  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (isAppNavigation(url)) {
      return;
    }
    event.preventDefault();
    openExternalUrl(url);
  });
}

function getRendererDistPath() {
  return path.resolve(__dirname, "..", "dist");
}

function createRendererUrl(params?: Record<string, string>) {
  const url = new URL(devServerUrl || `${appScheme}://${appHost}/index.html`);
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function normalizeDetachedViewRequest(
  payload: unknown,
): DetachedViewRequest | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const candidate = payload as Partial<DetachedViewRequest>;
  if (
    typeof candidate.viewId !== "string" ||
    !detachedViewIds.has(candidate.viewId)
  ) {
    return null;
  }
  return {
    activeDocumentId:
      typeof candidate.activeDocumentId === "string"
        ? candidate.activeDocumentId
        : undefined,
    documentText:
      typeof candidate.documentText === "string"
        ? candidate.documentText
        : undefined,
    fileName:
      typeof candidate.fileName === "string" ? candidate.fileName : undefined,
    selectedId:
      typeof candidate.selectedId === "number" ? candidate.selectedId : undefined,
    notes: typeof candidate.notes === "string" ? candidate.notes : undefined,
    recentIfcFiles: Array.isArray(candidate.recentIfcFiles)
      ? candidate.recentIfcFiles
      : undefined,
    snapshot: normalizeWorkspaceSyncSnapshot(candidate.snapshot) ?? undefined,
    title: typeof candidate.title === "string" ? candidate.title : undefined,
    viewId: candidate.viewId,
    workspaceName:
      typeof candidate.workspaceName === "string"
        ? candidate.workspaceName
        : undefined,
  };
}

function normalizeWorkspaceSyncMessage(
  payload: unknown,
): WorkspaceSyncMessage | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const candidate = payload as Partial<WorkspaceSyncMessage>;
  if (candidate.type !== "snapshot" || typeof candidate.clientId !== "string") {
    return null;
  }
  const snapshot = normalizeWorkspaceSyncSnapshot(candidate.snapshot);
  if (!snapshot) {
    return null;
  }
  return {
    clientId: candidate.clientId,
    snapshot,
    type: "snapshot",
  };
}

function normalizeWorkspaceSyncSnapshot(
  payload: unknown,
): WorkspaceSyncSnapshot | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const candidate = payload as Partial<WorkspaceSyncSnapshot>;
  if (
    typeof candidate.activeDocumentId !== "string" ||
    typeof candidate.documentText !== "string" ||
    typeof candidate.fileName !== "string" ||
    typeof candidate.selectedId !== "number"
  ) {
    return null;
  }
  return {
    activeDocumentId: candidate.activeDocumentId,
    documentText: candidate.documentText,
    fileName: candidate.fileName,
    notes: typeof candidate.notes === "string" ? candidate.notes : "",
    recentIfcFiles: Array.isArray(candidate.recentIfcFiles)
      ? candidate.recentIfcFiles
      : [],
    selectedId: candidate.selectedId,
    ui: normalizeWorkspaceSyncUiState(candidate.ui),
    version:
      typeof candidate.version === "number" ? candidate.version : Date.now(),
  };
}

function normalizeWorkspaceSyncUiState(
  payload: unknown,
): WorkspaceSyncUiState {
  if (!payload || typeof payload !== "object") {
    return createDefaultWorkspaceSyncUiState();
  }
  const candidate = payload as Partial<WorkspaceSyncUiState>;
  return {
    graphDepth:
      typeof candidate.graphDepth === "number" &&
      Number.isFinite(candidate.graphDepth)
        ? Math.min(4, Math.max(1, Math.round(candidate.graphDepth)))
        : 1,
    graphPreset:
      typeof candidate.graphPreset === "string" ? candidate.graphPreset : "all",
    graphRelationshipTypes: Array.isArray(candidate.graphRelationshipTypes)
      ? candidate.graphRelationshipTypes.filter(
          (type): type is string => typeof type === "string",
        )
      : [],
    inspectorMode:
      typeof candidate.inspectorMode === "string"
        ? candidate.inspectorMode
        : "info",
    search: typeof candidate.search === "string" ? candidate.search : "",
    structureMode: candidate.structureMode === "graph" ? "graph" : "tree",
  };
}

function createDefaultWorkspaceSyncUiState(): WorkspaceSyncUiState {
  return {
    graphDepth: 1,
    graphPreset: "all",
    graphRelationshipTypes: [],
    inspectorMode: "info",
    search: "",
    structureMode: "tree",
  };
}

function isAppNavigation(url: string) {
  if (!devServerUrl) {
    return url.startsWith(`${appScheme}://${appHost}/`);
  }

  try {
    return new URL(url).origin === new URL(devServerUrl).origin;
  } catch {
    return false;
  }
}

function openExternalUrl(url: string) {
  if (/^(https?|mailto):/i.test(url)) {
    void shell.openExternal(url);
  }
}
