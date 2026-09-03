import {
  CircleAlert,
  CloudUpload,
  Crosshair,
  FolderDown,
  Loader2,
  LogIn,
  LogOut,
  RefreshCw,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { VcsApiClient, VcsApiError } from "@/vcs/client";
import { vcsActionAppliesTo } from "@/vcs/types";
import type {
  VcsAction,
  VcsActionRun,
  VcsAuth,
  VcsCommit,
  VcsDiffSummary,
  VcsDocumentOrigin,
  VcsIssue,
  VcsModel,
  VcsRunStatus,
  VcsSettings,
} from "@/vcs/types";

import {
  Badge,
  Button,
  EmptyState,
  InlineAlert,
  LabeledInput,
  PanelHeader,
  PanelShell,
  SegmentedControl,
  Toolbar,
  ToolbarGroup,
} from "./ui";

export interface VcsPanelProps {
  /** Ob gerade ein Dokument im Editor offen ist (Voraussetzung fürs Committen). */
  hasDocument: boolean;
  documentFileName: string | null;
  /**
   * Hub-Herkunft des aktiven Dokuments. Sie bestimmt Projekt, Modell und
   * Branch — das Panel bietet bewusst KEINE eigene Auswahl an, sonst könnte
   * der Kontext vom offenen Dokument abweichen. Ohne Herkunft (lokale Datei)
   * zeigt das Panel nur den Einstieg zum Laden.
   */
  origin: VcsDocumentOrigin | null;
  /** Öffnet den Dialog „IFC vom Hub hinzufügen“. */
  onAddFromHub?: () => void;
  settings: VcsSettings;
  /** Öffnet die zentralen Einstellungen im Abschnitt „IFC Hub“. */
  onOpenSettings: () => void;
  auth: VcsAuth | null;
  onAuthChange: (auth: VcsAuth | null) => void;
  /** Serialisiert den aktuellen Editor-Stand als IFC-Text (Export-Regel). */
  getIfcText: () => string;
  /**
   * Lädt IFC-Text als neuen Dokument-Tab in den Editor. Die Hub-Herkunft
   * macht das Dokument beim Speichern direkt committbar.
   */
  onLoadIfc: (
    text: string,
    fileName: string,
    origin?: VcsDocumentOrigin,
  ) => Promise<void>;
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

/** Reiter des Panels unterhalb der Commit-Box. */
type PanelTab = "history" | "checks" | "issues";

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
  origin,
  onAddFromHub,
  settings,
  onOpenSettings,
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
  const [tab, setTab] = useState<PanelTab>("history");

  // Anmeldung und Server-URL liegen zentral in den Einstellungen; das Panel
  // verlinkt nur dorthin (siehe settingsButton weiter unten).

  // ---- Kontext aus der Hub-Herkunft des Dokuments -----------------------
  //
  // Projekt, Modell und Branch sind durch das geöffnete Dokument festgelegt;
  // das Panel liest sie nur aus (keine Auswahl, siehe VcsPanelProps.origin).

  const projectSlug = origin?.projectSlug ?? "";
  const modelSlug = origin?.modelSlug ?? "";
  const branch = origin?.branch ?? "";

  const [selectedModel, setSelectedModel] = useState<VcsModel | null>(null);
  const [commits, setCommits] = useState<VcsCommit[]>([]);
  const [loading, setLoading] = useState(false);

  const refreshCommits = useCallback(async () => {
    if (!auth || !projectSlug || !modelSlug || !branch) {
      setSelectedModel(null);
      setCommits([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // getModel liefert die Modell-Id, die für Runs und den Geltungsbereich
      // der Actions gebraucht wird.
      const detail = await client.getModel(projectSlug, modelSlug);
      setSelectedModel(detail.model);
      setCommits(await client.listCommits(projectSlug, modelSlug, branch));
    } catch (commitError) {
      if (commitError instanceof VcsApiError && commitError.status === 401) {
        onAuthChange(null);
      }
      setError(errorMessage(commitError));
    } finally {
      setLoading(false);
    }
  }, [auth, client, projectSlug, modelSlug, branch, onAuthChange]);

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
      setRuns(
        selectedModel
          ? await client.listRuns(projectSlug, { model: selectedModel.id })
          : [],
      );
    } catch {
      // Prüfungen/Issues sind Zusatzinfo — Fehler nicht in den Vordergrund.
    }
  }, [auth, client, projectSlug, selectedModel]);

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
      const modelName = selectedModel?.name ?? origin?.modelName ?? modelSlug;
      const fileName = `${modelName}-${commit.id.slice(0, 8)}.ifc`;
      await onLoadIfc(text, fileName, {
        branch: commit.branchName || branch,
        commitId: commit.id,
        modelName,
        modelSlug,
        projectName: origin?.projectName ?? projectSlug,
        projectSlug,
      });
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

  /**
   * Server-URL und Anmeldung liegen zentral in den Einstellungen; das Panel
   * zeigt den Stand nur an und verlinkt dorthin.
   */
  const settingsButton = (
    <Button
      title={`Verbindung und Anmeldung in den Einstellungen (${settings.baseUrl})`}
      onClick={onOpenSettings}
    >
      <Settings aria-hidden className="size-3.5" />
      Einstellungen
    </Button>
  );

  if (!auth) {
    return (
      <PanelShell scroll>
        <PanelHeader
          title="IFC Hub"
          eyebrow="Server"
          description="Zentrale Ablage mit Projekten, Versionsständen und Commits."
          meta={
            <span className="truncate text-[11px] text-muted-foreground">
              {settings.baseUrl}
            </span>
          }
          actions={settingsButton}
        />
        {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
        <EmptyState
          title="Nicht am IFC Hub angemeldet"
          description="Anmeldung, Registrierung und Server-URL stehen zentral in den Einstellungen unter „IFC Hub“."
          action={
            <Button variant="default" onClick={onOpenSettings}>
              <LogIn aria-hidden className="size-3.5" />
              Anmelden…
            </Button>
          }
        />
      </PanelShell>
    );
  }

  const header = (
    <PanelHeader
      title="IFC Hub"
      eyebrow="Server"
      description="Zentrale Ablage mit Projekten, Versionsständen und Commits."
      meta={<Badge tone="info">{auth.user.name}</Badge>}
      actions={
        <>
          {settingsButton}
          <Button
            title="Abmelden"
            onClick={() => {
              onAuthChange(null);
              setCommits([]);
            }}
          >
            <LogOut aria-hidden className="size-3.5" />
            Abmelden
          </Button>
        </>
      }
    />
  );

  // Ohne Hub-Herkunft fehlt der Bezug zu Projekt/Modell/Branch — das Panel
  // bietet dann nur den Einstieg an, statt eine Auswahl aufzumachen.
  if (!origin) {
    return (
      <PanelShell scroll>
        {header}
        {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
        <EmptyState
          title="Das aktive Dokument stammt nicht aus dem Hub"
          description="Projekt, Modell und Branch ergeben sich aus dem geöffneten Dokument. Lade einen Stand aus dem Hub, um Historie, Prüfungen und Issues dazu zu sehen."
          action={
            onAddFromHub ? (
              <Button variant="default" onClick={onAddFromHub}>
                <FolderDown aria-hidden className="size-3.5" />
                Vom IFC Hub laden…
              </Button>
            ) : null
          }
        />
      </PanelShell>
    );
  }

  return (
    <PanelShell scroll>
      {header}

      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      {notice ? <InlineAlert tone="info">{notice}</InlineAlert> : null}

      {/* Kontext des aktiven Dokuments — nur Anzeige, keine Auswahl. */}
      <Toolbar>
        <ToolbarGroup>
          <span className="min-w-0 truncate text-xs font-medium text-foreground">
            {origin.projectName} / {origin.modelName}
          </span>
          <Badge tone="neutral">{origin.branch}</Badge>
        </ToolbarGroup>
        <ToolbarGroup>
          <Button
            disabled={loading}
            title="Commits, Prüfungen und Issues neu laden"
            onClick={() => {
              void refreshCommits();
              void refreshChecksAndIssues();
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

      {/* ---- Historie / Prüfungen / Issues als Tabs -------------------- */}
      <SegmentedControl
        options={[
          {
            label: commits.length ? `Historie (${commits.length})` : "Historie",
            value: "history",
          },
          {
            label: headRuns.length ? `Prüfungen (${headRuns.length})` : "Prüfungen",
            value: "checks",
          },
          {
            label: modelIssues.length ? `Issues (${modelIssues.length})` : "Issues",
            value: "issues",
          },
        ]}
        value={tab}
        onChange={(next) => setTab(next as PanelTab)}
      />

      {tab === "checks" ? (
        <div className="grid gap-2">
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
        </div>
      ) : null}

      {tab === "issues" ? (
        <div className="grid gap-2">
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
        </div>
      ) : null}

      {tab === "history" ? (
        commits.length ? (
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
            title={`Noch keine Commits auf „${origin.branch}“.`}
            description="Committe den aktuellen Stand oben, um die Historie zu starten."
          />
        )
      ) : null}
    </PanelShell>
  );
}
