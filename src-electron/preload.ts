import { contextBridge, ipcRenderer } from "electron";

const desktopCommandChannel = "ifcnative:desktop-command";
const desktopMenuStateChannel = "ifcnative:menu-state";

contextBridge.exposeInMainWorld(
  "ifcNativeDesktop",
  Object.freeze({
    isElectron: true,
    onCommand(callback: (command: unknown) => void) {
      const listener = (
        _event: Electron.IpcRendererEvent,
        command: unknown,
      ) => {
        callback(command);
      };
      ipcRenderer.on(desktopCommandChannel, listener);
      return () => {
        ipcRenderer.removeListener(desktopCommandChannel, listener);
      };
    },
    platform: process.platform,
    setMenuState(state: unknown) {
      ipcRenderer.send(desktopMenuStateChannel, state);
    },
    versions: Object.freeze({
      chrome: process.versions.chrome,
      electron: process.versions.electron,
      node: process.versions.node,
    }),
  }),
);
