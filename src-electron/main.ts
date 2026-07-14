import {
  app,
  BrowserWindow,
  Menu,
  nativeTheme,
  net,
  protocol,
  shell,
} from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";

const appId = "com.ifcnative.desktop";
const appScheme = "ifcnative";
const appHost = "app";
const devServerUrl = process.env.ELECTRON_DEV_SERVER_URL;

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

// Muss zu --background in src/global.css passen, damit beim Fensteraufbau
// kein Farbblitz entsteht: hell oklch(0.975 0.003 197.1) ≈ #f7f8f8,
// dunkel oklch(0.155 0.006 197.1) ≈ #090d0d. Best-Effort: der Main-Prozess
// kennt nur das OS-Theme; weicht die App-Einstellung (localStorage) davon ab,
// bleibt ein kurzer Flash.
function windowBackgroundColor() {
  return nativeTheme.shouldUseDarkColors ? "#090d0d" : "#f7f8f8";
}

async function createMainWindow() {
  const mainWindow = new BrowserWindow({
    title: "IFCnative",
    width: 1440,
    height: 940,
    minWidth: 1024,
    minHeight: 720,
    backgroundColor: windowBackgroundColor(),
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

function configureAppWindow(window: BrowserWindow) {
  window.setMenuBarVisibility(false);

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url === "about:blank" || url === "about:blank#blocked") {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          backgroundColor: windowBackgroundColor(),
          minHeight: 520,
          minWidth: 760,
          webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        },
      };
    }
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
