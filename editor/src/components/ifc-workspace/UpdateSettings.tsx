import { editorUpdates } from "@/updates/client";
import { useUpdates } from "@/updates/use-updates";
import { Download, RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { Button, InfoRow, InfoSection } from "./ui";

export function UpdateSettings() {
  const state = useUpdates();
  const busy = ["checking", "downloading", "installing"].includes(state.phase);
  const available = state.desktop && state.configured;
  const notesVersion = state.update?.version ?? state.currentVersion;
  useEffect(() => {
    void editorUpdates.initialize();
  }, []);
  useEffect(() => {
    if (available) void editorUpdates.loadPatchnotes();
  }, [available, notesVersion, state.lastCheckedAt]);
  const percent = state.progress?.total
    ? Math.min(
        100,
        Math.round((state.progress.downloaded / state.progress.total) * 100),
      )
    : null;
  return (
    <>
      <InfoSection title="Editor-Version">
        <InfoRow label="Installiert" value={state.currentVersion || "…"} />
        <InfoRow
          label="Zuletzt geprüft"
          value={
            state.lastCheckedAt
              ? new Date(state.lastCheckedAt).toLocaleString("de-DE")
              : "Noch nicht geprüft"
          }
        />
        {state.lastCheckError ? (
          <p className="text-xs text-muted-foreground">
            Letzte automatische Suche: {state.lastCheckError}
          </p>
        ) : null}
        {!state.initialized ? (
          <p className="text-xs text-muted-foreground">
            Einstellungen werden geladen…
          </p>
        ) : !state.desktop ? (
          <p className="text-xs text-muted-foreground">
            Updates werden in der Windows-Desktop-App installiert.
          </p>
        ) : !state.configured ? (
          <p className="text-xs text-muted-foreground">
            Der Update-Dienst ist noch nicht eingerichtet.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!available || busy || state.phase === "ready"}
            onClick={() => {
              void editorUpdates.check();
            }}
          >
            <RefreshCw
              aria-hidden
              className={`size-3.5 ${state.phase === "checking" ? "animate-spin" : ""}`}
            />
            {state.phase === "checking"
              ? "Suche läuft…"
              : "Jetzt nach Updates suchen"}
          </Button>
        </div>
        {state.phase === "current" ? (
          <p role="status" className="text-sm">
            Du verwendest die neueste Version.
          </p>
        ) : null}
      </InfoSection>
      <InfoSection title="Automatische Suche">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 accent-primary"
            checked={state.automatic}
            onChange={(event) =>
              editorUpdates.setAutomatic(event.target.checked)
            }
          />
          <span>
            Automatisch nach Updates suchen
            <span className="mt-1 block text-xs text-muted-foreground">
              Nach dem Start und alle sechs Stunden. Herunterladen und
              installieren erst nach deinem Klick.
            </span>
          </span>
        </label>
        {state.snoozedUntil > state.now ? (
          <div className="space-y-2 text-xs text-muted-foreground">
            <p>
              Hinweise pausieren bis{" "}
              {new Date(state.snoozedUntil).toLocaleString("de-DE")}.
            </p>
            <Button onClick={editorUpdates.resumeNotifications}>
              Hinweise wieder anzeigen
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Update-Hinweise erscheinen oben rechts und lassen sich für eine
            Woche ausblenden.
          </p>
        )}
      </InfoSection>
      {state.update ? (
        <InfoSection title={`Update auf ${state.update.version}`}>
          <p className="text-xs text-muted-foreground">
            Bitte speichere deine IFC-Dateien und schließe laufende Hub- und
            Portal-Vorgänge ab. Zur Installation wird der Editor samt
            ausgelagerter Panel-Fenster geschlossen und anschließend neu
            gestartet.
          </p>
          <Button
            variant="default"
            disabled={busy}
            onClick={() => {
              void editorUpdates.install();
            }}
          >
            <Download aria-hidden className="size-3.5" />
            {state.phase === "downloading"
              ? "Wird heruntergeladen…"
              : state.phase === "installing"
                ? "Installation startet…"
                : state.phase === "ready"
                  ? "Jetzt installieren"
                  : "Herunterladen und installieren"}
          </Button>
          {state.phase === "downloading" ? (
            <div className="space-y-1" role="status">
              <progress
                aria-label="Update-Download"
                className="h-2 w-full accent-primary"
                max={100}
                value={percent ?? undefined}
              />
              <p className="text-xs text-muted-foreground">
                {percent === null
                  ? "Download läuft…"
                  : `${percent} % heruntergeladen`}
              </p>
            </div>
          ) : null}
          {state.phase === "ready" ? (
            <p className="text-xs">Heruntergeladen und Signatur geprüft.</p>
          ) : null}
        </InfoSection>
      ) : null}
      {state.error ? (
        <p
          role="status"
          className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {state.error}
        </p>
      ) : null}
      <InfoSection title="Patchnotes-Verlauf">
        {state.notesLoading ? (
          <p className="text-xs text-muted-foreground">
            Patchnotes werden geladen…
          </p>
        ) : null}
        {state.patchnotesHistory.length ? (
          <div className="space-y-3">
            {state.patchnotesHistory.map((notes) => (
              <details key={notes.version} open={notes.version === notesVersion} className="rounded-lg border border-border/60 p-3 text-sm">
                <summary className="cursor-pointer font-medium">
                  {notes.version} · {notes.title}
                  {notes.version === state.currentVersion ? <span className="ml-2 text-xs font-normal text-muted-foreground">Installiert</span> : null}
                  {notes.version === state.update?.version ? <span className="ml-2 text-xs font-normal text-primary">Verfügbar</span> : null}
                </summary>
                <div className="mt-3 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    {new Date(notes.publishedAt).toLocaleDateString("de-DE")}
                  </p>
                  <ul className="list-disc space-y-1 pl-5">
                    {notes.changes.map((change, index) => (
                      <li key={index} className="whitespace-pre-wrap break-words">
                        {change}
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            ))}
          </div>
        ) : state.update?.notes ? (
          <p className="whitespace-pre-wrap break-words text-sm">
            {state.update.notes}
          </p>
        ) : !state.notesLoading ? (
          <p className="text-xs text-muted-foreground">
            Noch keine Patchnotes verfügbar.
          </p>
        ) : null}
        {state.notesError ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{state.notesError}</p>
            <Button
              disabled={state.notesLoading}
              onClick={() => {
                void editorUpdates.loadPatchnotes();
              }}
            >
              Erneut laden
            </Button>
          </div>
        ) : null}
      </InfoSection>
    </>
  );
}
