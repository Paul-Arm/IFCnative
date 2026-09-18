import { createHash, randomUUID } from "node:crypto";

import {
  diffManifests,
  diffObjectDetails,
  diffObjectIndexes,
  type EntityFieldDiff,
  type GuidDiffSummary,
  type ObjectChangeEntry,
  type ObjectDiffSummary,
  type ObjectFieldChange,
  type ObjectIndexEntry,
  type VersionManifest,
  type VersionManifestEntry,
} from "../ifc";
import type { ObjectStore } from "../storage/objectStore";
import type { Commit, Model, Repository } from "../repository/types";
import { IfcWorkerPool, defaultIfcWorkerPool } from "./ifcWorkerPool";

/**
 * The versioning core: turns an uploaded IFC file into a content-addressable
 * commit and computes semantic diffs between commits by GlobalId.
 *
 * - Raw IFC text -> object store (Azure Blob in prod), for perfect round-trip.
 * - Version manifest {globalId -> entityHash} -> repository, where entity
 *   payloads are deduped across commits (entity_objects).
 * - Diffs are cached in the repository (commits are immutable).
 *
 * STEP-Parsing, Hashing und Feld-Diffs laufen im IfcWorkerPool — ein
 * 270-MB-Modell hält sonst den ganzen Server 30 s und länger an.
 */

const EMPTY_MANIFEST: VersionManifest = {
  manifestHash: "",
  entries: new Map(),
  duplicateGlobalIds: [],
  entityCount: 0,
};

function manifestFromEntries(
  entries: VersionManifestEntry[],
  manifestHash: string,
): VersionManifest {
  const map = new Map<string, VersionManifestEntry>();
  for (const entry of entries) {
    map.set(entry.globalId, entry);
  }
  return {
    manifestHash,
    entries: map,
    duplicateGlobalIds: [],
    entityCount: map.size,
  };
}

export interface CreateCommitInput {
  model: Model;
  branchName: string;
  /**
   * Dateiinhalt: STEP bei kind "ifc", Markdown bei kind "md". Große IFCs
   * bitte als Buffer übergeben — das erspart eine 100-MB-String-Kopie.
   */
  text: string | Buffer;
  authorId: string;
  message: string;
}

export interface CreateCommitResult {
  commit: Commit;
  /** Semantic diff against the previous head of the branch (parent commit). */
  diff: GuidDiffSummary;
  /** Objektzentrierter Diff zum Vorgänger (Grundlage der Commit-Zähler). */
  changes: ObjectDiffSummary;
}

/** Vorher/Nachher-Werte eines einzelnen Objekts zwischen zwei Ständen. */
export interface ObjectChangeDetail {
  entry: ObjectChangeEntry | null;
  changes: ObjectFieldChange[];
}

const EMPTY_CHANGES: ObjectDiffSummary = {
  added: [],
  removed: [],
  modified: [],
  unchanged: 0,
};

export class CommitService {
  private readonly workers: IfcWorkerPool;

  constructor(
    private readonly repo: Repository,
    private readonly store: ObjectStore,
    workers?: IfcWorkerPool,
  ) {
    this.workers = workers ?? defaultIfcWorkerPool();
  }

  /**
   * Kleiner LRU der vollständigen Diff-Summaries (Commit-Paar -> Summary).
   * Die Web-UI blättert seitenweise durch ein Diff; ohne Cache würde jede
   * Seite das (bei 150k Entities ~30 MB große) JSON aus der DB neu parsen.
   */
  private readonly diffCache = new Map<string, GuidDiffSummary>();
  private static readonly DIFF_CACHE_LIMIT = 8;

  private blobKey(modelId: string, commitId: string): string {
    return `models/${modelId}/commits/${commitId}.ifc`;
  }

  async createCommit(input: CreateCommitInput): Promise<CreateCommitResult> {
    if (input.model.kind === "md") {
      return this.createMarkdownCommit(input);
    }
    const { model, branchName, authorId, message } = input;
    const bytes =
      typeof input.text === "string" ? Buffer.from(input.text, "utf8") : input.text;

    const analysis = await this.workers.analyze(bytes);
    const manifest: VersionManifest = {
      manifestHash: analysis.manifestHash,
      entries: new Map(analysis.entries.map((entry) => [entry.globalId, entry])),
      duplicateGlobalIds: analysis.duplicateGlobalIds,
      entityCount: analysis.entityCount,
    };

    let branch = await this.repo.getBranch(model.id, branchName);
    if (!branch) {
      branch = await this.repo.createBranch({
        modelId: model.id,
        name: branchName,
        headCommitId: null,
      });
    }

    const parentCommit = branch.headCommitId
      ? await this.repo.getCommit(branch.headCommitId)
      : null;

    const parentManifest = parentCommit
      ? manifestFromEntries(
          await this.repo.getManifest(parentCommit.id),
          parentCommit.manifestHash,
        )
      : EMPTY_MANIFEST;
    const diff = diffManifests(parentManifest, manifest);

    // Objektzentrierter Diff = die Zahlen, die Menschen sehen. Stammt der
    // Vorgänger aus der Zeit vor den Objekt-Records, wird er einmalig
    // nachindiziert; scheitert das, bleiben die Entity-Zähler als Ersatz.
    const objectIndex: ObjectIndexEntry[] = analysis.objects.map(
      ({ detail: _detail, ...entry }) => entry,
    );
    let changes: ObjectDiffSummary | null = null;
    try {
      const parentIndex = parentCommit
        ? await this.objectIndexOf(parentCommit)
        : [];
      changes = diffObjectIndexes(parentIndex, objectIndex);
    } catch {
      changes = null;
    }

    const commitId = randomUUID();
    const blobKey = this.blobKey(model.id, commitId);
    // Blob zuerst: schlägt die DB-Transaktion fehl, bleibt höchstens ein
    // harmloser verwaister Blob zurück — nie ein Commit ohne Datei.
    await this.store.put(blobKey, bytes, "application/x-step");

    const commit: Commit = {
      id: commitId,
      modelId: model.id,
      branchName,
      parentCommitId: parentCommit?.id ?? null,
      manifestHash: manifest.manifestHash,
      blobKey,
      schema: analysis.schema,
      authorId,
      message,
      createdAt: new Date().toISOString(),
      entityCount: manifest.entityCount,
      added: (changes ?? diff).added.length,
      removed: (changes ?? diff).removed.length,
      modified: (changes ?? diff).modified.length,
    };

    // Commit + Manifest + Branch-Head atomar — kein halber Commit bei Crash.
    await this.repo.transaction(async () => {
      await this.repo.createCommit(commit);
      await this.repo.saveManifest(commitId, analysis.entries);
      await this.repo.saveObjectRecords(commitId, analysis.objects);
      await this.repo.setBranchHead(branch.id, commit.id);
    });

    if (parentCommit) {
      // Der Diff zum Vorgänger ist gleich der erste, den die UI anfragt.
      await this.repo.saveCachedDiff(parentCommit.id, commit.id, diff);
      this.rememberDiff(parentCommit.id, commit.id, diff);
    }
    if (changes) {
      this.rememberChanges(parentCommit?.id ?? null, commit.id, changes);
    }

    return { commit, diff, changes: changes ?? EMPTY_CHANGES };
  }

  /**
   * Markdown-Commit: kein IFC-Parsing, kein Objekt-Diff. Der sha256 des
   * Inhalts dient als manifestHash, damit die Identisch-Erkennung
   * (gleicher Stand erneut committet) genauso funktioniert wie bei IFC.
   */
  private async createMarkdownCommit(
    input: CreateCommitInput,
  ): Promise<CreateCommitResult> {
    const { model, branchName, authorId, message } = input;
    const text =
      typeof input.text === "string" ? input.text : input.text.toString("utf8");
    const contentHash = createHash("sha256").update(text, "utf8").digest("hex");

    let branch = await this.repo.getBranch(model.id, branchName);
    if (!branch) {
      branch = await this.repo.createBranch({
        modelId: model.id,
        name: branchName,
        headCommitId: null,
      });
    }
    const parentCommit = branch.headCommitId
      ? await this.repo.getCommit(branch.headCommitId)
      : null;

    const commitId = randomUUID();
    const blobKey = this.blobKey(model.id, commitId);
    await this.store.put(blobKey, text, "text/markdown");

    const diff: GuidDiffSummary = {
      added: [],
      removed: [],
      modified: [],
      unchanged: 0,
      beforeManifestHash: parentCommit?.manifestHash ?? "",
      afterManifestHash: contentHash,
      identical: parentCommit ? parentCommit.manifestHash === contentHash : false,
    };

    const commit: Commit = {
      id: commitId,
      modelId: model.id,
      branchName,
      parentCommitId: parentCommit?.id ?? null,
      manifestHash: contentHash,
      blobKey,
      schema: "markdown",
      authorId,
      message,
      createdAt: new Date().toISOString(),
      entityCount: 0,
      added: 0,
      removed: 0,
      modified: 0,
    };

    await this.repo.transaction(async () => {
      await this.repo.createCommit(commit);
      await this.repo.saveManifest(commitId, []);
      await this.repo.setBranchHead(branch.id, commit.id);
    });

    return { commit, diff, changes: EMPTY_CHANGES };
  }

  // ---- Objektzentrierter Diff ------------------------------------------

  /** LRU der Objekt-Diffs (Schlüssel "from:to", from = "" beim ersten Commit). */
  private readonly changesCache = new Map<string, ObjectDiffSummary>();
  private readonly changesById = new WeakMap<
    ObjectDiffSummary,
    Map<string, ObjectChangeEntry>
  >();
  /** Laufende Nachindizierungen — parallele Anfragen teilen sich eine. */
  private readonly indexing = new Map<string, Promise<void>>();

  private rememberChanges(
    fromId: string | null,
    toId: string,
    changes: ObjectDiffSummary,
  ): void {
    const key = `${fromId ?? ""}:${toId}`;
    this.changesCache.delete(key);
    if (this.changesCache.size >= CommitService.DIFF_CACHE_LIMIT) {
      const oldest = this.changesCache.keys().next().value;
      if (oldest !== undefined) {
        this.changesCache.delete(oldest);
      }
    }
    this.changesCache.set(key, changes);
  }

  /**
   * Objekt-Index eines Commits. Commits aus der Zeit vor den Objekt-Records
   * werden beim ersten Zugriff einmalig im Worker nachindiziert (IFC parsen
   * -> Records speichern); danach kommt alles aus der Datenbank.
   */
  private async objectIndexOf(commit: Commit): Promise<ObjectIndexEntry[]> {
    if (commit.schema === "markdown") {
      return [];
    }
    if (!(await this.repo.hasObjectIndex(commit.id))) {
      let pending = this.indexing.get(commit.id);
      if (!pending) {
        pending = (async () => {
          const bytes = await this.store.get(commit.blobKey);
          const records = await this.workers.objectRecords(new Uint8Array(bytes));
          await this.repo.saveObjectRecords(commit.id, records);
        })().finally(() => this.indexing.delete(commit.id));
        this.indexing.set(commit.id, pending);
      }
      await pending;
    }
    return this.repo.getObjectIndex(commit.id);
  }

  /**
   * Objektzentrierter Diff zweier Stände (`from` = null: gegen den leeren
   * Stand, d. h. alles ist neu). Braucht nur die kompakten Index-Zeilen aus
   * der Datenbank — kein IFC-Parsing, auch nicht bei 100k+ Objekten.
   */
  async getChanges(from: Commit | null, to: Commit): Promise<ObjectDiffSummary> {
    const key = `${from?.id ?? ""}:${to.id}`;
    const cached = this.changesCache.get(key);
    if (cached) {
      this.rememberChanges(from?.id ?? null, to.id, cached);
      return cached;
    }
    const [fromIndex, toIndex] = await Promise.all([
      from ? this.objectIndexOf(from) : Promise.resolve([]),
      this.objectIndexOf(to),
    ]);
    const changes = diffObjectIndexes(fromIndex, toIndex);
    this.rememberChanges(from?.id ?? null, to.id, changes);

    // Zähler alter Commits (noch Entity-basiert) an den Objekt-Diff angleichen,
    // damit Commit-Liste und Commit-Seite dieselben Zahlen zeigen.
    if (
      to.schema !== "markdown" &&
      (to.parentCommitId ?? null) === (from?.id ?? null) &&
      (to.added !== changes.added.length ||
        to.removed !== changes.removed.length ||
        to.modified !== changes.modified.length)
    ) {
      await this.repo.updateCommitStats(to.id, {
        added: changes.added.length,
        removed: changes.removed.length,
        modified: changes.modified.length,
      });
    }
    return changes;
  }

  /** Alle Vorher/Nachher-Werte EINES Objekts (Aufklappen in der UI). */
  async getObjectChange(
    from: Commit | null,
    to: Commit,
    globalId: string,
  ): Promise<ObjectChangeDetail> {
    const changes = await this.getChanges(from, to);
    let byId = this.changesById.get(changes);
    if (!byId) {
      byId = new Map();
      for (const list of [changes.added, changes.modified, changes.removed]) {
        for (const entry of list) {
          byId.set(entry.globalId, entry);
        }
      }
      this.changesById.set(changes, byId);
    }
    const entry = byId.get(globalId) ?? null;
    if (!entry) {
      return { entry: null, changes: [] };
    }
    const details = await this.repo.getObjectDetails(
      [entry.beforeHash, entry.afterHash].filter(
        (hash): hash is string => hash !== undefined,
      ),
    );
    return {
      entry,
      changes: diffObjectDetails(
        entry.beforeHash ? (details.get(entry.beforeHash) ?? null) : null,
        entry.afterHash ? (details.get(entry.afterHash) ?? null) : null,
      ),
    };
  }

  private rememberDiff(fromId: string, toId: string, diff: GuidDiffSummary): void {
    const key = `${fromId}:${toId}`;
    this.diffCache.delete(key);
    if (this.diffCache.size >= CommitService.DIFF_CACHE_LIMIT) {
      const oldest = this.diffCache.keys().next().value;
      if (oldest !== undefined) {
        this.diffCache.delete(oldest);
      }
    }
    this.diffCache.set(key, diff);
  }

  async getDiff(from: Commit, to: Commit): Promise<GuidDiffSummary> {
    const key = `${from.id}:${to.id}`;
    const inMemory = this.diffCache.get(key);
    if (inMemory) {
      this.rememberDiff(from.id, to.id, inMemory);
      return inMemory;
    }
    const cached = await this.repo.getCachedDiff(from.id, to.id);
    if (cached) {
      this.rememberDiff(from.id, to.id, cached);
      return cached;
    }
    const [fromEntries, toEntries] = await Promise.all([
      this.repo.getManifest(from.id),
      this.repo.getManifest(to.id),
    ]);
    const summary = diffManifests(
      manifestFromEntries(fromEntries, from.manifestHash),
      manifestFromEntries(toEntries, to.manifestHash),
    );
    await this.repo.saveCachedDiff(from.id, to.id, summary);
    this.rememberDiff(from.id, to.id, summary);
    return summary;
  }

  /**
   * Field-level "what changed" detail for a single GlobalId between two commits.
   * Der Worker parst (und cacht) beide Stände und vergleicht Attribute,
   * Placement, Geometrie und Property-/Quantity-Sets.
   */
  async getEntityDiff(
    from: Commit,
    to: Commit,
    globalId: string,
  ): Promise<EntityFieldDiff> {
    const blobKeys = new Map<string, string>([
      [from.id, from.blobKey],
      [to.id, to.blobKey],
    ]);
    return this.workers.entityDiff(from.id, to.id, globalId, async (id) => {
      const blobKey = blobKeys.get(id);
      if (!blobKey) {
        throw new Error(`Unbekannter Commit ${id}`);
      }
      return new Uint8Array(await this.store.get(blobKey));
    });
  }

  async downloadIfc(commit: Commit): Promise<Buffer> {
    return this.store.get(commit.blobKey);
  }
}
