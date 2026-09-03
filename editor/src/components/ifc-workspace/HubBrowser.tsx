/**
 * IFC-Hub-Browser: Health-Check, Login, Projektübersicht als Karten und ein
 * Datei-Browser mit Ordnerstruktur wie in der Server-UI. Wird auf der
 * Startseite und im "IFC vom Hub hinzufügen"-Dialog verwendet.
 */

import {
  ArrowLeft,
  Box,
  ChevronRight,
  CloudOff,
  CornerLeftUp,
  Folder,
  FolderDown,
  FolderOpen,
  Loader2,
  LogOut,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { VcsApiClient, VcsApiError } from "@/vcs/client";
import type {
  VcsAuth,
  VcsDocumentOrigin,
  VcsModel,
  VcsProject,
  VcsSettings,
} from "@/vcs/types";

import { HubAuthForm } from "./HubAuthForm";
import { Badge, Button, InlineAlert, LabeledInput } from "./ui";

/** Ein vom Hub geladener IFC-Stand, den der Editor als Tab öffnet. */
export interface HubDocument {
  text: string;
  fileName: string;
  origin: VcsDocumentOrigin;
}

export interface HubBrowserProps {
  settings: VcsSettings;
  onSettingsChange: (settings: VcsSettings) => void;
  auth: VcsAuth | null;
  onAuthChange: (auth: VcsAuth | null) => void;
  /** Zusätzliche externe Sperre (z. B. während eine Datei parst). */
  busy?: boolean;
  /** Übergibt die heruntergeladenen Stände an den Editor. */
  onOpenHubDocuments: (documents: HubDocument[]) => Promise<void>;
}

function errorMessage(error: unknown): string {
  if (error instanceof VcsApiError) {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

function ifcFileName(name: string): string {
  return /\.ifc$/i.test(name) ? name : `${name}.ifc`;
}

export function HubBrowser({
  settings,
  onSettingsChange,
  auth,
  onAuthChange,
  busy: externalBusy = false,
  onOpenHubDocuments,
}: HubBrowserProps) {
  const client = useMemo(
    () => new VcsApiClient(settings, auth),
    [settings, auth],
  );

  // ---- Hub-Erreichbarkeit ------------------------------------------------
  //
  // null = Prüfung läuft; false = Server (oder Internet) nicht erreichbar.
  const [hubReachable, setHubReachable] = useState<boolean | null>(null);
  const [healthNonce, setHealthNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setHubReachable(null);
    client
      .health()
      .then(() => {
        if (!cancelled) setHubReachable(true);
      })
      .catch(() => {
        if (!cancelled) setHubReachable(false);
      });
    return () => {
      cancelled = true;
    };
    // healthNonce: manueller "Erneut prüfen"-Klick.
  }, [client, healthNonce]);

  // Anmeldung/Registrierung samt gemerkter Zugangsdaten: HubAuthForm.
  const [error, setError] = useState<string | null>(null);

  // ---- Projekte + Modelle ------------------------------------------------

  const [projects, setProjects] = useState<VcsProject[]>([]);
  /** Slug des gewählten Projekts ("" = Projektübersicht). */
  const [projectSlug, setProjectSlug] = useState("");
  /** Aktueller Ordnerpfad im Projekt ("" = Projektwurzel). */
  const [currentPath, setCurrentPath] = useState("");
  const [models, setModels] = useState<VcsModel[]>([]);
  /** Explizit angelegte Ordner (auch leere) aus den Projektdetails. */
  const [projectFolders, setProjectFolders] = useState<string[]>([]);
  const [listBusy, setListBusy] = useState(false);
  /** Slug des Modells bzw. "folder:<pfad>" des Ordners, der gerade lädt. */
  const [downloadKey, setDownloadKey] = useState<string | null>(null);

  const refreshProjects = useCallback(async () => {
    if (!auth || !hubReachable) {
      setProjects([]);
      return;
    }
    setListBusy(true);
    setError(null);
    try {
      const list = await client.listProjects();
      setProjects(list);
      // Verschwundenes Projekt: zurück zur Übersicht statt Auto-Auswahl.
      setProjectSlug((current) =>
        list.some((project) => project.slug === current) ? current : "",
      );
    } catch (listError) {
      if (listError instanceof VcsApiError && listError.status === 401) {
        onAuthChange(null);
      }
      setError(errorMessage(listError));
    } finally {
      setListBusy(false);
    }
  }, [auth, client, hubReachable, onAuthChange]);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  useEffect(() => {
    if (!auth || !hubReachable || !projectSlug) {
      setModels([]);
      setProjectFolders([]);
      return;
    }
    let cancelled = false;
    void Promise.all([
      client.listModels(projectSlug),
      client.listFolders(projectSlug).catch(() => []),
    ])
      .then(([all, folderPaths]) => {
        if (cancelled) return;
        // Markdown-Dokumente sind Hub-only; im Editor zählen nur IFC-Modelle.
        setModels(all.filter((model) => model.kind === "ifc"));
        setProjectFolders(folderPaths);
      })
      .catch((listError) => {
        if (!cancelled) setError(errorMessage(listError));
      });
    return () => {
      cancelled = true;
    };
  }, [auth, client, hubReachable, projectSlug]);

  const selectedProject =
    projects.find((project) => project.slug === projectSlug) ?? null;

  const openProject = (slug: string) => {
    setError(null);
    setProjectSlug(slug);
    setCurrentPath("");
  };

  /**
   * Direkte Unterordner des aktuellen Pfads — wie der Datei-Browser der
   * Server-UI: explizit angelegte Ordner plus die aus Modellpfaden
   * abgeleiteten, jeweils mit Modellanzahl des gesamten Teilbaums.
   */
  const childFolders = useMemo(() => {
    const prefix = currentPath ? `${currentPath}/` : "";
    const names = new Set<string>();
    for (const path of projectFolders) {
      if (path.startsWith(prefix) && path !== currentPath) {
        names.add(path.slice(prefix.length).split("/")[0]);
      }
    }
    for (const model of models) {
      const folder = model.folder || "";
      if (folder.startsWith(prefix) && folder !== currentPath) {
        names.add(folder.slice(prefix.length).split("/")[0]);
      }
    }
    return [...names]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
      .map((name) => {
        const path = `${prefix}${name}`;
        const subtree = models.filter(
          (model) =>
            (model.folder || "") === path ||
            (model.folder || "").startsWith(`${path}/`),
        );
        return { name, path, models: subtree };
      });
  }, [currentPath, models, projectFolders]);

  /** Modelle direkt im aktuellen Ordner. */
  const modelsInPath = useMemo(
    () =>
      models
        .filter((model) => (model.folder || "") === currentPath)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [currentPath, models],
  );

  /** Brotkrumen: Projektname + Pfadsegmente, jeweils klickbar. */
  const breadcrumbs = useMemo(() => {
    const crumbs: { label: string; path: string }[] = [
      { label: selectedProject?.name ?? projectSlug, path: "" },
    ];
    let acc = "";
    for (const segment of currentPath.split("/").filter(Boolean)) {
      acc = acc ? `${acc}/${segment}` : segment;
      crumbs.push({ label: segment, path: acc });
    }
    return crumbs;
  }, [currentPath, projectSlug, selectedProject]);

  /** Head-Commits der Modelle herunterladen und an den Editor übergeben. */
  const loadHubModels = async (list: VcsModel[], busyKey: string) => {
    const withHead = list.filter((model) => model.head);
    if (!withHead.length) {
      setError("Noch keine Commits — es gibt keinen Stand zum Laden.");
      return;
    }
    setError(null);
    setDownloadKey(busyKey);
    try {
      const documents: HubDocument[] = [];
      for (const model of withHead) {
        const head = model.head as NonNullable<VcsModel["head"]>;
        const text = await client.downloadCommitText(
          projectSlug,
          model.slug,
          head.id,
        );
        documents.push({
          fileName: ifcFileName(model.name),
          origin: {
            branch: model.defaultBranch,
            commitId: head.id,
            modelName: model.name,
            modelSlug: model.slug,
            projectName: selectedProject?.name ?? projectSlug,
            projectSlug,
          },
          text,
        });
      }
      await onOpenHubDocuments(documents);
    } catch (downloadError) {
      setError(errorMessage(downloadError));
    } finally {
      setDownloadKey(null);
    }
  };

  const busy = externalBusy || downloadKey !== null;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-base font-semibold text-foreground">
            IFC Hub
          </div>
          <div className="text-xs text-muted-foreground">
            {settings.baseUrl}
          </div>
        </div>
        {auth && hubReachable ? (
          <div className="flex items-center gap-2">
            <Badge tone="info">{auth.user.name}</Badge>
            <Button
              title="Abmelden"
              onClick={() => {
                onAuthChange(null);
                setProjects([]);
                setModels([]);
              }}
            >
              <LogOut aria-hidden className="size-3.5" />
            </Button>
          </div>
        ) : null}
      </div>

      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}

      {hubReachable === null ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 aria-hidden className="size-4 animate-spin" />
          Prüfe Server-Verbindung…
        </div>
      ) : hubReachable === false ? (
        <div className="grid gap-3 py-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CloudOff aria-hidden className="size-4" />
            IFC Hub nicht erreichbar — offline weiterarbeiten oder Server-URL
            prüfen.
          </div>
          <LabeledInput
            label="Server-URL"
            mono
            value={settings.baseUrl}
            onChangeText={(baseUrl) =>
              onSettingsChange({ ...settings, baseUrl })
            }
          />
          <div>
            <Button onClick={() => setHealthNonce((n) => n + 1)}>
              <RefreshCw aria-hidden className="size-3.5" />
              Erneut prüfen
            </Button>
          </div>
        </div>
      ) : !auth ? (
        <HubAuthForm
          auth={auth}
          busy={externalBusy}
          settings={settings}
          onAuthChange={onAuthChange}
        />
      ) : !projectSlug ? (
        /* ---- Projektübersicht: klickbare Karten statt Dropdown ---------- */
        <>
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-medium text-muted-foreground">
              {projects.length} {projects.length === 1 ? "Projekt" : "Projekte"}
            </div>
            <Button
              disabled={listBusy}
              title="Projekte neu laden"
              onClick={() => void refreshProjects()}
            >
              <RefreshCw
                aria-hidden
                className={listBusy ? "size-3.5 animate-spin" : "size-3.5"}
              />
            </Button>
          </div>

          {projects.length ? (
            <ul className="grid max-h-96 min-w-0 gap-1.5 overflow-x-hidden overflow-y-auto pr-1 sm:grid-cols-2">
              {projects.map((project) => (
                <li key={project.id} className="min-w-0">
                  <button
                    className="flex w-full min-w-0 items-center gap-3 rounded-lg border border-border/60 bg-background px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
                    type="button"
                    onClick={() => openProject(project.slug)}
                  >
                    <FolderOpen
                      aria-hidden
                      className="size-4 shrink-0 text-muted-foreground/70"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-foreground">
                        {project.name}
                      </span>
                      <span className="block truncate text-[0.7rem] text-muted-foreground">
                        {project.slug}
                        {project.modelCount != null
                          ? ` · ${project.modelCount} ${
                              project.modelCount === 1 ? "Modell" : "Modelle"
                            }`
                          : ""}
                      </span>
                    </span>
                    <ChevronRight
                      aria-hidden
                      className="size-4 shrink-0 text-muted-foreground/50"
                    />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-2 text-xs text-muted-foreground">
              Noch keine Projekte auf dem Server — Projekte werden in der
              Web-Oberfläche angelegt.
            </p>
          )}
        </>
      ) : (
        /* ---- Datei-Browser wie in der Server-UI ------------------------- */
        <>
          <div className="flex min-w-0 items-center gap-1 text-sm">
            <Button
              title="Zurück zur Projektübersicht"
              onClick={() => setProjectSlug("")}
            >
              <ArrowLeft aria-hidden className="size-3.5" />
            </Button>
            <nav className="flex min-w-0 flex-1 flex-wrap items-center gap-1 px-1">
              {breadcrumbs.map((crumb, index) => (
                <span
                  key={crumb.path || "root"}
                  className="flex min-w-0 items-center gap-1"
                >
                  {index > 0 ? (
                    <ChevronRight
                      aria-hidden
                      className="size-3.5 shrink-0 text-muted-foreground/50"
                    />
                  ) : null}
                  {index === breadcrumbs.length - 1 ? (
                    <span className="truncate font-medium text-foreground">
                      {crumb.label}
                    </span>
                  ) : (
                    <button
                      className="truncate text-muted-foreground transition-colors hover:text-foreground"
                      type="button"
                      onClick={() => setCurrentPath(crumb.path)}
                    >
                      {crumb.label}
                    </button>
                  )}
                </span>
              ))}
            </nav>
          </div>

          {childFolders.length || modelsInPath.length || currentPath ? (
            <ul className="grid max-h-96 min-w-0 content-start gap-1.5 overflow-x-hidden overflow-y-auto pr-1">
              {currentPath ? (
                <li>
                  <button
                    className="flex w-full items-center gap-3 rounded-lg border border-transparent px-3 py-1.5 text-left transition-colors hover:bg-primary/5"
                    type="button"
                    onClick={() =>
                      setCurrentPath(
                        currentPath.split("/").slice(0, -1).join("/"),
                      )
                    }
                  >
                    <CornerLeftUp
                      aria-hidden
                      className="size-4 shrink-0 text-muted-foreground/70"
                    />
                    <span className="text-sm text-muted-foreground">..</span>
                  </button>
                </li>
              ) : null}
              {childFolders.map((folder) => {
                const folderKey = `folder:${folder.path}`;
                const loadable = folder.models.filter((model) => model.head);
                return (
                  <li key={folderKey} className="min-w-0">
                    <div className="flex min-w-0 items-center gap-3 rounded-lg border border-border/60 bg-background px-3 py-2">
                      <Folder
                        aria-hidden
                        className="size-4 shrink-0 text-primary/70"
                      />
                      <button
                        className="min-w-0 flex-1 text-left"
                        type="button"
                        onClick={() => setCurrentPath(folder.path)}
                      >
                        <span className="block truncate text-sm text-foreground">
                          {folder.name}
                        </span>
                        <span className="block truncate text-[0.7rem] text-muted-foreground">
                          {folder.models.length}{" "}
                          {folder.models.length === 1 ? "Modell" : "Modelle"}
                        </span>
                      </button>
                      {loadable.length > 1 ? (
                        <Button
                          disabled={busy}
                          title={`Alle ${loadable.length} Modelle dieses Ordners als Tabs laden`}
                          onClick={() =>
                            void loadHubModels(folder.models, folderKey)
                          }
                        >
                          {downloadKey === folderKey ? (
                            <Loader2
                              aria-hidden
                              className="size-3.5 animate-spin"
                            />
                          ) : (
                            <FolderDown aria-hidden className="size-3.5" />
                          )}
                          Alle laden
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
              {modelsInPath.map((model) => (
                <li key={model.id} className="min-w-0">
                  <div className="flex min-w-0 items-center gap-3 rounded-lg border border-border/60 bg-background px-3 py-2">
                    <Box
                      aria-hidden
                      className="size-4 shrink-0 text-muted-foreground/70"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-foreground">
                        {model.name}
                      </div>
                      <div className="truncate text-[0.7rem] text-muted-foreground">
                        {model.head
                          ? `${model.head.id.slice(0, 8)} · ${
                              model.head.message || "(ohne Nachricht)"
                            } · ${model.head.entityCount.toLocaleString("de-DE")} Entitäten`
                          : "noch keine Commits"}
                      </div>
                    </div>
                    <Button
                      disabled={busy || !model.head}
                      title={
                        model.head
                          ? `Aktuellen Stand von ${model.name} laden`
                          : "Noch kein Commit vorhanden"
                      }
                      onClick={() => void loadHubModels([model], model.slug)}
                    >
                      {downloadKey === model.slug ? (
                        <Loader2
                          aria-hidden
                          className="size-3.5 animate-spin"
                        />
                      ) : (
                        <FolderDown aria-hidden className="size-3.5" />
                      )}
                      Laden
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-2 text-xs text-muted-foreground">
              Dieses Projekt enthält noch keine IFC-Modelle.
            </p>
          )}
        </>
      )}
    </div>
  );
}
