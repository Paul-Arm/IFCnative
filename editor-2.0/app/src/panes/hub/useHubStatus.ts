/**
 * Verbindungsstatus des Hubs über GET /api/health.
 *
 * Geprüft wird beim Öffnen der Pane und nach jeder Änderung an Basis-URL oder
 * Token; „Verbinden" stößt dieselbe Prüfung manuell an. Ein laufender Lauf
 * wird über ein Ticket entwertet, damit eine langsame alte Antwort keinen
 * frischen Status überschreibt.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { checkHealth } from "../../domain/hub/client";
import { hubErrorMessage } from "../../domain/hub/error";
import type { HubConfig } from "../../domain/hub/types";

export type HubConnectionState = "unknown" | "checking" | "online" | "offline";

export interface HubStatus {
  state: HubConnectionState;
  /** Version des Dienstes, sobald verbunden. */
  version: string | null;
  error: string | null;
  check(): void;
}

export function useHubStatus(config: HubConfig): HubStatus {
  const [state, setState] = useState<HubConnectionState>("unknown");
  const [version, setVersion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ticketRef = useRef(0);

  const check = useCallback(() => {
    const ticket = ++ticketRef.current;
    setState("checking");
    setError(null);
    void checkHealth(config)
      .then((health) => {
        if (ticket !== ticketRef.current) return;
        setVersion(health.version);
        setState("online");
      })
      .catch((cause: unknown) => {
        if (ticket !== ticketRef.current) return;
        setVersion(null);
        setError(hubErrorMessage(cause));
        setState("offline");
      });
  }, [config]);

  useEffect(() => {
    check();
  }, [check]);

  // Beim Schließen der Pane laufende Prüfungen entwerten.
  useEffect(
    () => () => {
      ticketRef.current++;
    },
    [],
  );

  return { state, version, error, check };
}
