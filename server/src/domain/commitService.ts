import { createHash, randomUUID } from "node:crypto";

import {
  buildVersionManifest,
  diffEntityFields,
  diffManifests,
  parseNativeIfcText,
  type EntityFieldDiff,
  type GuidDiffSummary,
  type NativeIfcDocument,
  type VersionManifest,
  type VersionManifestEntry,
} from "../ifc";
import type { ObjectStore } from "../storage/objectStore";
import type { Commit, Model, Repository } from "../repository/types";

/**
 * The versioning core: turns an uploaded IFC file into a content-addressable
 * commit and computes semantic diffs between commits by GlobalId.
 *
 * - Raw IFC text -> object store (Azure Blob in prod), for perfect round-trip.
 * - Version manifest {globalId -> entityHash} -> repository, where entity
 *   payloads are deduped across commits (entity_objects).
 * - Diffs are cached in the repository (commits are immutable).
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
  /** Dateiinhalt: STEP-Text bei kind "ifc", Markdown bei kind "md". */
  text: string;
  authorId: string;
  message: string;
}

export interface CreateCommitResult {
  commit: Commit;
  /** Semantic diff against the previous head of the branch (parent commit). */
  diff: GuidDiffSummary;
}

export class CommitService {
  constructor(
    private readonly repo: Repository,
    private readonly store: ObjectStore,
  ) {}

  /**
   * Small LRU of parsed documents keyed by commit id. Commits are immutable, so
   * a parsed doc is valid forever; expanding several entities of one diff reuses
   * the same two parses instead of re-reading and re-parsing per entity.
   */
  private readonly parseCache = new Map<string, NativeIfcDocument>();
  private static readonly PARSE_CACHE_LIMIT = 8;

  private blobKey(modelId: string, commitId: string): string {
    return `models/${modelId}/commits/${commitId}.ifc`;
  }

  private async loadDocument(commit: Commit): Promise<NativeIfcDocument> {
    const cached = this.parseCache.get(commit.id);
    if (cached) {
      return cached;
    }
    const buffer = await this.store.get(commit.blobKey);
    const doc = parseNativeIfcText(buffer.toString("utf8"));
    if (this.parseCache.size >= CommitService.PARSE_CACHE_LIMIT) {
      const oldest = this.parseCache.keys().next().value;
      if (oldest !== undefined) {
        this.parseCache.delete(oldest);
      }
    }
    this.parseCache.set(commit.id, doc);
    return doc;
  }

  async createCommit(input: CreateCommitInput): Promise<CreateCommitResult> {
    if (input.model.kind === "md") {
      return this.createMarkdownCommit(input);
    }
    const { model, branchName, text: ifcText, authorId, message } = input;

    const doc = parseNativeIfcText(ifcText);
    const manifest = buildVersionManifest(doc);

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

    const commitId = randomUUID();
    const blobKey = this.blobKey(model.id, commitId);
    await this.store.put(blobKey, ifcText, "application/x-step");

    const commit: Commit = {
      id: commitId,
      modelId: model.id,
      branchName,
      parentCommitId: parentCommit?.id ?? null,
      manifestHash: manifest.manifestHash,
      blobKey,
      schema: doc.schema,
      authorId,
      message,
      createdAt: new Date().toISOString(),
      entityCount: manifest.entityCount,
      added: diff.added.length,
      removed: diff.removed.length,
      modified: diff.modified.length,
    };

    await this.repo.createCommit(commit);
    await this.repo.saveManifest(commitId, [...manifest.entries.values()]);
    await this.repo.setBranchHead(branch.id, commit.id);

    return { commit, diff };
  }

  /**
   * Markdown-Commit: kein IFC-Parsing, kein Objekt-Diff. Der sha256 des
   * Inhalts dient als manifestHash, damit die Identisch-Erkennung
   * (gleicher Stand erneut committet) genauso funktioniert wie bei IFC.
   */
  private async createMarkdownCommit(
    input: CreateCommitInput,
  ): Promise<CreateCommitResult> {
    const { model, branchName, text, authorId, message } = input;
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

    await this.repo.createCommit(commit);
    await this.repo.saveManifest(commitId, []);
    await this.repo.setBranchHead(branch.id, commit.id);

    return { commit, diff };
  }

  async getDiff(from: Commit, to: Commit): Promise<GuidDiffSummary> {
    const cached = await this.repo.getCachedDiff(from.id, to.id);
    if (cached) {
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
    return summary;
  }

  /**
   * Field-level "what changed" detail for a single GlobalId between two commits.
   * Loads (and caches) both raw IFC versions, then compares the entity's
   * attributes, placement, geometry and property/quantity sets.
   */
  async getEntityDiff(
    from: Commit,
    to: Commit,
    globalId: string,
  ): Promise<EntityFieldDiff> {
    const [beforeDoc, afterDoc] = await Promise.all([
      this.loadDocument(from),
      this.loadDocument(to),
    ]);
    return diffEntityFields(beforeDoc, afterDoc, globalId);
  }

  async downloadIfc(commit: Commit): Promise<Buffer> {
    return this.store.get(commit.blobKey);
  }
}
