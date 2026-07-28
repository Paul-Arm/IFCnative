/**
 * Reines Datenmodell des IDS-Fensters — bewusst ohne React, damit es getestet
 * werden kann und die Pane-Dateien klein bleiben.
 *
 * Aus den Berichten von `validateIDS` (@ifc-lite/ids) wird ein Baum
 * Dokument → Spezifikation → Objekt → Anforderung gebaut. Anders als das
 * Prüfzentrum (das den Bericht auf eine flache Befundliste einkocht) bleibt
 * hier die Struktur des Berichts erhalten:
 *
 *  - `IDSSpecificationResult` liefert `status` (pass/fail/not_applicable),
 *    `applicableCount`/`passedCount`/`failedCount`/`passRate` und optional ein
 *    `cardinalityResult` (minOccurs/maxOccurs) — daraus werden Zähler, Balken
 *    und Status-Punkt je Spezifikation.
 *  - `IDSEntityResult` liefert `expressId`, `entityType`, `entityName`,
 *    `globalId`, `passed` — und zwar für BESTANDENE wie FEHLGESCHLAGENE
 *    Objekte, weshalb hier auch die Bestandenen anzeigbar sind.
 *  - `IDSRequirementResult` liefert je Anforderung `status`, die übersetzte
 *    `checkedDescription`, bei Fehlschlag `failureReason`, `expectedValue`,
 *    `actualValue` sowie `failure.type`/`failure.field`.
 */
import type {
  IDSEntityResult,
  IDSRequirementResult,
  IDSSpecificationResult,
  IDSValidationReport,
} from "@ifc-lite/ids";

export type IdsStatus = "pass" | "fail" | "not_applicable";

/** Eine geprüfte Anforderung eines Objekts. */
export interface IdsRequirementRow {
  /** Übersetzte Beschreibung der Prüfung (`checkedDescription`). */
  checked: string;
  status: IdsStatus;
  /** `failureReason` — übersetzter Klartext des Fehlschlags. */
  reason?: string;
  expected?: string;
  actual?: string;
  /** `failure.field`, z. B. „Pset_WallCommon.FireRating". */
  field?: string;
  /** `failure.type`, z. B. „PROPERTY_MISSING". */
  failureType?: string;
  /** `optional` = Verstoß ist nur ein Hinweis, kein harter Fehler. */
  optional: boolean;
}

/** Ein Objekt im Ergebnis einer Spezifikation. */
export interface IdsEntityRow {
  key: string;
  expressId: number;
  /** Anzeigename aus `session.labelOf` (der Bericht kennt die Sitzung nicht). */
  label: string;
  entityType: string;
  entityName?: string;
  globalId?: string;
  passed: boolean;
  /** Nur die fehlgeschlagenen Anforderungen — Grundlage des Detailtexts. */
  failures: IdsRequirementRow[];
}

/** Eine Spezifikation mit ihren Zählern. */
export interface IdsSpecRow {
  key: string;
  name: string;
  description?: string;
  status: IdsStatus;
  /** Objekte, die die Applicability getroffen haben. */
  applicableCount: number;
  passedCount: number;
  failedCount: number;
  /** 0–100. */
  passRate: number;
  /** Meldung des `cardinalityResult`, nur wenn die Anzahl verletzt ist. */
  cardinalityMessage: string | null;
  entities: IdsEntityRow[];
}

export interface IdsTotals {
  specs: number;
  failedSpecs: number;
  checked: number;
  passed: number;
  failed: number;
}

export interface IdsDocRow {
  key: string;
  name: string;
  specs: IdsSpecRow[];
  totals: IdsTotals;
}

export interface IdsRunResult {
  documents: IdsDocRow[];
  totals: IdsTotals;
  /** Dokument-Revision zum Zeitpunkt des Laufs (für die Veraltungs-Anzeige). */
  ranAtRevision: number;
  durationMs: number;
}

export const EMPTY_TOTALS: IdsTotals = {
  specs: 0,
  failedSpecs: 0,
  checked: 0,
  passed: 0,
  failed: 0,
};

/** Punktfarbe je Status — grün kommt aus `ids-validation.css`. */
export const STATUS_CSS: Record<IdsStatus, string> = {
  pass: "var(--ids-pass)",
  fail: "var(--error)",
  not_applicable: "var(--text-dim)",
};

export const STATUS_LABELS: Record<IdsStatus, string> = {
  pass: "bestanden",
  fail: "fehlgeschlagen",
  not_applicable: "nicht anwendbar",
};

function requirementRow(result: IDSRequirementResult): IdsRequirementRow {
  const failure = result.failure;
  return {
    checked: result.checkedDescription,
    status: result.status,
    reason: result.failureReason,
    expected: result.expectedValue ?? failure?.expected,
    actual: result.actualValue ?? failure?.actual,
    field: failure?.field,
    failureType: failure?.type,
    optional: result.requirement.optionality === "optional",
  };
}

function entityRow(
  result: IDSEntityResult,
  specKey: string,
  labelOf: (expressId: number) => string,
): IdsEntityRow {
  return {
    key: `${specKey}:${result.expressId}`,
    expressId: result.expressId,
    label: labelOf(result.expressId),
    entityType: result.entityType,
    entityName: result.entityName,
    globalId: result.globalId,
    passed: result.passed,
    failures: result.requirementResults
      .filter((r) => r.status === "fail")
      .map(requirementRow),
  };
}

function specRow(
  result: IDSSpecificationResult,
  docKey: string,
  index: number,
  labelOf: (expressId: number) => string,
): IdsSpecRow {
  const key = `${docKey}:${result.specification.id || index}`;
  const cardinality = result.cardinalityResult;
  return {
    key,
    name: result.specification.name || `Spezifikation ${index + 1}`,
    description: result.specification.description,
    status: result.status,
    applicableCount: result.applicableCount,
    passedCount: result.passedCount,
    failedCount: result.failedCount,
    passRate: result.passRate,
    cardinalityMessage:
      cardinality && !cardinality.passed ? cardinality.message : null,
    entities: result.entityResults.map((entity) => entityRow(entity, key, labelOf)),
  };
}

function totalsOf(specs: readonly IdsSpecRow[]): IdsTotals {
  return specs.reduce<IdsTotals>(
    (sum, spec) => ({
      specs: sum.specs + 1,
      failedSpecs: sum.failedSpecs + (spec.status === "fail" ? 1 : 0),
      checked: sum.checked + spec.applicableCount,
      passed: sum.passed + spec.passedCount,
      failed: sum.failed + spec.failedCount,
    }),
    { ...EMPTY_TOTALS },
  );
}

/** Bericht eines IDS-Dokuments in die Anzeigestruktur überführen. */
export function documentRow(
  report: IDSValidationReport,
  key: string,
  name: string,
  labelOf: (expressId: number) => string,
): IdsDocRow {
  const specs = report.specificationResults.map((result, index) =>
    specRow(result, key, index, labelOf),
  );
  return { key, name, specs, totals: totalsOf(specs) };
}

/** Gesamtzähler über alle Dokumente. */
export function runTotals(documents: readonly IdsDocRow[]): IdsTotals {
  return documents.reduce<IdsTotals>(
    (sum, doc) => ({
      specs: sum.specs + doc.totals.specs,
      failedSpecs: sum.failedSpecs + doc.totals.failedSpecs,
      checked: sum.checked + doc.totals.checked,
      passed: sum.passed + doc.totals.passed,
      failed: sum.failed + doc.totals.failed,
    }),
    { ...EMPTY_TOTALS },
  );
}

// — Filter —

export type EntityFilterMode = "all" | "failed";

export interface IdsFilter {
  mode: EntityFilterMode;
  /** Freitext über Label, Klasse, GlobalId, Objekt-Id und Fehlertext. */
  text: string;
}

export const DEFAULT_IDS_FILTER: IdsFilter = { mode: "failed", text: "" };

function haystackOf(row: IdsEntityRow): string {
  return [
    row.label,
    row.entityType,
    row.entityName ?? "",
    row.globalId ?? "",
    `#${row.expressId}`,
    ...row.failures.flatMap((f) => [
      f.checked,
      f.reason ?? "",
      f.expected ?? "",
      f.actual ?? "",
      f.field ?? "",
      f.failureType ?? "",
    ]),
  ]
    .join(" ")
    .toLowerCase();
}

export function filterEntities(
  rows: readonly IdsEntityRow[],
  filter: IdsFilter,
): IdsEntityRow[] {
  const needle = filter.text.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter.mode === "failed" && row.passed) return false;
    return needle === "" || haystackOf(row).includes(needle);
  });
}

/** Kurzer Detailtext eines Fehlschlags (Liste und CSV nutzen denselben). */
export function failureText(failure: IdsRequirementRow): string {
  return [
    failure.reason ?? failure.checked,
    failure.field && `Feld: ${failure.field}`,
    failure.expected && `Erwartet: ${failure.expected}`,
    failure.actual && `Gefunden: ${failure.actual}`,
  ]
    .filter(Boolean)
    .join(" · ");
}
