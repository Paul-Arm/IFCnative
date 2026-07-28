/**
 * Gemeinsame Kleinteile der Prüfquellen (M6).
 *
 * `FindingCollector` vergibt die im Vertrag (`../types.ts`) verlangten
 * stabilen Befund-Ids (`<quelle>:<art>:<objekt>:<n>`), deckelt die Menge je
 * Befundart — ein Modell mit 50 000 Bauteilen ohne Representation darf die
 * Prüfliste nicht sprengen — und meldet die Kürzung als eigenen Hinweis,
 * damit nie stillschweigend Befunde verschwinden.
 */
import type {
  CheckFinding,
  CheckRunResult,
  CheckSeverity,
  CheckSourceId,
} from "../types";

/** Eingabe eines einzelnen Befunds (Id und Quelle setzt der Collector). */
export interface FindingInput {
  kind: string;
  severity: CheckSeverity;
  message: string;
  /** betroffene Objekte; erste Id = primäres Ziel für Auswahl/3D */
  entityIds: number[];
  detail?: string;
}

/** Vorgabe: so viele Befunde je Art werden einzeln ausgewiesen. */
export const DEFAULT_LIMIT_PER_KIND = 200;

export class FindingCollector {
  private readonly findings: CheckFinding[] = [];
  /** Zähler je Befundart — auch über das Anzeigelimit hinaus. */
  private readonly counts = new Map<string, number>();
  private readonly startedAt = Date.now();

  constructor(
    private readonly source: CheckSourceId,
    private readonly limitPerKind: number = DEFAULT_LIMIT_PER_KIND,
  ) {}

  add(input: FindingInput): void {
    const seen = this.counts.get(input.kind) ?? 0;
    this.counts.set(input.kind, seen + 1);
    if (seen >= this.limitPerKind) return;
    this.findings.push({
      id: `${this.source}:${input.kind}:${input.entityIds[0] ?? 0}:${seen}`,
      source: this.source,
      kind: input.kind,
      severity: input.severity,
      message: input.message,
      entityIds: input.entityIds,
      detail: input.detail,
    });
  }

  /** Anzahl aller erfassten Befunde einer Art (inklusive gekürzter). */
  countOf(kind: string): number {
    return this.counts.get(kind) ?? 0;
  }

  /**
   * Ergebnis abschließen: hängt je gekürzter Befundart einen Hinweis an und
   * misst die Laufzeit ab Konstruktion des Collectors.
   */
  result(checkedCount: number): CheckRunResult {
    for (const [kind, total] of this.counts) {
      if (total <= this.limitPerKind) continue;
      const hidden = total - this.limitPerKind;
      this.findings.push({
        id: `${this.source}:truncated:${kind}:0`,
        source: this.source,
        kind: "truncated",
        severity: "info",
        message: `Weitere ${hidden} Befunde der Art „${kind}" werden nicht einzeln angezeigt.`,
        entityIds: [],
        detail: `${total} Befunde insgesamt, Anzeigegrenze ${this.limitPerKind}`,
      });
    }
    return {
      source: this.source,
      findings: this.findings,
      durationMs: Date.now() - this.startedAt,
      checkedCount,
    };
  }
}

/** Zahl mit deutschem Dezimalkomma und fester Nachkommastelle. */
export function formatNumber(value: number, digits = 1): string {
  return value.toFixed(digits).replace(".", ",");
}
