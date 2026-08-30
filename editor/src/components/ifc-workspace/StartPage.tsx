/**
 * Startseite des Editors: erscheint, solange noch kein Dokument geöffnet
 * wurde. Bietet die drei Einstiege an — IFC-Datei öffnen (Picker),
 * Drag-&-Drop und (bei erreichbarem Server) das Laden einzelner Modelle
 * oder ganzer Ordner aus einem IFC-Hub-Projekt.
 */

import {
  CloudOff,
  FilePlus2,
  FileUp,
  FolderDown,
  FolderOpen,
  Loader2,
  LogIn,
  LogOut,
  RefreshCw,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type DragEvent,
} from "react";

import { Input } from "@/components/ui/input";
import { VcsApiClient, VcsApiError } from "@/vcs/client";
import type {
  VcsAuth,
  VcsDocumentOrigin,
  VcsModel,
  VcsProject,
  VcsSettings,
} from "@/vcs/types";

import { NewIfcDialog, type NewIfcDraft } from "./NewIfcDialog";
import {
  Badge,
  Button,
  DropdownField,
  InlineAlert,
  LabeledInput,
} from "./ui";

/** Ein vom Hub geladener IFC-Stand, den der Editor als Tab öffnet. */
export interface StartPageHubDocument {
  text: string;
  fileName: string;
  origin: VcsDocumentOrigin;
}

export interface StartPageProps {
  /** Name der gerade ladenden Datei (leer = nichts lädt). */
  loadingName: string;
  settings: VcsSettings;
  onSettingsChange: (settings: VcsSettings) => void;
  auth: VcsAuth | null;
  onAuthChange: (auth: VcsAuth | null) => void;
  /** Öffnet den Datei-Picker (ersetzt das leere Startdokument). */
  onOpenFilePicker: () => void;
  /** Öffnet per Drag-&-Drop übergebene IFC-Dateien. */
  onOpenDroppedFiles: (files: File[]) => void;
  /** Öffnet vom Hub geladene Stände als Dokument-Tabs. */
  onOpenHubDocuments: (documents: StartPageHubDocument[]) => Promise<void>;
  /** Erstellt eine neue IFC-Datei aus den abgefragten Startwerten. */
  onCreateNewIfc: (draft: NewIfcDraft) => void;
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

export function StartPage({
  loadingName,
  settings,
  onSettingsChange,
  auth,
  onAuthChange,
  onOpenFilePicker,
  onOpenDroppedFiles,
  onOpenHubDocuments,
  onCreateNewIfc,
}: StartPageProps) {
  const client = useMemo(
    () => new VcsApiClient(settings, auth),
    [settings, auth],
  );

  const [dragActive, setDragActive] = useState(false);
  const [newIfcOpen, setNewIfcOpen] = useState(false);

  // ---- Hub-Erreichbarkeit ------------------------------------------------
  //
  // null = Prüfung läuft; false = Server (oder Internet) nicht erreichbar.
  // Der Hub-Bereich erscheint nur bei erfolgreichem Health-Check.
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

  // ---- Login -------------------------------------------------------------

  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    setError(null);
    setAuthBusy(true);
    try {
      const nextAuth =
        authMode === "login"
          ? await client.login(email.trim(), password)
          : await client.register(
              email.trim(),
              name.trim() || email.trim(),
              password,
            );
      onAuthChange(nextAuth);
      setPassword("");
    } catch (loginError) {
      setError(errorMessage(loginError));
    } finally {
      setAuthBusy(false);
    }
  };

  // ---- Projekte + Modelle ------------------------------------------------

  const [projects, setProjects] = useState<VcsProject[]>([]);
  const [projectSlug, setProjectSlug] = useState("");
  const [models, setModels] = useState<VcsModel[]>([]);
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
      setListBusy(false);
    }
  }, [auth, client, hubReachable, onAuthChange]);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  useEffect(() => {
    if (!auth || !hubReachable || !projectSlug) {
      setModels([]);
      return;
    }
    let cancelled = false;
    void client
      .listModels(projectSlug)
      .then((all) => {
        if (cancelled) return;
        // Markdown-Dokumente sind Hub-only; im Editor zählen nur IFC-Modelle.
        setModels(all.filter((model) => model.kind === "ifc"));
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

  /** Modelle nach Ordner gruppiert ("" = Projektwurzel), Ordner sortiert. */
  const folders = useMemo(() => {
    const byFolder = new Map<string, VcsModel[]>();
    for (const model of models) {
      const key = model.folder || "";
      const entry = byFolder.get(key);
      if (entry) {
        entry.push(model);
      } else {
        byFolder.set(key, [model]);
      }
    }
    return [...byFolder.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [models]);

  /** Head-Commits der Modelle herunterladen und als Tabs öffnen. */
  const loadHubModels = async (list: VcsModel[], busyKey: string) => {
    const withHead = list.filter((model) => model.head);
    if (!withHead.length) {
      setError("Noch keine Commits — es gibt keinen Stand zum Laden.");
      return;
    }
    setError(null);
    setDownloadKey(busyKey);
    try {
      const documents: StartPageHubDocument[] = [];
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

  // ---- Drag & Drop -------------------------------------------------------

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragActive(false);
    const files = [...(event.dataTransfer?.files ?? [])].filter((file) =>
      /\.ifc$/i.test(file.name),
    );
    if (files.length) {
      onOpenDroppedFiles(files);
    }
  };

  // ---- Render ------------------------------------------------------------

  const busy = Boolean(loadingName) || downloadKey !== null;

  return (
    <main
      className={`flex min-h-0 flex-1 items-start justify-center overflow-y-auto p-6 transition-colors ${
        dragActive ? "bg-primary/5" : ""
      }`}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) {
          setDragActive(false);
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDrop={handleDrop}
    >
      <div className="grid w-full max-w-5xl gap-6 py-8 lg:grid-cols-[1fr_1.2fr]">
        {/* ---- Lokal: Öffnen + Drop-Zone --------------------------------- */}
        <section className="flex flex-col gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">IFCnative</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              IFC-Dateien nativ ansehen, bearbeiten und versionieren.
            </p>
          </div>

          <div
            className={`grid gap-3 rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
              dragActive
                ? "border-primary bg-primary/10"
                : "border-border/70 bg-card/50"
            }`}
          >
            <FileUp
              aria-hidden
              className="mx-auto size-8 text-muted-foreground/70"
            />
            <div className="text-sm text-foreground">
              IFC-Dateien hierher ziehen
            </div>
            <div className="text-xs text-muted-foreground">
              oder über den Datei-Picker öffnen
            </div>
            <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
              <Button
                disabled={busy}
                variant="default"
                onClick={onOpenFilePicker}
              >
                <FolderOpen aria-hidden className="size-3.5" />
                IFC-Datei öffnen…
              </Button>
              <Button disabled={busy} onClick={() => setNewIfcOpen(true)}>
                <FilePlus2 aria-hidden className="size-3.5" />
                Neue IFC erstellen
              </Button>
            </div>
          </div>

          {loadingName ? (
            <InlineAlert tone="info">
              <span className="inline-flex items-center gap-2">
                <Loader2 aria-hidden className="size-3.5 animate-spin" />
                Lädt {loadingName}…
              </span>
            </InlineAlert>
          ) : null}
        </section>

        {/* ---- IFC Hub ---------------------------------------------------- */}
        <section className="flex min-w-0 flex-col gap-3 rounded-xl border border-border/60 bg-card p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-foreground">
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
                IFC Hub nicht erreichbar — offline weiterarbeiten oder
                Server-URL prüfen.
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
            <div className="grid gap-2">
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
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-48 flex-1">
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

              {folders.length ? (
                <div className="grid max-h-96 gap-3 overflow-y-auto pr-1">
                  {folders.map(([folder, folderModels]) => {
                    const folderKey = `folder:${folder}`;
                    const loadable = folderModels.filter((model) => model.head);
                    return (
                      <div key={folderKey} className="grid gap-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs font-medium text-muted-foreground">
                            {folder || "Projektwurzel"} ·{" "}
                            {folderModels.length}{" "}
                            {folderModels.length === 1 ? "Modell" : "Modelle"}
                          </div>
                          {loadable.length > 1 ? (
                            <Button
                              disabled={busy}
                              title={`Alle ${loadable.length} Modelle dieses Ordners als Tabs laden`}
                              onClick={() =>
                                void loadHubModels(folderModels, folderKey)
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
                              Ordner laden
                            </Button>
                          ) : null}
                        </div>
                        <ul className="grid gap-1.5">
                          {folderModels.map((model) => (
                            <li
                              key={model.id}
                              className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-background px-3 py-2"
                            >
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
                                onClick={() =>
                                  void loadHubModels([model], model.slug)
                                }
                              >
                                {downloadKey === model.slug ? (
                                  <Loader2
                                    aria-hidden
                                    className="size-3.5 animate-spin"
                                  />
                                ) : (
                                  <FolderDown
                                    aria-hidden
                                    className="size-3.5"
                                  />
                                )}
                                Laden
                              </Button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="py-2 text-xs text-muted-foreground">
                  {projects.length
                    ? "Dieses Projekt enthält noch keine IFC-Modelle."
                    : "Noch keine Projekte auf dem Server — Projekte werden in der Web-Oberfläche angelegt."}
                </p>
              )}
            </>
          )}
        </section>
      </div>

      <NewIfcDialog
        open={newIfcOpen}
        onCreate={onCreateNewIfc}
        onOpenChange={setNewIfcOpen}
      />
    </main>
  );
}
