/**
 * Dialog für Editor-Links aus dem IFC Hub ("Im Editor öffnen"): prüft, ob
 * der Link zum eingestellten Hub passt, meldet bei Bedarf an und lädt den
 * verlinkten Stand als Tab (src/vcs/openFromLink.ts).
 */

import { ExternalLink, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { normalizeHubUrl, type EditorOpenRequest } from "@/desktop/editorLink";
import { VcsApiClient } from "@/vcs/client";
import { EditorLinkError, loadLinkedHubDocument, type LinkedHubDocument } from "@/vcs/openFromLink";
import type { VcsAuth, VcsSettings } from "@/vcs/types";

import { HubAuthForm } from "./HubAuthForm";
import { Button, InlineAlert } from "./ui";

export interface HubLinkDialogProps {
  request: EditorOpenRequest;
  settings: VcsSettings;
  onSettingsChange: (settings: VcsSettings) => void;
  auth: VcsAuth | null;
  onAuthChange: (auth: VcsAuth | null) => void;
  /** Öffnet den geladenen Stand als Tab; der Dialog schließt danach. */
  onOpenDocument: (document: LinkedHubDocument) => Promise<void>;
  onClose: () => void;
}

export function HubLinkDialog({
  request,
  settings,
  onSettingsChange,
  auth,
  onAuthChange,
  onOpenDocument,
  onClose,
}: HubLinkDialogProps) {
  const sameHub = normalizeHubUrl(settings.baseUrl) === request.hub;
  const client = useMemo(() => new VcsApiClient(settings, auth), [settings, auth]);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const loading = sameHub && Boolean(auth) && !error;

  useEffect(() => {
    if (!sameHub || !auth) return;
    let cancelled = false;
    setError(null);
    loadLinkedHubDocument(client, request)
      .then(async (document) => {
        if (cancelled) return;
        await onOpenDocument(document);
        if (!cancelled) onClose();
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        if (loadError instanceof EditorLinkError && loadError.unauthorized) {
          // Abgelaufene Anmeldung: Formular zeigen, danach lädt es erneut.
          onAuthChange(null);
        }
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      });
    return () => {
      cancelled = true;
    };
    // onOpenDocument/onClose/onAuthChange sind Eltern-Callbacks ohne
    // stabile Identität; geladen wird nur bei Hub, Anmeldung oder Retry.
  }, [client, request, sameHub, auth, attempt]);

  const target = [
    `${request.project} / ${request.model}`,
    request.branch ? `Branch ${request.branch}` : null,
    request.commit ? `Stand ${request.commit.slice(0, 8)}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] gap-4 overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Modell aus dem IFC Hub öffnen</DialogTitle>
          <DialogDescription>{target}</DialogDescription>
        </DialogHeader>

        {!sameHub ? (
          <>
            <InlineAlert tone="warning">
              Der Link verweist auf den Hub <strong>{request.hub}</strong>, eingestellt ist{" "}
              <strong>{settings.baseUrl}</strong>. Nach dem Wechsel meldest du dich dort neu an.
              Nur wechseln, wenn du diesem Hub vertraust.
            </InlineAlert>
            <div className="flex justify-end gap-2">
              <Button onClick={onClose}>Abbrechen</Button>
              <Button
                variant="default"
                onClick={() => {
                  // Anmeldung gilt nur für den bisherigen Hub — nie an einen
                  // anderen Server schicken.
                  onAuthChange(null);
                  onSettingsChange({ ...settings, baseUrl: request.hub });
                }}
              >
                <ExternalLink aria-hidden className="size-3.5" />
                Zu diesem Hub wechseln
              </Button>
            </div>
          </>
        ) : !auth ? (
          <>
            {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
            <HubAuthForm auth={auth} settings={settings} onAuthChange={onAuthChange} />
          </>
        ) : error ? (
          <>
            <InlineAlert tone="danger">{error}</InlineAlert>
            <div className="flex justify-end gap-2">
              <Button onClick={onClose}>Schließen</Button>
              <Button variant="default" onClick={() => {
                setError(null);
                setAttempt((value) => value + 1);
              }}>
                Erneut versuchen
              </Button>
            </div>
          </>
        ) : loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 aria-hidden className="size-4 animate-spin" />
            Lade von {settings.baseUrl} …
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
