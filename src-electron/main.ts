import {
    app,
    BrowserWindow,
    ipcMain,
    Menu,
    net,
    protocol,
    shell,
    type MenuItemConstructorOptions,
} from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";

const appId = "com.ifcnative.desktop";
const appScheme = "ifcnative";
const appHost = "app";
const devServerUrl = process.env.ELECTRON_DEV_SERVER_URL;
const desktopCommandChannel = "ifcnative:desktop-command";
const desktopMenuStateChannel = "ifcnative:menu-state";

type DesktopMenuState = {
  catalogImporting: boolean;
  closedWindowIds: string[];
  hasCatalog: boolean;
  hasPendingDraft: boolean;
  loadingIfcName: string;
};

type DesktopCommand =
  | { type: "apply-draft" }
  | { type: "discard-draft" }
  | { type: "export-ifc" }
  | { type: "import-catalog" }
  | { type: "load-sample" }
  | { type: "open-ifc" }
  | { type: "reset-layout" }
  | { type: "restore-window"; viewId: string };

const defaultMenuState: DesktopMenuState = {
  catalogImporting: false,
  closedWindowIds: [],
  hasCatalog: false,
  hasPendingDraft: false,
  loadingIfcName: "",
};

const mosaicWindowTitles: Record<string, string> = {
  builder: "Baukasten",
  catalog: "Objektkatalog",
  console: "JS Console",
  diagnostics: "Diagnostics",
  diff: "IFC Diff / Review",
  inspector: "Inspector",
  structure: "Structure",
  viewer: "3D Viewer",
};

let activeMainWindow: BrowserWindow | undefined;
let desktopMenuState = defaultMenuState;

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
    registerDesktopMenuStateHandler();

    if (!devServerUrl) {
      registerRendererProtocol();
    }

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

async function createMainWindow() {
  const mainWindow = new BrowserWindow({
    title: "IFCnative",
    width: 1440,
    height: 940,
    minWidth: 1024,
    minHeight: 720,
    backgroundColor: "#f8fafc",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  activeMainWindow = mainWindow;
  installApplicationMenu(mainWindow, desktopMenuState);

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.on("focus", () => {
    activeMainWindow = mainWindow;
    installApplicationMenu(mainWindow, desktopMenuState);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isAppNavigation(url)) {
      return;
    }
    event.preventDefault();
    openExternalUrl(url);
  });

  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: "detach" });
    return;
  }

  await mainWindow.loadURL(`${appScheme}://${appHost}/index.html`);
}

function registerDesktopMenuStateHandler() {
  ipcMain.on(desktopMenuStateChannel, (event, nextState: DesktopMenuState) => {
    if (event.sender !== activeMainWindow?.webContents) {
      return;
    }

    desktopMenuState = normalizeDesktopMenuState(nextState);
    installApplicationMenu(activeMainWindow, desktopMenuState);
  });
}

function normalizeDesktopMenuState(state: DesktopMenuState): DesktopMenuState {
  return {
    catalogImporting: Boolean(state?.catalogImporting),
    closedWindowIds: Array.isArray(state?.closedWindowIds)
      ? state.closedWindowIds.filter((id) => typeof id === "string")
      : [],
    hasCatalog: Boolean(state?.hasCatalog),
    hasPendingDraft: Boolean(state?.hasPendingDraft),
    loadingIfcName:
      typeof state?.loadingIfcName === "string" ? state.loadingIfcName : "",
  };
}

function installApplicationMenu(
  mainWindow: BrowserWindow,
  state: DesktopMenuState,
) {
  const openEnabled = !state.loadingIfcName;
  const exportEnabled = !state.hasPendingDraft && !state.loadingIfcName;
  const catalogLabel = state.hasCatalog ? "Reload Catalog" : "Import Catalog";
  const closedWindowItems = state.closedWindowIds.length
    ? state.closedWindowIds.map<MenuItemConstructorOptions>((viewId) => ({
        label: mosaicWindowTitles[viewId] ?? viewId,
        click: () =>
          sendDesktopCommand(mainWindow, {
            type: "restore-window",
            viewId,
          }),
      }))
    : [
        {
          enabled: false,
          label: "All windows are open",
        },
      ];

  const template: MenuItemConstructorOptions[] = [
    {
      label: "File",
      submenu: [
        {
          accelerator: "CmdOrCtrl+O",
          enabled: openEnabled,
          label: state.loadingIfcName ? "Loading IFC..." : "Open IFC",
          click: () => sendDesktopCommand(mainWindow, { type: "open-ifc" }),
        },
        {
          label: "Sample",
          click: () => sendDesktopCommand(mainWindow, { type: "load-sample" }),
        },
        {
          enabled: !state.catalogImporting,
          label: state.catalogImporting ? "Loading Catalog..." : catalogLabel,
          click: () =>
            sendDesktopCommand(mainWindow, {
              type: "import-catalog",
            }),
        },
        { type: "separator" },
        {
          accelerator: "CmdOrCtrl+S",
          enabled: exportEnabled,
          label: "Export IFC",
          click: () => sendDesktopCommand(mainWindow, { type: "export-ifc" }),
        },
        { type: "separator" },
        process.platform === "darwin" ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "Draft",
      submenu: [
        {
          enabled: state.hasPendingDraft,
          label: "Apply Draft",
          click: () => sendDesktopCommand(mainWindow, { type: "apply-draft" }),
        },
        {
          enabled: state.hasPendingDraft,
          label: "Discard Draft",
          click: () =>
            sendDesktopCommand(mainWindow, {
              type: "discard-draft",
            }),
        },
      ],
    },
    {
      label: "Layout",
      submenu: [
        {
          label: "Reset Layout",
          click: () => sendDesktopCommand(mainWindow, { type: "reset-layout" }),
        },
      ],
    },
    {
      label: "Windows",
      submenu: closedWindowItems,
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function sendDesktopCommand(
  mainWindow: BrowserWindow,
  command: DesktopCommand,
) {
  if (!mainWindow.isDestroyed()) {
    mainWindow.webContents.send(desktopCommandChannel, command);
  }
}

function getRendererDistPath() {
  return path.resolve(__dirname, "..", "dist");
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
