/**
 * Abfragebasierte Auswahl: IFC-Klasse + optionaler Property-Filter.
 *
 * API-Entscheidung (empirisch geprüft, siehe Kommentare):
 *
 *  - **Klassenfilter über `store.entityIndex.byType`.** `@ifc-lite/query`
 *    (`IfcQuery.ofType(...)`) funktioniert zwar, arbeitet aber über
 *    `IfcTypeEnum`. Die Datalist soll genau die Klassen anbieten, die im
 *    Modell vorkommen — dafür ist der Byte-Index des Parsers die direkte und
 *    verlustfreie Quelle (inkl. Klassen ohne Enum-Eintrag).
 *
 *  - **Property-Filter über `BulkQueryEngine.select()`** aus
 *    `@ifc-lite/mutations`. `EntityQuery.whereProperty()` von `@ifc-lite/query`
 *    ist hier NICHT nutzbar: es fragt `store.properties.findByProperty()`, und
 *    `parseColumnar()` lässt die PropertyTable bewusst leer
 *    (`store.properties.count === 0`, siehe Befund B1 in `core/session.ts`).
 *    Der Filter liefert dann immer 0 Treffer und sieht Overlay-Änderungen
 *    ohnehin nicht. `BulkQueryEngine.filterByProperty()` liest dagegen über
 *    `MutablePropertyView.getPropertyValue()` — also Basiswerte plus
 *    Sitzungsänderungen.
 *
 *  - **Wertvergleich:** `BulkQueryEngine` vergleicht typgleich (String gegen
 *    String, Zahl gegen Zahl). Eine Texteingabe „3" fände deshalb keine
 *    numerische 3. Deshalb wird der Eingabewert in seine plausiblen Varianten
 *    aufgefächert und die Treffermengen werden vereinigt.
 *
 *  - **„!=":** die Engine lässt `null` grundsätzlich durchfallen, Objekte ohne
 *    die Property wären also nie Treffer. Fachlich erwartet man das Gegenteil,
 *    deshalb wird „!=" als Komplement der Gleichheitsmenge gebildet.
 */
import { BulkQueryEngine, type PropertyFilter } from "@ifc-lite/mutations";
import type { PropertyValue } from "@ifc-lite/data";
import type { ModelSession } from "../../core/session";
import { parseNumber } from "../inspector/values";

export type QueryOperator = "=" | "!=" | "enthält";

export const QUERY_OPERATORS: ReadonlyArray<QueryOperator> = [
  "=",
  "!=",
  "enthält",
];

export interface QuerySpec {
  /** Roher Typschlüssel aus `entityIndex.byType` (z. B. „IFCWALL"). */
  ifcClass: string;
  psetName: string;
  propName: string;
  operator: QueryOperator;
  value: string;
}

export interface TypeOption {
  /** Schlüssel im Byte-Index — Wert des Eingabefelds. */
  raw: string;
  /** Anzeigename in Schreibweise des Schemas (z. B. „IfcWall"). */
  label: string;
  count: number;
}

/**
 * Klassen, die im Modell vorkommen und adressierbare Objekte enthalten.
 * Als Kriterium dient eine gesetzte GlobalId — damit fallen Geometrie- und
 * Hilfsentities (IfcCartesianPoint & Co.) heraus.
 */
export function modelTypes(session: ModelSession): TypeOption[] {
  const options: TypeOption[] = [];
  for (const [raw, ids] of session.store.entityIndex.byType) {
    const first = ids[0];
    if (first === undefined) continue;
    if (!session.store.entities.getGlobalId(first)) continue;
    options.push({
      raw,
      label: session.store.entities.getTypeName(first) || raw,
      count: ids.length,
    });
  }
  return options.sort((a, b) => a.label.localeCompare(b.label, "de"));
}

/** Ist die Abfrage ausführbar? (Klasse Pflicht, Filter nur vollständig.) */
export function isRunnable(spec: QuerySpec): boolean {
  if (!spec.ifcClass.trim()) return false;
  return !hasPartialFilter(spec);
}

/** Filterfelder teilweise gefüllt — dann ist die Abfrage noch nicht gültig. */
export function hasPartialFilter(spec: QuerySpec): boolean {
  const filled = [spec.psetName, spec.propName, spec.value].filter((text) =>
    text.trim(),
  ).length;
  return filled > 0 && filled < 3;
}

/** Plausible Typvarianten der Texteingabe (String immer, Zahl/Bool wenn passend). */
function valueVariants(text: string): PropertyValue[] {
  const variants: PropertyValue[] = [text];
  const numeric = parseNumber(text);
  if (numeric !== null) variants.push(numeric);
  const lower = text.trim().toLowerCase();
  if (lower === "ja" || lower === "true" || lower === ".t.") variants.push(true);
  if (lower === "nein" || lower === "false" || lower === ".f.")
    variants.push(false);
  return variants;
}

function engineOf(session: ModelSession): BulkQueryEngine {
  return new BulkQueryEngine(
    session.store.entities,
    session.view,
    session.store.spatialHierarchy ?? null,
    session.store.properties ?? null,
    session.store.strings,
  );
}

/** Vereinigung der Treffer über alle Wertvarianten. */
function selectAny(
  engine: BulkQueryEngine,
  candidates: readonly number[],
  base: Omit<PropertyFilter, "value">,
  values: readonly PropertyValue[],
): Set<number> {
  const hits = new Set<number>();
  for (const value of values) {
    for (const id of engine.select({
      expressIds: [...candidates],
      propertyFilters: [{ ...base, value }],
    })) {
      hits.add(id);
    }
  }
  return hits;
}

/** Auswahl gemäß Abfrage. Leeres Ergebnis, wenn die Abfrage unvollständig ist. */
export function runQuery(
  session: ModelSession,
  spec: QuerySpec,
): number[] {
  if (!isRunnable(spec)) return [];
  const key = spec.ifcClass.trim().toUpperCase();
  const candidates = (session.store.entityIndex.byType.get(key) ?? []).filter(
    (id) => !session.isDeleted(id),
  );
  const psetName = spec.psetName.trim();
  const propName = spec.propName.trim();
  if (!psetName || !propName) return candidates;

  const engine = engineOf(session);
  const variants = valueVariants(spec.value);
  if (spec.operator === "enthält") {
    // CONTAINS ist in der Engine rein textlich — nur die String-Variante nutzen.
    return [
      ...selectAny(
        engine,
        candidates,
        { psetName, propName, operator: "CONTAINS" },
        [spec.value],
      ),
    ];
  }
  const equal = selectAny(
    engine,
    candidates,
    { psetName, propName, operator: "=" },
    variants,
  );
  return spec.operator === "="
    ? candidates.filter((id) => equal.has(id))
    : candidates.filter((id) => !equal.has(id));
}
