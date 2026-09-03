export interface DesktopIfcAsset {
  file: File;
  name: string;
  path: string;
}

type NativeFileBytes = ArrayBuffer | Uint8Array | number[];

export async function readDesktopStartupIfcAssets(): Promise<
  DesktopIfcAsset[]
> {
  if (!("__TAURI_INTERNALS__" in globalThis)) {
    return [];
  }
  const { invoke } = await import("@tauri-apps/api/core");
  const paths = await invoke<string[]>("startup_ifc_paths");
  const assets: DesktopIfcAsset[] = [];
  for (const path of paths) {
    assets.push(await readDesktopIfcAsset(path));
  }
  return assets;
}

/** Liest eine IFC-Datei über die Tauri-Brücke; nur im Desktop-Build nutzbar. */
export async function readDesktopIfcAsset(
  path: string,
): Promise<DesktopIfcAsset> {
  const { invoke } = await import("@tauri-apps/api/core");
  const nativeBytes = await invoke<NativeFileBytes>("read_ifc_file", { path });
  const bytes = toUint8Array(nativeBytes);
  const name = fileNameFromPath(path);
  const file = new File([bytes.buffer], name, {
    type: "application/x-step",
  });
  Object.defineProperty(file, "path", {
    configurable: false,
    enumerable: false,
    value: path,
    writable: false,
  });
  return { file, name, path };
}

function toUint8Array(value: NativeFileBytes): Uint8Array<ArrayBuffer> {
  if (value instanceof Uint8Array) {
    return Uint8Array.from(value);
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  return Uint8Array.from(value);
}

function fileNameFromPath(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) || "Geöffnet.ifc";
}
