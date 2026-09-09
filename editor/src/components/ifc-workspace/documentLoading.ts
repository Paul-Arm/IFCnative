import { parseNativeIfcFileInWorker } from "../../ifc/nativeDocumentWorker";
import type { VcsDocumentOrigin } from "../../vcs/types";
import { createWorkspaceDocumentSession } from "./documentTransaction";

export type WorkspaceDocumentSource =
  | { file: File; name?: string }
  | { text: string; fileName: string; origin?: VcsDocumentOrigin };

export async function loadWorkspaceDocument(source: WorkspaceDocumentSource) {
  const fromFile = "file" in source;
  const file = fromFile ? source.file : new File([source.text], source.fileName, { type: "application/x-step" });
  const parsed = await parseNativeIfcFileInWorker(file, fromFile ? source.name ?? file.name : source.fileName);
  return {
    elapsedMs: parsed.elapsedMs,
    session: createWorkspaceDocumentSession(parsed.document, {
      bytes: parsed.bytes,
      file,
      text: fromFile ? undefined : source.text,
      vcsOrigin: fromFile ? null : source.origin ?? null,
    }),
  };
}

/** Parse sequentially to bound worker memory; callers publish only the completed group. */
export async function loadWorkspaceDocuments(sources: WorkspaceDocumentSource[]) {
  const loaded: Awaited<ReturnType<typeof loadWorkspaceDocument>>[] = [];
  for (const source of sources) loaded.push(await loadWorkspaceDocument(source));
  return loaded;
}
