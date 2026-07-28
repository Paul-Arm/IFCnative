/**
 * Filterzustand der Befundliste (Schweregrad-Umschalter, Textsuche, Quelle)
 * samt reiner Filterfunktion — bewusst ohne React, damit die Pane-Dateien
 * klein bleiben.
 */
import type {
  CheckFinding,
  CheckSeverity,
  CheckSourceId,
} from "../../domain/checks/types";

export interface FindingFilter {
  severities: Record<CheckSeverity, boolean>;
  /** Freitext über Meldung, Detail, Befundart und Objekt-Id. */
  text: string;
  /** "all" = alle Quellen. */
  source: CheckSourceId | "all";
}

export const DEFAULT_FILTER: FindingFilter = {
  severities: { error: true, warning: true, info: true },
  text: "",
  source: "all",
};

/** Punktfarbe je Schweregrad (Design-Token aus global.css). */
export const SEVERITY_CSS: Record<CheckSeverity, string> = {
  error: "var(--error)",
  warning: "var(--warn)",
  info: "var(--text-dim)",
};

export function filterFindings(
  findings: readonly CheckFinding[],
  filter: FindingFilter,
): CheckFinding[] {
  const needle = filter.text.trim().toLowerCase();
  return findings.filter((finding) => {
    if (!filter.severities[finding.severity]) return false;
    if (filter.source !== "all" && finding.source !== filter.source) return false;
    if (!needle) return true;
    const haystack = [
      finding.message,
      finding.detail ?? "",
      finding.kind,
      finding.entityIds.map((id) => `#${id}`).join(" "),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}

/** Fehlschläge = alles außer Hinweisen (Grundlage für BCF und Markierung). */
export function failuresOf(findings: readonly CheckFinding[]): CheckFinding[] {
  return findings.filter((finding) => finding.severity !== "info");
}
