import { version } from "../../package.json";
import { UpdateController, type UpdateBackend, type Progress } from "./controller";

const desktop = () => "__TAURI_INTERNALS__" in globalThis;
const backend: UpdateBackend = {
  async status() {
    if (!desktop()) return { currentVersion: version, configured: false, desktop: false };
    const { invoke } = await import("@tauri-apps/api/core");
    return { ...await invoke<{ currentVersion: string; configured: boolean }>("update_status"), desktop: true };
  },
  async check() {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("check_editor_update");
  },
  async download(version, progress) {
    const { invoke, Channel } = await import("@tauri-apps/api/core");
    const onProgress = new Channel<Progress>();
    onProgress.onmessage = progress;
    await invoke("download_editor_update", { version, onProgress });
  },
  async install(version) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("install_editor_update", { version });
  },
  async patchnotes(version) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("editor_patchnotes", { version });
  },
};

function storage() { try { return globalThis.localStorage; } catch { return undefined; } }
export const editorUpdates = new UpdateController(backend, storage(), () => Date.now(), version);
