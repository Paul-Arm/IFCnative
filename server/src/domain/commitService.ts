import { randomUUID } from "node:crypto";

import { parseNativeIfcText } from "../../../src/ifc/nativeDocument";
import {
  buildVersionManifest,
  diffManifests,
  type GuidDiffSummary,
  type VersionManifest,
  type VersionManifestEntry,
} from "../../../src/ifc/versioning/entityDiffByGuid";
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
  ifcText: string;
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

  private blobKey(modelId: string, commitId: string): string {
    return `models/${modelId}/commits/${commitId}.ifc`;
  }

  async createCommit(input: CreateCommitInput): Promise<CreateCommitResult> {
    const { model, branchName, ifcText, authorId, message } = input;

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

  async downloadIfc(commit: Commit): Promise<Buffer> {
    return this.store.get(commit.blobKey);
  }
}
