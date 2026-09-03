import type {
  EntityFieldDiff,
  IdsValidationSummary,
  VersionManifestEntry,
} from "../ifc";

/** Nachrichtenformat zwischen Hauptthread (IfcWorkerPool) und ifcWorker. */

export interface AnalyzeTask {
  type: "analyze";
  bytes: Uint8Array;
}

export interface AnalyzeResult {
  schema: string;
  manifestHash: string;
  entityCount: number;
  duplicateGlobalIds: string[];
  entries: VersionManifestEntry[];
}

export interface EntityDiffDocument {
  /** Commit-Id — Schlüssel des Parse-Caches im Worker. */
  id: string;
  /** Nur mitschicken, wenn der Worker das Dokument (vermutlich) nicht hat. */
  bytes?: Uint8Array;
}

export interface EntityDiffTask {
  type: "entityDiff";
  from: EntityDiffDocument;
  to: EntityDiffDocument;
  globalId: string;
}

export type EntityDiffResult =
  | { detail: EntityFieldDiff; cachedIds: string[]; missing?: undefined }
  | { missing: string[]; detail?: undefined };

export interface ValidateIdsTask {
  type: "validateIds";
  idsXml: string;
  idsFileName: string;
  bytes: Uint8Array;
}

export interface ValidateIdsResult {
  summary: IdsValidationSummary;
  idsWarnings: string[];
  failedGuids: string[];
}

export interface FragmentsTask {
  type: "fragments";
  bytes: Uint8Array;
}

export interface FragmentsResult {
  bytes: Uint8Array;
}

export type WorkerTask =
  | AnalyzeTask
  | EntityDiffTask
  | ValidateIdsTask
  | FragmentsTask;

export interface WorkerRequest {
  id: number;
  task: WorkerTask;
}

export type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };
