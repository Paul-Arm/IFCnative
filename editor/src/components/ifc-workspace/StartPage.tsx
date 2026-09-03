/**
 * Startseite des Editors: erscheint, solange noch kein Dokument geöffnet
 * wurde. Bietet die Einstiege an — IFC-Datei öffnen (Picker), Drag-&-Drop,
 * kürzlich verwendete Dateien und (bei erreichbarem Server) das Laden
 * einzelner Modelle oder ganzer Ordner aus einem IFC-Hub-Projekt.
 */

import {
  FilePlus2,
  FileUp,
  FolderOpen,
  History,
  Loader2,
} from "lucide-react";
import { useState, type DragEvent } from "react";

import type { VcsAuth, VcsSettings } from "@/vcs/types";

import { HubBrowser, type HubDocument } from "./HubBrowser";
import { NewIfcDialog, type NewIfcDraft } from "./NewIfcDialog";
import { Button, InlineAlert } from "./ui";
import type { RecentIfcFileEntry } from "./workspaceStorage";

/** Ein vom Hub geladener IFC-Stand, den der Editor als Tab öffnet. */
export type StartPageHubDocument = HubDocument;

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
  /** Kürzlich geöffnete IFC-Dateien (neueste zuerst). */
  recentFiles: RecentIfcFileEntry[];
  /** Öffnet einen Eintrag aus der Liste der zuletzt verwendeten Dateien. */
  onOpenRecentFile: (entry: RecentIfcFileEntry) => void;
}

/** Relative Zeitangabe ("vor 3 Minuten", "gestern"). */
function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) {
    return iso;
  }
  const diffSeconds = Math.round((then - Date.now()) / 1000);
  const elapsed = Math.abs(diffSeconds);
  const rtf = new Intl.RelativeTimeFormat("de", { numeric: "auto" });
  const steps: {
    limit: number;
    seconds: number;
    unit: Intl.RelativeTimeFormatUnit;
  }[] = [
    { limit: 60, seconds: 1, unit: "second" },
    { limit: 3_600, seconds: 60, unit: "minute" },
    { limit: 86_400, seconds: 3_600, unit: "hour" },
    { limit: 604_800, seconds: 86_400, unit: "day" },
    { limit: 2_629_800, seconds: 604_800, unit: "week" },
    { limit: 31_557_600, seconds: 2_629_800, unit: "month" },
    { limit: Number.POSITIVE_INFINITY, seconds: 31_557_600, unit: "year" },
  ];
  const step =
    steps.find((candidate) => elapsed < candidate.limit) ??
    steps[steps.length - 1];
  return rtf.format(Math.trunc(diffSeconds / step.seconds), step.unit);
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
  recentFiles,
  onOpenRecentFile,
}: StartPageProps) {
  const [dragActive, setDragActive] = useState(false);
  const [newIfcOpen, setNewIfcOpen] = useState(false);

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

  const busy = Boolean(loadingName);

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
      <div className="my-auto grid w-full max-w-6xl gap-6 px-2 py-6">
        <div className="grid items-stretch gap-6 md:grid-cols-2">
          {/* ---- Lokal: Öffnen + Drop-Zone ------------------------------- */}
          <section className="flex min-w-0 flex-col gap-4 rounded-2xl border border-border/60 bg-card p-6">
            <div>
              <div className="text-base font-semibold text-foreground">
                Lokal arbeiten
              </div>
              <div className="text-xs text-muted-foreground">
                Dateien von diesem Rechner öffnen oder neu anlegen
              </div>
            </div>

            <div
              className={`flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
                dragActive
                  ? "border-primary bg-primary/10"
                  : "border-border/70 bg-background/60"
              }`}
            >
              <FileUp
                aria-hidden
                className="size-10 text-muted-foreground/70"
              />
              <div className="text-sm text-foreground">
                IFC-Dateien hierher ziehen
              </div>
              <div className="text-xs text-muted-foreground">
                oder über den Datei-Picker öffnen
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
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

          {/* ---- Kürzlich verwendet -------------------------------------- */}
          <section className="flex min-w-0 flex-col gap-4 rounded-2xl border border-border/60 bg-card p-6">
            <div>
              <div className="text-base font-semibold text-foreground">
                Kürzlich verwendet
              </div>
              <div className="text-xs text-muted-foreground">
                Zuletzt geöffnete IFC-Dateien
              </div>
            </div>

            {recentFiles.length ? (
              <ul className="grid max-h-72 min-w-0 content-start gap-1.5 overflow-y-auto pr-1">
                {recentFiles.map((entry) => (
                  <li key={entry.id} className="min-w-0">
                    <button
                      className="flex w-full min-w-0 items-center gap-3 rounded-lg border border-border/60 bg-background px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={busy}
                      title={entry.path ?? entry.name}
                      type="button"
                      onClick={() => onOpenRecentFile(entry)}
                    >
                      <History
                        aria-hidden
                        className="size-4 shrink-0 text-muted-foreground/70"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-foreground">
                          {entry.name}
                        </span>
                        <span className="block truncate text-[0.7rem] text-muted-foreground">
                          {[
                            formatRelative(entry.openedAt),
                            entry.schema || null,
                            entry.entityCount != null
                              ? `${entry.entityCount.toLocaleString("de-DE")} Entitäten`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-border/50 bg-background/60 p-6 text-center">
                <History
                  aria-hidden
                  className="size-8 text-muted-foreground/50"
                />
                <div className="text-sm text-muted-foreground">
                  Noch keine kürzlich verwendeten Dateien
                </div>
                <div className="text-xs text-muted-foreground/80">
                  Geöffnete IFC-Dateien erscheinen hier.
                </div>
              </div>
            )}
          </section>
        </div>

        {/* ---- IFC Hub ----------------------------------------------------- */}
        <section className="mx-auto w-full max-w-3xl min-w-0 rounded-2xl border border-border/60 bg-card p-6">
          <HubBrowser
            auth={auth}
            busy={busy}
            settings={settings}
            onAuthChange={onAuthChange}
            onOpenHubDocuments={onOpenHubDocuments}
            onSettingsChange={onSettingsChange}
          />
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
