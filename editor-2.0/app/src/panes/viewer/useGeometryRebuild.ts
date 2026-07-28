/**
 * Geometrie-Stand des Viewers.
 *
 * Der Renderer tesselliert EINMAL aus einem Byte-Stand und kennt danach weder
 * neue Körper noch geänderte Maße oder Tombstones — Sitzungsänderungen bleiben
 * in 3D unsichtbar. Dieser Hook hält deshalb fest, aus welchen Bytes und aus
 * welcher Dokument-Revision die aktuelle Szene stammt, und liefert auf Wunsch
 * einen neuen Stand: `session.exportStep()` erzeugt die Bytes des
 * Sitzungsstands, das Pane startet den Viewer damit neu (alte Instanz wird
 * disposed).
 *
 * `pending` ist die Differenz zu `useDocRevision(docId)` — die einzige
 * dokumentweite Revisionsquelle, die bei do, undo UND redo steigt. Sie ist der
 * Badge-Zähler des Buttons und speist die Statuszeile.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useDocRevision } from "../../commands/pipeline";
import type { DocumentEntry } from "../../store/documents";

/** Wartezeit der Auto-Neuberechnung nach der letzten Revisionsänderung. */
export const AUTO_REBUILD_DELAY_MS = 2000;

/** Bytes, aus denen die aktuelle Szene stammt, plus deren Dokument-Revision. */
export interface GeometrySource {
  bytes: Uint8Array;
  revision: number;
}

export interface GeometryRebuild {
  /** Aktueller Geometrie-Stand (null = kein Dokument). */
  source: GeometrySource | null;
  /** Offene Modelländerungen seit diesem Stand. */
  pending: number;
  rebuilding: boolean;
  auto: boolean;
  error: string | null;
  rebuild(): void;
  toggleAuto(): void;
}

export function useGeometryRebuild(doc: DocumentEntry | null): GeometryRebuild {
  const docId = doc?.id ?? null;
  const bytes = doc?.bytes ?? null;
  const revision = useDocRevision(docId);
  // Die Revision liegt zusätzlich in einem Ref, damit der Dokumentwechsel-Effekt
  // nicht bei jeder Änderung neu läuft (und dabei die Szene neu aufbaut).
  const revisionRef = useRef(revision);
  revisionRef.current = revision;

  const [source, setSource] = useState<GeometrySource | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [auto, setAuto] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Dokumentwechsel: zurück auf die Originalbytes.
  useEffect(() => {
    setSource(bytes ? { bytes, revision: revisionRef.current } : null);
    setError(null);
  }, [docId, bytes]);

  const pending = source ? Math.max(0, revision - source.revision) : 0;

  const rebuild = useCallback((): void => {
    if (!doc) return;
    const session = doc.session;
    setRebuilding(true);
    setError(null);
    // Der Export ist synchron und bei großen Modellen spürbar: erst einen Tick
    // durchlassen, damit „Berechne …" überhaupt gerendert wird.
    window.setTimeout(() => {
      try {
        setSource({ bytes: session.exportStep(), revision: revisionRef.current });
      } catch (cause) {
        setError(`Neuberechnung fehlgeschlagen: ${String(cause)}`);
      } finally {
        setRebuilding(false);
      }
    }, 0);
  }, [doc]);

  // Auto-Neuberechnung: Der Timer startet nach jeder Revision neu (Debounce).
  useEffect(() => {
    if (!auto || pending === 0 || rebuilding) return;
    const timer = window.setTimeout(rebuild, AUTO_REBUILD_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [auto, pending, rebuilding, rebuild]);

  const toggleAuto = useCallback(() => setAuto((value) => !value), []);

  return { source, pending, rebuilding, auto, error, rebuild, toggleAuto };
}
