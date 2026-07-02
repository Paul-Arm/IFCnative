import { randomUUID } from "node:crypto";

import type {
  GuidDiffSummary,
  VersionManifestEntry,
} from "../../../src/ifc/versioning/entityDiffByGuid";
import type {
  Branch,
  Commit,
  Member,
  Model,
  Project,
  Repository,
  User,
} from "./types";

interface EntityObject {
  type: string;
  name: string;
  payload: string;
}

/**
 * In-memory Repository for local dev and tests. Not persistent — production
 * should provide a Postgres / Azure SQL implementation of `Repository`.
 */
export class MemoryRepository implements Repository {
  private users = new Map<string, User>();
  private projects = new Map<string, Project>();
  private members: Member[] = [];
  private models = new Map<string, Model>();
  private branches = new Map<string, Branch>();
  private commits = new Map<string, Commit>();
  /** content-addressable entity payloads, deduped across all commits. */
  private entityObjects = new Map<string, EntityObject>();
  /** per-commit manifest: ordered (globalId, entityHash) references. */
  private commitEntities = new Map<string, { globalId: string; hash: string }[]>();
  private diffCache = new Map<string, GuidDiffSummary>();

  private now(): string {
    // Tests need determinism-free timestamps; ISO string is fine here.
    return new Date().toISOString();
  }

  async createUser(input: Omit<User, "id" | "createdAt">): Promise<User> {
    const user: User = { ...input, id: randomUUID(), createdAt: this.now() };
    this.users.set(user.id, user);
    return user;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const lower = email.toLowerCase();
    for (const user of this.users.values()) {
      if (user.email.toLowerCase() === lower) {
        return user;
      }
    }
    return null;
  }

  async getUserById(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async createProject(
    input: Omit<Project, "id" | "createdAt">,
  ): Promise<Project> {
    const project: Project = {
      ...input,
      id: randomUUID(),
      createdAt: this.now(),
    };
    this.projects.set(project.id, project);
    return project;
  }

  async getProjectBySlug(slug: string): Promise<Project | null> {
    for (const project of this.projects.values()) {
      if (project.slug === slug) {
        return project;
      }
    }
    return null;
  }

  async listProjectsForUser(userId: string): Promise<Project[]> {
    const ids = new Set(
      this.members.filter((m) => m.userId === userId).map((m) => m.projectId),
    );
    return [...this.projects.values()].filter((p) => ids.has(p.id));
  }

  async addMember(member: Member): Promise<Member> {
    const existing = this.members.find(
      (m) => m.projectId === member.projectId && m.userId === member.userId,
    );
    if (existing) {
      existing.role = member.role;
      return existing;
    }
    this.members.push(member);
    return member;
  }

  async getMember(projectId: string, userId: string): Promise<Member | null> {
    return (
      this.members.find(
        (m) => m.projectId === projectId && m.userId === userId,
      ) ?? null
    );
  }

  async listMembers(projectId: string): Promise<Member[]> {
    return this.members.filter((m) => m.projectId === projectId);
  }

  async createModel(input: Omit<Model, "id" | "createdAt">): Promise<Model> {
    const model: Model = { ...input, id: randomUUID(), createdAt: this.now() };
    this.models.set(model.id, model);
    return model;
  }

  async getModel(projectId: string, slug: string): Promise<Model | null> {
    for (const model of this.models.values()) {
      if (model.projectId === projectId && model.slug === slug) {
        return model;
      }
    }
    return null;
  }

  async listModels(projectId: string): Promise<Model[]> {
    return [...this.models.values()].filter((m) => m.projectId === projectId);
  }

  async createBranch(input: Omit<Branch, "id">): Promise<Branch> {
    const branch: Branch = { ...input, id: randomUUID() };
    this.branches.set(branch.id, branch);
    return branch;
  }

  async getBranch(modelId: string, name: string): Promise<Branch | null> {
    for (const branch of this.branches.values()) {
      if (branch.modelId === modelId && branch.name === name) {
        return branch;
      }
    }
    return null;
  }

  async listBranches(modelId: string): Promise<Branch[]> {
    return [...this.branches.values()].filter((b) => b.modelId === modelId);
  }

  async setBranchHead(branchId: string, headCommitId: string): Promise<void> {
    const branch = this.branches.get(branchId);
    if (branch) {
      branch.headCommitId = headCommitId;
    }
  }

  async createCommit(commit: Commit): Promise<Commit> {
    this.commits.set(commit.id, commit);
    return commit;
  }

  async getCommit(id: string): Promise<Commit | null> {
    return this.commits.get(id) ?? null;
  }

  async listCommits(modelId: string, branchName?: string): Promise<Commit[]> {
    return [...this.commits.values()]
      .filter(
        (c) =>
          c.modelId === modelId &&
          (branchName === undefined || c.branchName === branchName),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async saveManifest(
    commitId: string,
    entries: VersionManifestEntry[],
  ): Promise<void> {
    const refs: { globalId: string; hash: string }[] = [];
    for (const entry of entries) {
      if (!this.entityObjects.has(entry.hash)) {
        this.entityObjects.set(entry.hash, {
          type: entry.type,
          name: entry.name,
          payload: entry.payload ?? "",
        });
      }
      refs.push({ globalId: entry.globalId, hash: entry.hash });
    }
    this.commitEntities.set(commitId, refs);
  }

  async getManifest(commitId: string): Promise<VersionManifestEntry[]> {
    const refs = this.commitEntities.get(commitId) ?? [];
    return refs.map((ref) => {
      const object = this.entityObjects.get(ref.hash);
      return {
        globalId: ref.globalId,
        hash: ref.hash,
        type: object?.type ?? "",
        name: object?.name ?? "",
      };
    });
  }

  async getCachedDiff(
    fromCommitId: string,
    toCommitId: string,
  ): Promise<GuidDiffSummary | null> {
    return this.diffCache.get(`${fromCommitId}->${toCommitId}`) ?? null;
  }

  async saveCachedDiff(
    fromCommitId: string,
    toCommitId: string,
    summary: GuidDiffSummary,
  ): Promise<void> {
    this.diffCache.set(`${fromCommitId}->${toCommitId}`, summary);
  }
}
