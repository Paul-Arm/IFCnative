import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { GuidDiffSummary, VersionManifestEntry } from "../ifc";
import { MemoryRepository } from "./memoryRepository";
import type { Branch, Commit, Member, Model, Project, User } from "./types";

interface CatalogFile {
  version: 1;
  users: User[];
  projects: Project[];
  members: Member[];
  models: Model[];
  branches: Branch[];
  commits: Commit[];
  entityObjects: [string, { type: string; name: string; payload: string }][];
  commitEntities: [string, { globalId: string; hash: string }[]][];
  diffCache: [string, GuidDiffSummary][];
  /** explizit angelegte Ordner je Projekt (seit Ordner-Feature; optional). */
  folders?: [string, string[]][];
}

/**
 * Lokaler Persistenz-Modus ohne Postgres: die MemoryRepository-Daten werden
 * als eine JSON-Katalogdatei unter DATA_DIR gehalten (die IFC-Blobs liegen
 * daneben im FilesystemObjectStore). Geschrieben wird atomar (Temp-Datei +
 * rename) und debounced — mehrere Mutationen kurz nacheinander ergeben einen
 * Schreibvorgang; ein Absturz hinterlässt nie eine halbe Datei.
 *
 * Für Team-/Serverbetrieb mit vielen großen Modellen ist Postgres
 * (`DATABASE_URL`) der richtige Modus — diese Datei lädt beim Start komplett
 * in den Speicher.
 */
export class JsonFileRepository extends MemoryRepository {
  private saveTimer: NodeJS.Timeout | null = null;
  private savePromise: Promise<void> = Promise.resolve();
  private dirty = false;

  constructor(private readonly filePath: string) {
    super();
  }

  /** Katalogdatei laden (fehlende Datei = leerer Katalog). */
  async init(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch {
      return;
    }
    const parsed = JSON.parse(raw) as CatalogFile;
    if (parsed.version !== 1) {
      throw new Error(
        `Unbekannte Katalog-Version ${String(parsed.version)} in ${this.filePath}`,
      );
    }
    this.users = new Map(parsed.users.map((user) => [user.id, user]));
    this.projects = new Map(parsed.projects.map((p) => [p.id, p]));
    this.members = parsed.members;
    // Kataloge von vor dem Ordner-Feature haben kein `folder`-Feld an Modellen.
    this.models = new Map(
      parsed.models.map((m) => [m.id, { ...m, folder: m.folder ?? "" }]),
    );
    this.branches = new Map(parsed.branches.map((b) => [b.id, b]));
    this.commits = new Map(parsed.commits.map((c) => [c.id, c]));
    this.entityObjects = new Map(parsed.entityObjects);
    this.commitEntities = new Map(parsed.commitEntities);
    this.diffCache = new Map(parsed.diffCache);
    this.folders = new Map(
      (parsed.folders ?? []).map(([projectId, paths]) => [
        projectId,
        new Set(paths),
      ]),
    );
  }

  private snapshot(): CatalogFile {
    return {
      version: 1,
      users: [...this.users.values()],
      projects: [...this.projects.values()],
      members: [...this.members],
      models: [...this.models.values()],
      branches: [...this.branches.values()],
      commits: [...this.commits.values()],
      entityObjects: [...this.entityObjects.entries()],
      commitEntities: [...this.commitEntities.entries()],
      diffCache: [...this.diffCache.entries()],
      folders: [...this.folders.entries()].map(([projectId, paths]) => [
        projectId,
        [...paths],
      ]),
    };
  }

  private scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer) {
      return;
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      // Schreibvorgänge serialisieren: der nächste startet erst, wenn der
      // vorherige rename abgeschlossen ist.
      this.savePromise = this.savePromise.then(() => this.writeNow());
    }, 250);
    // Der Timer darf einen ansonsten fertigen Prozess nicht am Beenden hindern.
    this.saveTimer.unref?.();
  }

  private async writeNow(): Promise<void> {
    if (!this.dirty) {
      return;
    }
    this.dirty = false;
    const tmp = `${this.filePath}.tmp`;
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(tmp, JSON.stringify(this.snapshot()), "utf8");
    await rename(tmp, this.filePath);
  }

  /** Ausstehende Schreibvorgänge abschließen (Tests, sauberes Herunterfahren). */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.savePromise = this.savePromise.then(() => this.writeNow());
    await this.savePromise;
  }

  // ---- Mutationen persistieren ----------------------------------------

  override async createUser(
    input: Omit<User, "id" | "createdAt">,
  ): Promise<User> {
    const user = await super.createUser(input);
    this.scheduleSave();
    return user;
  }

  override async createProject(
    input: Omit<Project, "id" | "createdAt">,
  ): Promise<Project> {
    const project = await super.createProject(input);
    this.scheduleSave();
    return project;
  }

  override async addMember(member: Member): Promise<Member> {
    const added = await super.addMember(member);
    this.scheduleSave();
    return added;
  }

  override async removeMember(projectId: string, userId: string): Promise<void> {
    await super.removeMember(projectId, userId);
    this.scheduleSave();
  }

  override async createModel(
    input: Omit<Model, "id" | "createdAt">,
  ): Promise<Model> {
    const model = await super.createModel(input);
    this.scheduleSave();
    return model;
  }

  override async createBranch(input: Omit<Branch, "id">): Promise<Branch> {
    const branch = await super.createBranch(input);
    this.scheduleSave();
    return branch;
  }

  override async setBranchHead(
    branchId: string,
    headCommitId: string,
  ): Promise<void> {
    await super.setBranchHead(branchId, headCommitId);
    this.scheduleSave();
  }

  override async createCommit(commit: Commit): Promise<Commit> {
    const created = await super.createCommit(commit);
    this.scheduleSave();
    return created;
  }

  override async saveManifest(
    commitId: string,
    entries: VersionManifestEntry[],
  ): Promise<void> {
    await super.saveManifest(commitId, entries);
    this.scheduleSave();
  }

  override async saveCachedDiff(
    fromCommitId: string,
    toCommitId: string,
    summary: GuidDiffSummary,
  ): Promise<void> {
    await super.saveCachedDiff(fromCommitId, toCommitId, summary);
    this.scheduleSave();
  }

  override async updateModel(
    modelId: string,
    patch: Partial<
      Pick<Model, "name" | "visibility" | "defaultBranch" | "folder">
    >,
  ): Promise<Model | null> {
    const model = await super.updateModel(modelId, patch);
    if (model) {
      this.scheduleSave();
    }
    return model;
  }

  override async deleteModel(modelId: string): Promise<string[]> {
    const blobKeys = await super.deleteModel(modelId);
    this.scheduleSave();
    return blobKeys;
  }

  override async deleteProject(projectId: string): Promise<string[]> {
    const blobKeys = await super.deleteProject(projectId);
    this.scheduleSave();
    return blobKeys;
  }

  override async addFolder(projectId: string, path: string): Promise<void> {
    await super.addFolder(projectId, path);
    this.scheduleSave();
  }

  override async removeFolder(projectId: string, path: string): Promise<void> {
    await super.removeFolder(projectId, path);
    this.scheduleSave();
  }
}
