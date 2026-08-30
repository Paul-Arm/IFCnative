import {
  CircleAlert,
  CloudUpload,
  Crosshair,
  FolderDown,
  Loader2,
  LogIn,
  LogOut,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { VcsApiClient, VcsApiError } from "@/vcs/client";
import { vcsActionAppliesTo } from "@/vcs/types";
import type {
  VcsAction,
  VcsActionRun,
  VcsAuth,
  VcsBranch,
  VcsCommit,
  VcsDiffSummary,
  VcsIssue,
  VcsModel,
  VcsProject,
  VcsRunStatus,
  VcsSettings,
} from "@/vcs/types";

import {
  Badge,
  Button,
  CollapsibleSection,
  DropdownField,
  EmptyState,
  InlineAlert,
  LabeledInput,
  PanelHeader,
  PanelShell,
  Toolbar,
  ToolbarGroup,
} from "./ui";

export interface VcsPanelProps {
  /** Ob gerade ein Dokument im Editor offen ist (Voraussetzung fürs Committen). */
  hasDocument: boolean;
  documentFileName: string | null;
  settings: VcsSettings;
  onSettingsChange: (settings: VcsSettings) => void;
  auth: VcsAuth | null;
  onAuthChange: (auth: VcsAuth | null) => void;
  /** Serialisiert den aktuellen Editor-Stand als IFC-Text (Export-Regel). */
  getIfcText: () => string;
  /** Lädt IFC-Text als neuen Dokument-Tab in den Editor. */
  onLoadIfc: (text: string, fileName: string) => Promise<void>;
  /**
   * Wählt Objekte per GlobalId im aktiven Dokument aus (Issue-Verortung);
   * gibt die Zahl der gefundenen Objekte zurück.
   */
  onSelectGuids?: (guids: string[]) => number;
}

const RUN_STATUS: Record<VcsRunStatus, { label: string; tone: "neutral" | "success" | "warning" | "danger" | "info" }> = {
  queued: { label: "Wartet", tone: "neutral" },
  running: { label: "Läuft", tone: "info" },
  success: { label: "Bestanden", tone: "success" },
  failed: { label: "Fehlgeschlagen", tone: "danger" },
  error: { label: "Fehler", tone: "warning" },
};

function errorMessage(error: unknown): string {
  if (error instanceof VcsApiError) {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("de-DE", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function VcsPanel({
  hasDocument,
  documentFileName,
  settings,
  onSettingsChange,
  auth,
  onAuthChange,
  getIfcText,
  onLoadIfc,
  onSelectGuids,
}: VcsPanelProps) {
  const client = useMemo(
    () => new VcsApiClient(settings, auth),
    [settings, auth],
  );

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // ---- Login -----------------------------------------------------------

  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);

  const handleLogin = async () => {
    setError(null);
    setAuthBusy(true);
    try {
      const nextAuth =
        authMode === "login"
          ? await client.login(email.trim(), password)
          : await client.register(email.trim(), name.trim() || email.trim(), password);
      onAuthChange(nextAuth);
      setPassword("");
    } catch (loginError) {
      setError(errorMessage(loginError));
    } finally {
      setAuthBusy(false);
    }
  };

  // ---- Katalog: Projekte -> Modelle -> Branch -> Commits ---------------

  const [projects, setProjects] = useState<VcsProject[]>([]);
  const [projectSlug, setProjectSlug] = useState("");
  const [models, setModels] = useState<VcsModel[]>([]);
  const [modelSlug, setModelSlug] = useState("");
  const [branches, setBranches] = useState<VcsBranch[]>([]);
  const [branch, setBranch] = useState("");
  const [commits, setCommits] = useState<VcsCommit[]>([]);
  const [loading, setLoading] = useState(false);

  const selectedModel = models.find((model) => model.slug === modelSlug) ?? null;

  const refreshProjects = useCallback(async () => {
    if (!auth) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await client.listProjects();
      setProjects(list);
      setProjectSlug((current) =>
        list.some((project) => project.slug === current)
          ? current
          : (list[0]?.slug ?? ""),
      );
    } catch (listError) {
      if (listError instanceof VcsApiError && listError.status === 401) {
        onAuthChange(null);
      }
      setError(errorMessage(listError));
    } finally {
      setLoading(false);
    }
  }, [auth, client, onAuthChange]);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  useEffect(() => {
    if (!auth || !projectSlug) {
      setModels([]);
      setModelSlug("");
      return;
    }
    let cancelled = false;
    void client
      .listModels(projectSlug)
      .then((all) => {
        if (cancelled) return;
        // Markdown-Dokumente sind Hub-only; im Editor zählen nur IFC-Modelle.
        const list = all.filter((model) => model.kind === "ifc");
        setModels(list);
        setModelSlug((current) =>
          list.some((model) => model.slug === current)
            ? current
            : (list[0]?.slug ?? ""),
        );
      })
      .catch((listError) => {
        if (!cancelled) setError(errorMessage(listError));
      });
    return () => {
      cancelled = true;
    };
  }, [auth, client, projectSlug]);

  const refreshCommits = useCallback(async () => {
    if (!auth || !projectSlug || !modelSlug) {
      setBranches([]);
      setCommits([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const detail = await client.getModel(projectSlug, modelSlug);
      setBranches(detail.branches);
      const effectiveBranch =
        branch && detail.branches.some((b) => b.name === branch)
          ? branch
          : detail.model.defaultBranch;
      if (effectiveBranch !== branch) {
        setBranch(effectiveBranch);
      }
      setCommits(
        await client.listCommits(projectSlug, modelSlug, effectiveBranch),
      );
    } catch (commitError) {
      setError(errorMessage(commitError));
    } finally {
      setLoading(false);
    }
  }, [auth, client, projectSlug, modelSlug, branch]);

  useEffect(() => {
    void refreshCommits();
  }, [refreshCommits]);

  // ---- Prüfungen (Actions + Runs) + Issues ------------------------------

  const [actions, setActions] = useState<VcsAction[]>([]);
  const [runs, setRuns] = useState<VcsActionRun[]>([]);
  const [issues, setIssues] = useState<VcsIssue[]>([]);
  const [validateBusy, setValidateBusy] = useState(false);
  const [issueBusyRunId, setIssueBusyRunId] = useState<string | null>(null);

  const refreshChecksAndIssues = useCallback(async () => {
    if (!auth || !projectSlug) {
      setActions([]);
      setRuns([]);
      setIssues([]);
      return;
    }
    try {
      const [actionList, issueList] = await Promise.all([
        client.listActions(projectSlug),
        client.listIssues(projectSlug),
      ]);
      setActions(actionList);
      setIssues(issueList);
      const model = models.find((entry) => entry.slug === modelSlug);
      setRuns(model ? await client.listRuns(projectSlug, { model: model.id }) : []);
    } catch {
      // Prüfungen/Issues sind Zusatzinfo — Fehler nicht in den Vordergrund.
    }
  }, [auth, client, projectSlug, modelSlug, models]);

  useEffect(() => {
    void refreshChecksAndIssues();
  }, [refreshChecksAndIssues]);

  // Solange Runs laufen, alle 3 s den Stand nachladen.
  useEffect(() => {
    if (!runs.some((run) => run.status === "queued" || run.status === "running")) {
      return;
    }
    const timer = setTimeout(() => void refreshChecksAndIssues(), 3000);
    return () => clearTimeout(timer);
  }, [runs, refreshChecksAndIssues]);

  const headCommit = commits[0] ?? null;

  const handleValidate = async () => {
    if (!headCommit || !projectSlug || !modelSlug) return;
    setError(null);
    setValidateBusy(true);
    try {
      await client.validateCommit(projectSlug, modelSlug, headCommit.id);
      await refreshChecksAndIssues();
    } catch (validateError) {
      setError(errorMessage(validateError));
    } finally {
      setValidateBusy(false);
    }
  };

  /** BCF-Issue aus einem fehlgeschlagenen Run — mit Verortung + Versionsbezug. */
  const handleIssueFromRun = async (run: VcsActionRun) => {
    setError(null);
    setNotice(null);
    setIssueBusyRunId(run.id);
    try {
      const detail = await client.getRun(projectSlug, run.id);
      const body = [
        `Die Prüfung **${run.action?.name ?? "?"}** (Run #${run.number}) ist fehlgeschlagen.`,
        "",
        `- Modell: **${run.model?.name ?? "?"}**`,
        `- Commit: \`${run.commitId.slice(0, 8)}\``,
        `- Ergebnis: ${run.summary || "siehe Protokoll"}`,
        ...(detail.log
          ? ["", "```", detail.log.length > 3000 ? `${detail.log.slice(0, 3000)}\n… (gekürzt)` : detail.log, "```"]
          : []),
      ].join("\n");
      const issue = await client.createIssue(projectSlug, {
        title: `Prüfung fehlgeschlagen: ${run.action?.name ?? "Action"}`,
        body,
        kind: "bcf",
        modelLinks: [{ modelId: run.modelId, foundCommitId: run.commitId }],
        guids: run.failedGuids,
      });
      setNotice(
        `Issue #${issue.number} angelegt (BCF, ${run.failedGuids.length} Objekte verortet).`,
      );
      await refreshChecksAndIssues();
    } catch (issueError) {
      setError(errorMessage(issueError));
    } finally {
      setIssueBusyRunId(null);
    }
  };

  const handleSelectIssueGuids = (issue: VcsIssue) => {
    if (!onSelectGuids) return;
    const found = onSelectGuids(issue.guids);
    setNotice(
      found
        ? `${found} von ${issue.guids.length} Objekten im aktiven Dokument ausgewählt.`
        : "Keines der verorteten Objekte ist im aktiven Dokument enthalten.",
    );
  };

  /** Offene Issues, die mit dem gewählten Modell verknüpft sind. */
  const modelIssues = issues.filter(
    (issue) =>
      issue.state === "open" &&
      issue.models.some((model) => model.slug === modelSlug),
  );

  /** Actions, deren Geltungsbereich das gewählte Modell abdeckt. */
  const applicableActions = selectedModel
    ? actions.filter((action) => vcsActionAppliesTo(action, selectedModel))
    : [];

  /** Runs zum aktuellen Head-Commit des gewählten Branches. */
  const headRuns = headCommit
    ? runs.filter((run) => run.commitId === headCommit.id)
    : [];

  // ---- Aktionen ---------------------------------------------------------

  const [openBusyId, setOpenBusyId] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [commitBusy, setCommitBusy] = useState(false);
  const [lastDiff, setLastDiff] = useState<VcsDiffSummary | null>(null);

  const handleOpenCommit = async (commit: VcsCommit) => {
    setError(null);
    setNotice(null);
    setOpenBusyId(commit.id);
    try {
      const text = await client.downloadCommitText(
        projectSlug,
        modelSlug,
        commit.id,
      );
      const fileName = `${selectedModel?.name ?? modelSlug}-${commit.id.slice(0, 8)}.ifc`;
      await onLoadIfc(text, fileName);
      setNotice(`${fileName} als neuer Tab geöffnet.`);
    } catch (openError) {
      setError(errorMessage(openError));
    } finally {
      setOpenBusyId(null);
    }
  };

  const handleCommit = async () => {
    if (!hasDocument || !projectSlug || !modelSlug || !branch) {
      return;
    }
    setError(null);
    setNotice(null);
    setLastDiff(null);
    setCommitBusy(true);
    try {
      const ifcText = getIfcText();
      const result = await client.createCommit(projectSlug, modelSlug, {
        branch,
        message: commitMessage.trim(),
        ifcText,
      });
      setLastDiff(result.diff);
      setCommitMessage("");
      setNotice(
        `Commit ${result.commit.id.slice(0, 8)} auf ${branch} angelegt.`,
      );
      await refreshCommits();
      // runOnCommit-Actions starten serverseitig automatisch — Stand holen.
      await refreshChecksAndIssues();
    } catch (commitError) {
      setError(errorMessage(commitError));
    } finally {
      setCommitBusy(false);
    }
  };

  // ---- Render ------------------------------------------------------------

  const connectionSection = (
    <CollapsibleSection title="Verbindung" meta={settings.baseUrl}>
      <LabeledInput
        label="Server-URL"
        mono
        value={settings.baseUrl}
        onChangeText={(baseUrl) => onSettingsChange({ ...settings, baseUrl })}
      />
      <p className="text-xs text-muted-foreground">
        Web-Oberfläche des Servers:{" "}
        <a
          className="text-primary underline-offset-2 hover:underline"
          href={settings.baseUrl}
          rel="noreferrer"
          target="_blank"
        >
          {settings.baseUrl}
        </a>
      </p>
    </CollapsibleSection>
  );

  if (!auth) {
    return (
      <PanelShell scroll>
        <PanelHeader
          title="IFC Hub"
          eyebrow="Server"
          description="Zentrale Ablage mit Projekten, Versionsständen und Commits."
        />
        {connectionSection}
        {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
        <div className="grid gap-2 rounded-lg border border-border/60 bg-card p-3">
          <div className="flex items-center gap-2">
            <Button
              variant={authMode === "login" ? "default" : "outline"}
              onClick={() => setAuthMode("login")}
            >
              Anmelden
            </Button>
            <Button
              variant={authMode === "register" ? "default" : "outline"}
              onClick={() => setAuthMode("register")}
            >
              Registrieren
            </Button>
          </div>
          <LabeledInput label="E-Mail" value={email} onChangeText={setEmail} />
          {authMode === "register" ? (
            <LabeledInput label="Name" value={name} onChangeText={setName} />
          ) : null}
          <label className="grid min-w-0 gap-1.5 text-xs text-muted-foreground">
            Passwort
            <Input
              className="text-foreground"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void handleLogin();
                }
              }}
            />
          </label>
          <div>
            <Button
              disabled={authBusy || !email.trim() || !password}
              variant="default"
              onClick={() => void handleLogin()}
            >
              {authBusy ? (
                <Loader2 aria-hidden className="size-3.5 animate-spin" />
              ) : (
                <LogIn aria-hidden className="size-3.5" />
              )}
              {authMode === "login" ? "Anmelden" : "Konto erstellen"}
            </Button>
          </div>
        </div>
      </PanelShell>
    );
  }

  return (
    <PanelShell scroll>
      <PanelHeader
        title="IFC Hub"
        eyebrow="Server"
        description="Zentrale Ablage mit Projekten, Versionsständen und Commits."
        meta={<Badge tone="info">{auth.user.name}</Badge>}
        actions={
          <Button
            title="Abmelden"
            onClick={() => {
              onAuthChange(null);
              setProjects([]);
              setCommits([]);
            }}
          >
            <LogOut aria-hidden className="size-3.5" />
            Abmelden
          </Button>
        }
      />

      {connectionSection}
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      {notice ? <InlineAlert tone="info">{notice}</InlineAlert> : null}

      <Toolbar>
        <ToolbarGroup>
          <div className="min-w-44">
            <DropdownField
              label="Projekt"
              options={projects.map((project) => ({
                value: project.slug,
                label: project.name,
                detail: project.slug,
              }))}
              value={projectSlug}
              onChange={setProjectSlug}
            />
          </div>
          <div className="min-w-44">
            <DropdownField
              label="Modell"
              options={models.map((model) => ({
                value: model.slug,
                label: model.folder ? `${model.folder}/${model.name}` : model.name,
                detail:
                  model.visibility === "public" ? "öffentlich" : "privat",
              }))}
              value={modelSlug}
              onChange={setModelSlug}
            />
          </div>
          <div className="min-w-32">
            <DropdownField
              label="Branch"
              options={branches.map((entry) => entry.name)}
              value={branch}
              onChange={setBranch}
            />
          </div>
        </ToolbarGroup>
        <ToolbarGroup>
          <Button
            disabled={loading}
            title="Neu laden"
            onClick={() => {
              void refreshProjects();
              void refreshCommits();
            }}
          >
            <RefreshCw
              aria-hidden
              className={loading ? "size-3.5 animate-spin" : "size-3.5"}
            />
            Aktualisieren
          </Button>
        </ToolbarGroup>
      </Toolbar>

      {/* ---- Commit-Box ---------------------------------------------- */}
      <div className="grid gap-2 rounded-lg border border-border/60 bg-card p-3">
        <div className="text-sm font-medium text-foreground">
          Aktuellen Stand committen
        </div>
        {hasDocument ? (
          <>
            <LabeledInput
              label={`Commit-Nachricht für „${documentFileName ?? "Dokument"}“ → ${projectSlug}/${modelSlug} (${branch})`}
              value={commitMessage}
              onChangeText={setCommitMessage}
            />
            <div>
              <Button
                disabled={commitBusy || !projectSlug || !modelSlug || !branch}
                variant="default"
                onClick={() => void handleCommit()}
              >
                {commitBusy ? (
                  <Loader2 aria-hidden className="size-3.5 animate-spin" />
                ) : (
                  <CloudUpload aria-hidden className="size-3.5" />
                )}
                Committen
              </Button>
            </div>
            {lastDiff ? (
              <InlineAlert tone={lastDiff.identical ? "warning" : "info"}>
                {lastDiff.identical
                  ? "Der Stand ist semantisch identisch mit dem Branch-Kopf (leerer Diff)."
                  : `Diff zum Vorgänger: ${lastDiff.added.length} neu, ${lastDiff.modified.length} geändert, ${lastDiff.removed.length} entfernt, ${lastDiff.unchanged} unverändert.`}
              </InlineAlert>
            ) : null}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            Kein Dokument geöffnet — erst eine IFC-Datei öffnen oder einen
            Stand aus der Liste unten laden.
          </p>
        )}
      </div>

      {/* ---- Prüfungen (Actions gegen den Head-Commit) ----------------- */}
      {modelSlug ? (
        <CollapsibleSection
          title="Prüfungen"
          meta={
            applicableActions.length
              ? `${applicableActions.length} Action(s) für dieses Modell · ${headRuns.length} Run(s) am Head`
              : "keine passenden Actions"
          }
        >
          {applicableActions.length ? (
            <>
              <div>
                <Button
                  disabled={validateBusy || !headCommit}
                  title={
                    headCommit
                      ? `Head-Commit ${headCommit.id.slice(0, 8)} mit den ${applicableActions.length} passenden Actions prüfen`
                      : "Noch kein Commit auf diesem Branch"
                  }
                  onClick={() => void handleValidate()}
                >
                  {validateBusy ? (
                    <Loader2 aria-hidden className="size-3.5 animate-spin" />
                  ) : (
                    <ShieldCheck aria-hidden className="size-3.5" />
                  )}
                  Head-Commit prüfen
                </Button>
              </div>
              {headRuns.length ? (
                <ul className="grid gap-1.5">
                  {headRuns.map((run) => (
                    <li
                      key={run.id}
                      className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-2"
                    >
                      <Badge tone={RUN_STATUS[run.status].tone}>
                        {RUN_STATUS[run.status].label}
                      </Badge>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-foreground">
                          {run.action?.name ?? "(gelöschte Action)"}
                        </div>
                        {run.summary ? (
                          <div className="truncate text-[0.7rem] text-muted-foreground">
                            {run.summary}
                          </div>
                        ) : null}
                      </div>
                      {run.status === "failed" || run.status === "error" ? (
                        <Button
                          disabled={issueBusyRunId !== null}
                          title="BCF-Issue mit Prüfbericht, Versionsbezug und verorteten Objekten anlegen"
                          onClick={() => void handleIssueFromRun(run)}
                        >
                          {issueBusyRunId === run.id ? (
                            <Loader2 aria-hidden className="size-3.5 animate-spin" />
                          ) : (
                            <CircleAlert aria-hidden className="size-3.5" />
                          )}
                          Issue erstellen
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Der Head-Commit wurde noch nicht geprüft.
                </p>
              )}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              Keine Actions mit passendem Geltungsbereich für dieses Modell —
              Actions werden in der Web-Oberfläche (Tab „Actions“ bzw.
              „Bibliothek“) verwaltet.
            </p>
          )}
        </CollapsibleSection>
      ) : null}

      {/* ---- Issues des Modells ---------------------------------------- */}
      {modelSlug ? (
        <CollapsibleSection
          title="Issues"
          meta={`${modelIssues.length} offen zu diesem Modell`}
        >
          {modelIssues.length ? (
            <ul className="grid gap-1.5">
              {modelIssues.map((issue) => (
                <li
                  key={issue.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {issue.title}
                      </span>
                      {issue.kind === "bcf" ? (
                        <Badge tone="info">BCF</Badge>
                      ) : null}
                    </div>
                    <div className="truncate text-[0.7rem] text-muted-foreground">
                      #{issue.number} · {issue.author?.name ?? "?"} ·{" "}
                      {formatDate(issue.createdAt)}
                      {issue.guids.length
                        ? ` · ${issue.guids.length} Objekte verortet`
                        : ""}
                      {issue.models
                        .filter((model) => model.slug === modelSlug)
                        .map((model) =>
                          [
                            model.foundCommit
                              ? ` · aufgefallen in ${model.foundCommit.id.slice(0, 8)}`
                              : "",
                            model.fixedCommit
                              ? ` · behoben in ${model.fixedCommit.id.slice(0, 8)}`
                              : "",
                          ].join(""),
                        )
                        .join("")}
                    </div>
                  </div>
                  {issue.guids.length && onSelectGuids ? (
                    <Button
                      disabled={!hasDocument}
                      title={
                        hasDocument
                          ? "Verortete Objekte im aktiven Dokument auswählen"
                          : "Kein Dokument geöffnet"
                      }
                      onClick={() => handleSelectIssueGuids(issue)}
                    >
                      <Crosshair aria-hidden className="size-3.5" />
                      Auswählen
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              Keine offenen Issues zu diesem Modell.
            </p>
          )}
        </CollapsibleSection>
      ) : null}

      {/* ---- Historie ------------------------------------------------- */}
      {commits.length ? (
        <ul className="grid gap-1.5">
          {commits.map((commit) => (
            <li
              key={commit.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">
                  {commit.message || "(ohne Nachricht)"}
                </div>
                <div className="truncate font-mono text-[0.7rem] text-muted-foreground">
                  {commit.id.slice(0, 8)} · {commit.author?.name ?? "?"} ·{" "}
                  {formatDate(commit.createdAt)} · {commit.entityCount}{" "}
                  Entities
                </div>
              </div>
              <span className="font-mono text-xs whitespace-nowrap">
                <span className="text-success">+{commit.added}</span>{" "}
                <span className="text-warning">~{commit.modified}</span>{" "}
                <span className="text-destructive">−{commit.removed}</span>
              </span>
              <Button
                disabled={openBusyId !== null}
                title="Diesen Stand als neuen Tab öffnen"
                onClick={() => void handleOpenCommit(commit)}
              >
                {openBusyId === commit.id ? (
                  <Loader2 aria-hidden className="size-3.5 animate-spin" />
                ) : (
                  <FolderDown aria-hidden className="size-3.5" />
                )}
                Öffnen
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title={
            projectSlug && modelSlug
              ? "Noch keine Commits auf diesem Branch."
              : projects.length
                ? "Kein Modell ausgewählt."
                : "Noch keine Projekte auf dem Server."
          }
          description="Projekte und Modelle lassen sich in der Web-Oberfläche des Servers anlegen; committet wird direkt hier aus dem Editor."
        />
      )}
    </PanelShell>
  );
}
