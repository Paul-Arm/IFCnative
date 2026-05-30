import { contextBridge, ipcRenderer } from "electron";

const desktopCommandChannel = "ifcnative:desktop-command";
const detachedViewOpenChannel = "ifcnative:detached-view-open";
const detachedViewPayloadChannel = "ifcnative:detached-view-payload";
const desktopMenuStateChannel = "ifcnative:menu-state";
const workspaceSyncBroadcastChannel = "ifcnative:workspace-sync-broadcast";
const workspaceSyncPublishChannel = "ifcnative:workspace-sync-publish";
const workspaceSyncSnapshotChannel = "ifcnative:workspace-sync-snapshot";

contextBridge.exposeInMainWorld(
  "ifcNativeDesktop",
  Object.freeze({
    getDetachedViewPayload(token: string) {
      return ipcRenderer.invoke(detachedViewPayloadChannel, token);
    },
    getWorkspaceSyncSnapshot() {
      return ipcRenderer.invoke(workspaceSyncSnapshotChannel);
    },
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
    onWorkspaceSync(callback: (message: unknown) => void) {
      const listener = (
        _event: Electron.IpcRendererEvent,
        message: unknown,
      ) => {
        callback(message);
      };
      ipcRenderer.on(workspaceSyncBroadcastChannel, listener);
      return () => {
        ipcRenderer.removeListener(workspaceSyncBroadcastChannel, listener);
      };
    },
    openDetachedView(payload: unknown) {
      return ipcRenderer.invoke(detachedViewOpenChannel, payload);
    },
    platform: process.platform,
    publishWorkspaceSync(message: unknown) {
      ipcRenderer.send(workspaceSyncPublishChannel, message);
    },
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
