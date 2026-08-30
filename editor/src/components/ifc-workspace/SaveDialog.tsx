/**
 * Speichern-Dialog für Dokumente mit IFC-Hub-Herkunft: der Stand kann als
 * lokale Datei exportiert ODER mit Commit-Nachricht auf den Hub committet
 * werden. Dokumente ohne Hub-Herkunft exportieren direkt (ohne Dialog).
 */

import { CloudUpload, HardDriveDownload, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { VcsApiError } from "@/vcs/client";
import type { VcsDocumentOrigin } from "@/vcs/types";

import { Button, InlineAlert, LabeledInput } from "./ui";

export interface SaveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileName: string;
  origin: VcsDocumentOrigin | null;
  /** Nur mit gültiger Hub-Anmeldung kann committet werden. */
  canCommit: boolean;
  /** Exportiert den Stand als lokale IFC-Datei (schließt den Dialog). */
  onExportLocal: () => void;
  /** Committet den Stand auf den Hub; wirft bei Fehlern (bleibt offen). */
  onCommit: (message: string) => Promise<void>;
}

function errorMessage(error: unknown): string {
  if (error instanceof VcsApiError) {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export function SaveDialog({
  open,
  onOpenChange,
  fileName,
  origin,
  canCommit,
  onExportLocal,
  onCommit,
}: SaveDialogProps) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Frischer Dialogzustand bei jedem Öffnen.
  useEffect(() => {
    if (open) {
      setMessage("");
      setBusy(false);
      setError(null);
    }
  }, [open]);

  const handleCommit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onCommit(message.trim());
    } catch (commitError) {
      setError(errorMessage(commitError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>„{fileName}“ speichern</DialogTitle>
          <DialogDescription>
            {origin
              ? `Dieses Dokument stammt aus ${origin.projectName} / ${origin.modelName} (${origin.branch}) auf dem IFC Hub.`
              : "Dokument als IFC-Datei sichern."}
          </DialogDescription>
        </DialogHeader>

        {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}

        {origin ? (
          <div className="grid gap-2 rounded-lg border border-border/60 bg-card p-3">
            <div className="text-sm font-medium text-foreground">
              Auf den IFC Hub committen
            </div>
            <LabeledInput
              label={`Commit-Nachricht → ${origin.projectSlug}/${origin.modelSlug} (${origin.branch})`}
              value={message}
              onChangeText={setMessage}
            />
            {!canCommit ? (
              <p className="text-xs text-muted-foreground">
                Nicht am IFC Hub angemeldet — im Hub-Panel anmelden, um
                committen zu können.
              </p>
            ) : null}
            <div>
              <Button
                disabled={busy || !canCommit}
                variant="default"
                onClick={() => void handleCommit()}
              >
                {busy ? (
                  <Loader2 aria-hidden className="size-3.5 animate-spin" />
                ) : (
                  <CloudUpload aria-hidden className="size-3.5" />
                )}
                Committen
              </Button>
            </div>
          </div>
        ) : null}

        <DialogFooter className="sm:justify-between">
          <Button
            disabled={busy}
            onClick={() => {
              onExportLocal();
              onOpenChange(false);
            }}
          >
            <HardDriveDownload aria-hidden className="size-3.5" />
            Lokal speichern
          </Button>
          <Button disabled={busy} onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
