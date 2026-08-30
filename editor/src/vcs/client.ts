/**
 * HTTP-Client für die IFC-Ablage (server/, Fastify auf Port 8787).
 *
 * Auth ist ein einfaches JWT-Bearer-Token (kein Refresh-Tanz wie beim
 * MKP-Portal). Der Server erlaubt CORS, deshalb reicht im Browser-Dev
 * window.fetch; im gepackten Tauri-Build läuft der Request über das
 * Tauri-HTTP-Plugin (WebView-CORS wird umgangen; der Host braucht einen
 * Eintrag in src-tauri/capabilities/default.json).
 */

import type {
  VcsAction,
  VcsActionRun,
  VcsAuth,
  VcsBranch,
  VcsCommit,
  VcsDiffSummary,
  VcsHealth,
  VcsIssue,
  VcsIssueInput,
  VcsModel,
  VcsProject,
  VcsSettings,
  VcsUser,
} from "./types";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** fetch-Ersatz: Tauri-HTTP-Plugin unter Tauri, sonst window.fetch. */
async function vcsFetch(url: string, init?: RequestInit): Promise<Response> {
  if (isTauri()) {
    const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
    return tauriFetch(url, init);
  }
  return fetch(url, init);
}

export class VcsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "VcsApiError";
  }
}

export class VcsApiClient {
  constructor(
    private readonly settings: VcsSettings,
    private readonly auth: VcsAuth | null,
  ) {}

  private url(path: string): string {
    return `${this.settings.baseUrl.replace(/\/+$/, "")}/api${path}`;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { ...extra };
    if (this.auth) {
      headers.authorization = `Bearer ${this.auth.token}`;
    }
    return headers;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await vcsFetch(this.url(path), init);
    } catch (error) {
      throw new VcsApiError(
        `Server nicht erreichbar (${this.settings.baseUrl}): ${
          error instanceof Error ? error.message : String(error)
        }`,
        0,
      );
    }
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const body = (await response.json()) as { error?: string };
        if (body?.error) {
          detail = body.error;
        }
      } catch {
        // Nicht-JSON-Fehlerantwort: Statuscode reicht.
      }
      throw new VcsApiError(detail, response.status);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  private json<T>(path: string, method: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method,
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify(body),
    });
  }

  // ---- Health + Auth ---------------------------------------------------

  health(): Promise<VcsHealth> {
    return this.request<VcsHealth>("/health");
  }

  async login(email: string, password: string): Promise<VcsAuth> {
    return this.json<{ token: string; user: VcsUser }>("/auth/login", "POST", {
      email,
      password,
    });
  }

  async register(
    email: string,
    name: string,
    password: string,
  ): Promise<VcsAuth> {
    return this.json<{ token: string; user: VcsUser }>(
      "/auth/register",
      "POST",
      { email, name, password },
    );
  }

  // ---- Projekte + Modelle ----------------------------------------------

  async listProjects(): Promise<VcsProject[]> {
    const body = await this.request<{ projects: VcsProject[] }>("/projects", {
      headers: this.headers(),
    });
    return body.projects;
  }

  async createProject(name: string): Promise<VcsProject> {
    const body = await this.json<{ project: VcsProject }>(
      "/projects",
      "POST",
      { name },
    );
    return body.project;
  }

  async listModels(project: string): Promise<VcsModel[]> {
    const body = await this.request<{ models: VcsModel[] }>(
      `/projects/${encodeURIComponent(project)}/models`,
      { headers: this.headers() },
    );
    return body.models;
  }

  async createModel(
    project: string,
    name: string,
    visibility: "private" | "public" = "private",
  ): Promise<VcsModel> {
    const body = await this.json<{ model: VcsModel }>(
      `/projects/${encodeURIComponent(project)}/models`,
      "POST",
      { name, visibility },
    );
    return body.model;
  }

  async getModel(
    project: string,
    model: string,
  ): Promise<{ model: VcsModel; branches: VcsBranch[] }> {
    return this.request(
      `/projects/${encodeURIComponent(project)}/models/${encodeURIComponent(model)}`,
      { headers: this.headers() },
    );
  }

  // ---- Commits ---------------------------------------------------------

  async listCommits(
    project: string,
    model: string,
    branch?: string,
  ): Promise<VcsCommit[]> {
    const query = branch ? `?branch=${encodeURIComponent(branch)}` : "";
    const body = await this.request<{ commits: VcsCommit[] }>(
      `/projects/${encodeURIComponent(project)}/models/${encodeURIComponent(model)}/commits${query}`,
      { headers: this.headers() },
    );
    return body.commits;
  }

  /** Lädt den IFC-Text eines Commits (byte-identisch zum Upload). */
  async downloadCommitText(
    project: string,
    model: string,
    commitId: string,
  ): Promise<string> {
    const response = await vcsFetch(
      this.url(
        `/projects/${encodeURIComponent(project)}/models/${encodeURIComponent(model)}/commits/${encodeURIComponent(commitId)}/file`,
      ),
      { headers: this.headers() },
    );
    if (!response.ok) {
      throw new VcsApiError(`Download fehlgeschlagen (HTTP ${response.status})`, response.status);
    }
    return response.text();
  }

  /** Committet einen IFC-Stand mit Nachricht auf einen Branch. */
  async createCommit(
    project: string,
    model: string,
    input: { branch: string; message: string; ifcText: string },
  ): Promise<{ commit: VcsCommit; diff: VcsDiffSummary }> {
    const query = `?branch=${encodeURIComponent(input.branch)}&message=${encodeURIComponent(input.message)}`;
    return this.request(
      `/projects/${encodeURIComponent(project)}/models/${encodeURIComponent(model)}/commits${query}`,
      {
        method: "POST",
        headers: this.headers({ "content-type": "application/x-step" }),
        body: input.ifcText,
      },
    );
  }

  // ---- Actions (Prüfungen) + Runs --------------------------------------

  async listActions(project: string): Promise<VcsAction[]> {
    const body = await this.request<{ actions: VcsAction[] }>(
      `/projects/${encodeURIComponent(project)}/actions`,
      { headers: this.headers() },
    );
    return body.actions;
  }

  /** Startet Prüf-Runs für einen Commit (Default: alle Actions). */
  async validateCommit(
    project: string,
    model: string,
    commitId: string,
    actionIds?: string[],
  ): Promise<VcsActionRun[]> {
    const body = await this.json<{ runs: VcsActionRun[] }>(
      `/projects/${encodeURIComponent(project)}/models/${encodeURIComponent(model)}/commits/${encodeURIComponent(commitId)}/validate`,
      "POST",
      actionIds ? { actionIds } : {},
    );
    return body.runs;
  }

  async listRuns(
    project: string,
    filter: { commit?: string; model?: string } = {},
  ): Promise<VcsActionRun[]> {
    const params = new URLSearchParams();
    if (filter.commit) params.set("commit", filter.commit);
    if (filter.model) params.set("model", filter.model);
    const encoded = params.toString();
    const query = encoded ? `?${encoded}` : "";
    const body = await this.request<{ runs: VcsActionRun[] }>(
      `/projects/${encodeURIComponent(project)}/runs${query}`,
      { headers: this.headers() },
    );
    return body.runs;
  }

  /** Run-Detail inklusive Protokoll. */
  async getRun(project: string, runId: string): Promise<VcsActionRun> {
    const body = await this.request<{ run: VcsActionRun }>(
      `/projects/${encodeURIComponent(project)}/runs/${encodeURIComponent(runId)}`,
      { headers: this.headers() },
    );
    return body.run;
  }

  // ---- Issues ----------------------------------------------------------

  async listIssues(project: string): Promise<VcsIssue[]> {
    const body = await this.request<{ issues: VcsIssue[] }>(
      `/projects/${encodeURIComponent(project)}/issues`,
      { headers: this.headers() },
    );
    return body.issues;
  }

  async createIssue(project: string, input: VcsIssueInput): Promise<VcsIssue> {
    const body = await this.json<{ issue: VcsIssue }>(
      `/projects/${encodeURIComponent(project)}/issues`,
      "POST",
      input,
    );
    return body.issue;
  }
}
