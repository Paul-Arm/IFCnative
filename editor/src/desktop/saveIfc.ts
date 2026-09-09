export type SaveIfcResult = { status: "saved"; path?: string } | { status: "cancelled" | "download-started" };

interface SaveHandle {
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>;
}

/** Resolves as saved only after a confirmed filesystem write. */
export async function saveIfcFile(fileName: string, text: string): Promise<SaveIfcResult> {
  if ("__TAURI_INTERNALS__" in globalThis) {
    const { invoke } = await import("@tauri-apps/api/core");
    const path = await invoke<string | null>("save_ifc_file", { fileName, contents: text });
    return path ? { status: "saved", path } : { status: "cancelled" };
  }
  const picker = (globalThis as typeof globalThis & {
    showSaveFilePicker?: (options: unknown) => Promise<SaveHandle>;
  }).showSaveFilePicker;
  const blob = new Blob([text], { type: "application/x-step" });
  if (picker) {
    try {
      const handle = await picker({ suggestedName: fileName, types: [{ description: "IFC", accept: { "application/x-step": [".ifc"] } }] });
      const writer = await handle.createWritable();
      try { await writer.write(blob); await writer.close(); }
      catch (error) { await writer.abort().catch(() => {}); throw error; }
      return { status: "saved" };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return { status: "cancelled" };
      throw error;
    }
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.hidden = true;
  document.body.append(anchor);
  try { anchor.click(); }
  finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000); }
  return { status: "download-started" };
}
