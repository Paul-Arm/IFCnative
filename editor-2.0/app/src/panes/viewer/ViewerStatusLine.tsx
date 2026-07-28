/**
 * Statuszeile des Viewers (aus ViewerPane ausgelagert, M9): Lade-/Mesh-Stand,
 * Geometrie-Revision, Sichtbarkeits-Zähler, Lens-Quelle und Hinweise — plus
 * vorangestellte Werkzeug-Anzeigen (Verschiebe-Δ, Pick-Koordinaten).
 */
import type { ViewerStatus } from "../../core/viewer";

export default function ViewerStatusLine({
  status,
  hiddenCount,
  isolatedCount,
  lensSource,
  note,
  geometryRevision,
  pendingRebuild,
  extraParts,
}: {
  status: ViewerStatus | null;
  hiddenCount: number;
  isolatedCount: number | null;
  lensSource: string | null;
  note: string | null;
  geometryRevision: number | null;
  pendingRebuild: number;
  /** Werkzeug-Anzeigen (M9), erscheinen VOR den Standardteilen. */
  extraParts?: readonly string[];
}) {
  const parts: string[] = [...(extraParts ?? [])];
  if (status?.kind === "loading") parts.push(`Lade … ${status.meshCount} Meshes`);
  else if (status?.kind === "ready") parts.push(`${status.meshCount} Meshes`);
  else if (status) parts.push(status.reason);
  if (pendingRebuild > 0 && geometryRevision !== null) {
    parts.push(
      `Geometrie-Stand: Revision ${geometryRevision} / ${pendingRebuild} ` +
        `${pendingRebuild === 1 ? "Änderung" : "Änderungen"} offen`,
    );
  }
  if (hiddenCount > 0) parts.push(`${hiddenCount} ausgeblendet`);
  if (isolatedCount !== null) parts.push(`${isolatedCount} isoliert`);
  if (lensSource) parts.push(`Lens: ${lensSource}`);
  if (note) parts.push(note);
  return (
    <div
      className="text-dim"
      style={{ padding: "4px 8px", borderTop: "1px solid var(--border)" }}
    >
      {parts.length > 0 ? parts.join(" · ") : "Bereit."}
    </div>
  );
}
