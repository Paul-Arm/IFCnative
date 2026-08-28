import {
  CloudUpload,
  FolderDown,
  Loader2,
  LogIn,
  LogOut,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { VcsApiClient, VcsApiError } from "@/vcs/client";
import type {
  VcsAuth,
  VcsBranch,
  VcsCommit,
  VcsDiffSummary,
  VcsModel,
  VcsProject,
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
}

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
      .then((list) => {
        if (cancelled) return;
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
          title="IFC-Ablage"
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
        title="IFC-Ablage"
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
                label: model.name,
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
