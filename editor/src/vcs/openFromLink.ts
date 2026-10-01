/**
 * Lädt den Stand, auf den ein Editor-Link zeigt (src/desktop/editorLink.ts),
 * als Hub-Dokument — mit Herkunft, damit "auf den Hub committen" wie bei
 * einem über den Hub-Browser geöffneten Modell funktioniert.
 */

import type { EditorOpenRequest } from "@/desktop/editorLink";

import { VcsApiError, type VcsApiClient } from "./client";
import type { VcsDocumentOrigin } from "./types";

export interface LinkedHubDocument {
  text: string;
  fileName: string;
  origin: VcsDocumentOrigin;
}

type LinkClient = Pick<VcsApiClient, "getProject" | "getModel" | "downloadCommitText">;

/** Fehler mit verständlicher Meldung für den Dialog. */
export class EditorLinkError extends Error {
  constructor(
    message: string,
    /** true: Anmeldung abgelaufen/ungültig — neu anmelden lassen. */
    readonly unauthorized = false,
  ) {
    super(message);
    this.name = "EditorLinkError";
  }
}

function describe(error: unknown, what: string): EditorLinkError {
  if (error instanceof EditorLinkError) return error;
  if (error instanceof VcsApiError) {
    if (error.status === 401) {
      return new EditorLinkError("Die Anmeldung am IFC Hub ist abgelaufen — bitte neu anmelden.", true);
    }
    if (error.status === 403 || error.status === 404) {
      return new EditorLinkError(`${what} wurde nicht gefunden, oder dir fehlt der Zugriff.`);
    }
    return new EditorLinkError(error.message);
  }
  const message = error instanceof Error ? error.message : String(error);
  // Tauri-HTTP-Plugin: Host nicht in src-tauri/capabilities/default.json.
  if (/not allowed|scope/i.test(message)) {
    return new EditorLinkError(
      "Dieser Hub ist im Editor nicht freigegeben. Die Adresse muss in der Editor-Konfiguration hinterlegt sein.",
    );
  }
  return new EditorLinkError(message);
}

export async function loadLinkedHubDocument(
  client: LinkClient,
  request: EditorOpenRequest,
): Promise<LinkedHubDocument> {
  const label = `Modell „${request.project}/${request.model}“`;
  let project: Awaited<ReturnType<LinkClient["getProject"]>>;
  let detail: Awaited<ReturnType<LinkClient["getModel"]>>;
  try {
    project = await client.getProject(request.project);
    detail = await client.getModel(request.project, request.model);
  } catch (error) {
    throw describe(error, label);
  }
  const { model, branches } = detail;
  if (model.kind && model.kind !== "ifc") {
    throw new EditorLinkError(`„${model.name}“ ist kein IFC-Modell und lässt sich im Editor nicht öffnen.`);
  }

  let branchName = request.branch;
  let commitId = request.commit;
  if (!commitId) {
    // Ohne Commit: aktueller Stand des (Standard-)Branches.
    branchName ??= model.defaultBranch;
    const branch = branches.find((candidate) => candidate.name === branchName);
    if (!branch) throw new EditorLinkError(`Branch „${branchName}“ gibt es in „${model.name}“ nicht.`);
    if (!branch.headCommitId) throw new EditorLinkError(`Branch „${branchName}“ hat noch keine Commits.`);
    commitId = branch.headCommitId;
  } else {
    // Mit Commit: Branch aus dem Link, sonst der, dessen Stand er ist.
    branchName ??=
      branches.find((candidate) => candidate.headCommitId === commitId)?.name ?? model.defaultBranch;
  }

  let text: string;
  try {
    text = await client.downloadCommitText(request.project, request.model, commitId);
  } catch (error) {
    throw describe(error, `Stand ${commitId.slice(0, 8)} von ${label}`);
  }
  return {
    fileName: /\.ifc$/i.test(model.name) ? model.name : `${model.name}.ifc`,
    origin: {
      branch: branchName,
      commitId,
      modelName: model.name,
      modelSlug: model.slug,
      projectName: project.name,
      projectSlug: project.slug,
    },
    text,
  };
}
