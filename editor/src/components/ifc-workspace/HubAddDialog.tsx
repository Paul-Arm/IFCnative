/**
 * Dialog "IFC vom Hub hinzufügen": zeigt den IFC-Hub-Browser (Projekt- und
 * Ordnerauswahl wie auf der Startseite) und öffnet geladene Stände als
 * ZUSÄTZLICHE Tabs, ohne die offenen Dokumente zu ersetzen.
 */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { VcsAuth, VcsSettings } from "@/vcs/types";

import { HubBrowser, type HubDocument } from "./HubBrowser";

export interface HubAddDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: VcsSettings;
  onSettingsChange: (settings: VcsSettings) => void;
  auth: VcsAuth | null;
  onAuthChange: (auth: VcsAuth | null) => void;
  /** Externe Sperre, z. B. während eine Datei parst. */
  busy: boolean;
  /** Fügt die geladenen Stände als zusätzliche Dokument-Tabs hinzu. */
  onAddDocuments: (documents: HubDocument[]) => Promise<void>;
}

export function HubAddDialog({
  open,
  onOpenChange,
  settings,
  onSettingsChange,
  auth,
  onAuthChange,
  busy,
  onAddDocuments,
}: HubAddDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] gap-4 overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>IFC vom Hub hinzufügen</DialogTitle>
          <DialogDescription>
            Geladene Stände werden als zusätzliche Tabs geöffnet — offene
            Dokumente bleiben erhalten.
          </DialogDescription>
        </DialogHeader>
        <HubBrowser
          auth={auth}
          busy={busy}
          settings={settings}
          onAuthChange={onAuthChange}
          onOpenHubDocuments={onAddDocuments}
          onSettingsChange={onSettingsChange}
        />
      </DialogContent>
    </Dialog>
  );
}
