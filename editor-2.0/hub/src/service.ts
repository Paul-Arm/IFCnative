/**
 * Katalogschicht des Hubs — Projekte → Modelle → Versionsstände.
 *
 * Das ist die dünne Eigenleistung laut 01-architektur.md §5: ifc-lite bringt
 * Parser, Diff und (später) Collab-Server mit, aber weder Projektverwaltung
 * noch Versionshistorie. Alles Persistente läuft über den `CatalogStore`,
 * alles IFC-Fachliche über `src/ifc/*`.
 */
import { createHash, randomUUID } from "node:crypto";
import type { CatalogStore } from "./storage/adapter.js";
import type {
  ModelEntry,
  ModelSummary,
  ProjectEntry,
  ProjectSummary,
  VersionMeta,
} from "./types.js";
import { badRequest, notFound } from "./errors.js";
import { readFacts } from "./ifc/parse.js";
import { diffIfcBytes, type DiffResult } from "./ifc/diff.js";

export interface CommitInput {
  message?: string | undefined;
  author?: string | undefined;
}

/** sha256 der Bytes, hex — die Adresse des Blobs. */
export function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function cleanName(raw: unknown, what: string): string {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw badRequest(`${what} fehlt oder ist leer.`);
  }
  const name = raw.trim();
  if (name.length > 200) {
    throw badRequest(`${what} ist zu lang (maximal 200 Zeichen).`);
  }
  return name;
}

export class HubService {
  constructor(private readonly store: CatalogStore) {}

  async init(): Promise<void> {
    await this.store.init();
  }

  // ---- Projekte -----------------------------------------------------------

  async listProjects(): Promise<ProjectSummary[]> {
    const catalog = await this.store.read();
    return catalog.projects.map(projectSummary);
  }

  async createProject(name: unknown): Promise<ProjectSummary> {
    const clean = cleanName(name, "Projektname");
    return this.store.transaction((catalog) => {
      const project: ProjectEntry = {
        id: randomUUID(),
        name: clean,
        createdAt: new Date().toISOString(),
        models: [],
      };
      catalog.projects.push(project);
      return projectSummary(project);
    });
  }

  // ---- Modelle ------------------------------------------------------------

  async listModels(projectId: string): Promise<ModelSummary[]> {
    const catalog = await this.store.read();
    return findProject(catalog.projects, projectId).models.map(modelSummary);
  }

  async createModel(projectId: string, name: unknown): Promise<ModelSummary> {
    const clean = cleanName(name, "Modellname");
    return this.store.transaction((catalog) => {
      const project = findProject(catalog.projects, projectId);
      const model: ModelEntry = {
        id: randomUUID(),
        name: clean,
        createdAt: new Date().toISOString(),
        versions: [],
      };
      project.models.push(model);
      return modelSummary(model);
    });
  }

  // ---- Versionsstände -----------------------------------------------------

  /** Historie eines Modells, neueste zuerst. */
  async listVersions(
    projectId: string,
    modelId: string,
  ): Promise<VersionMeta[]> {
    const catalog = await this.store.read();
    const model = findModel(catalog.projects, projectId, modelId);
    return [...model.versions].reverse();
  }

  /**
   * Committet IFC-Bytes als neuen Stand.
   *
   * Reihenfolge: erst parsen (schlägt bei kaputtem IFC fehl, bevor irgendetwas
   * geschrieben wird), dann Blob ablegen (dedupliziert über den Hash), dann
   * den Katalogeintrag anhängen.
   */
  async createVersion(
    projectId: string,
    modelId: string,
    bytes: Uint8Array,
    input: CommitInput = {},
  ): Promise<VersionMeta> {
    // Existenz vorab prüfen, damit ein Fehlgriff nicht erst nach dem Parse auffällt.
    const catalog = await this.store.read();
    findModel(catalog.projects, projectId, modelId);

    const facts = await readFacts(bytes);
    const blobHash = hashBytes(bytes);
    await this.store.putBlob(blobHash, bytes);

    const version: VersionMeta = {
      id: randomUUID(),
      message: (input.message ?? "").trim(),
      author: (input.author ?? "").trim(),
      createdAt: new Date().toISOString(),
      schema: facts.schema,
      entityCount: facts.entityCount,
      byteSize: bytes.byteLength,
      blobHash,
    };
    return this.store.transaction((current) => {
      findModel(current.projects, projectId, modelId).versions.push(version);
      return version;
    });
  }

  async getVersion(
    projectId: string,
    modelId: string,
    versionId: string,
  ): Promise<VersionMeta> {
    const catalog = await this.store.read();
    return findVersion(catalog.projects, projectId, modelId, versionId);
  }

  /** IFC-Bytes eines Standes — byte-identisch zum Commit. */
  async readVersionFile(
    projectId: string,
    modelId: string,
    versionId: string,
  ): Promise<{ version: VersionMeta; bytes: Uint8Array }> {
    const version = await this.getVersion(projectId, modelId, versionId);
    return { version, bytes: await this.store.getBlob(version.blobHash) };
  }

  /** Vergleicht zwei Stände desselben Modells; `versionId` ist die Basis. */
  async diffVersions(
    projectId: string,
    modelId: string,
    versionId: string,
    otherVersionId: string,
  ): Promise<DiffResult & { base: string; head: string }> {
    const catalog = await this.store.read();
    const base = findVersion(catalog.projects, projectId, modelId, versionId);
    const head = findVersion(
      catalog.projects,
      projectId,
      modelId,
      otherVersionId,
    );
    // Gleicher Blob → garantiert leerer Diff, ohne zweimal zu parsen.
    if (base.blobHash === head.blobHash) {
      return {
        added: [],
        removed: [],
        modified: [],
        summary: { added: 0, removed: 0, modified: 0, unchanged: 0 },
        scope: "data",
        fieldDetail: false,
        base: base.id,
        head: head.id,
      };
    }
    const [baseBytes, headBytes] = await Promise.all([
      this.store.getBlob(base.blobHash),
      this.store.getBlob(head.blobHash),
    ]);
    const result = await diffIfcBytes(baseBytes, headBytes);
    return { ...result, base: base.id, head: head.id };
  }
}

// ---- Suchhelfer -----------------------------------------------------------

function findProject(projects: ProjectEntry[], id: string): ProjectEntry {
  const project = projects.find((entry) => entry.id === id);
  if (!project) throw notFound(`Projekt "${id}"`);
  return project;
}

function findModel(
  projects: ProjectEntry[],
  projectId: string,
  modelId: string,
): ModelEntry {
  const model = findProject(projects, projectId).models.find(
    (entry) => entry.id === modelId,
  );
  if (!model) throw notFound(`Modell "${modelId}"`);
  return model;
}

function findVersion(
  projects: ProjectEntry[],
  projectId: string,
  modelId: string,
  versionId: string,
): VersionMeta {
  const version = findModel(projects, projectId, modelId).versions.find(
    (entry) => entry.id === versionId,
  );
  if (!version) throw notFound(`Stand "${versionId}"`);
  return version;
}

function projectSummary(project: ProjectEntry): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    modelCount: project.models.length,
  };
}

function modelSummary(model: ModelEntry): ModelSummary {
  return {
    id: model.id,
    name: model.name,
    createdAt: model.createdAt,
    versionCount: model.versions.length,
  };
}
