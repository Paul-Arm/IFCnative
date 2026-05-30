import { app, BrowserWindow, Menu, net, protocol, shell } from "electron";
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

  mainWindow.setMenuBarVisibility(false);

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
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
