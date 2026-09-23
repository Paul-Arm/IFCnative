import type { Commit, Model, ModelKind } from "~/types/api";

/**
 * Uploads mit Fortschritt (XMLHttpRequest — fetch kennt keinen Upload-
 * Fortschritt). Große IFCs brauchen erst den Upload und danach Sekunden
 * für die Analyse im Server; beides soll sichtbar sein.
 */

export function modelKindForFile(name: string): ModelKind {
  const ext = fileExtension(name);
  if (ext === "md" || ext === "markdown") return "md";
  if (ext === "ifc") return "ifc";
  return "file";
}

export interface CommitUploadOptions {
  slug: string;
  modelSlug: string;
  file: File;
  message: string;
  branch?: string;
  token: string | null;
  /** 0..100 während des Uploads; 100 = Server verarbeitet. */
  onProgress?: (percent: number) => void;
}

export function uploadCommit(options: CommitUploadOptions): Promise<{ commit: Commit }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("message", options.message);
    if (options.branch) form.append("branch", options.branch);
    form.append("file", options.file);

    const xhr = new XMLHttpRequest();
    xhr.open(
      "POST",
      `/api/projects/${options.slug}/models/${options.modelSlug}/commits?compact=1`,
    );
    if (options.token) xhr.setRequestHeader("authorization", `Bearer ${options.token}`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        options.onProgress?.(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.upload.onload = () => options.onProgress?.(100);
    xhr.onerror = () => reject(new Error("Verbindung zum Server fehlgeschlagen"));
    xhr.onload = () => {
      let body: { commit?: Commit; error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText) as typeof body;
      } catch {
        // kein JSON — Statuscode entscheidet
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.commit) {
        resolve({ commit: body.commit });
      } else {
        reject(new Error(body.error ?? `Upload fehlgeschlagen (HTTP ${xhr.status})`));
      }
    };
    xhr.send(form);
  });
}

/** Neues Modell für eine Datei anlegen (Art aus der Endung). */
export async function createModelForFile(
  api: ReturnType<typeof useApi>["api"],
  slug: string,
  file: File,
  folder: string,
): Promise<Model> {
  const { model } = await api<{ model: Model }>(`/projects/${slug}/models`, {
    method: "POST",
    body: { name: file.name, kind: modelKindForFile(file.name), folder },
  });
  return model;
}
