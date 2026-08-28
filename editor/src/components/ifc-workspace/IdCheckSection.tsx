import { useMemo, useState, type ReactNode } from "react";

import { Textarea } from "@/components/ui/textarea";
import {
    OBJECT_INFO_PSET_NAME,
    type NativeIfcDocument,
    type NativeIfcEntity,
    type ObjectInfoIdDefinition,
    type ObjectInfoIndex,
} from "@/ifc";
import { cn } from "@/lib/utils";

import {
    Badge,
    Button,
    CollapsibleSection,
    shortType,
    type BadgeTone,
} from "./ui";

/**
 * Interaktive ID-Prüfung: Objektinfo-IDs, #STEP-IDs und GlobalIds live gegen
 * das Modell prüfen (Existenz, Eindeutigkeit, Referenzen). Eingebettet im
 * Panel „IDS-Prüfung“; IdChip und RowList nutzt auch das Objektinfo-Panel.
 */

const CHECK_TOKEN_CAP = 120;
const CHECK_MATCHES_CAP = 6;
const GLOBAL_ID_PATTERN = /^[0-9A-Za-z_$]{22}$/;

type IdCheckKind = "globalid" | "objektinfo" | "step";

type IdCheckStatus =
  | "case-mismatch"
  | "duplicate"
  | "external"
  | "missing"
  | "ok";

interface IdCheckMatch {
  entityId: number;
  primary: string;
  secondary?: string;
}

interface IdCheckResult {
  kind: IdCheckKind;
  matches: IdCheckMatch[];
  note?: string;
  status: IdCheckStatus;
  token: string;
}

interface IdCheckLookups {
  definitionsByLowercaseValue: Map<string, ObjectInfoIdDefinition[]>;
  entitiesByGlobalId: Map<string, NativeIfcEntity[]>;
  referenceCountByValue: Map<string, number>;
}

const CHECK_KIND_LABELS: Record<IdCheckKind, string> = {
  globalid: "GlobalId",
  objektinfo: "Objektinfo-ID",
  step: "STEP-ID",
};

const CHECK_STATUS_META: Record<
  IdCheckStatus,
  { label: string; tone: BadgeTone }
> = {
  "case-mismatch": { label: "Schreibweise", tone: "warning" },
  duplicate: { label: "Duplikat", tone: "danger" },
  external: { label: "Extern", tone: "info" },
  missing: { label: "Nicht gefunden", tone: "danger" },
  ok: { label: "OK", tone: "success" },
};

export function IdCheckSection({
  defaultOpen = true,
  document,
  index,
  selectedId,
  onSelectEntity,
}: {
  defaultOpen?: boolean;
  document: NativeIfcDocument;
  index: ObjectInfoIndex;
  selectedId: number;
  onSelectEntity(id: number): void;
}) {
  const [input, setInput] = useState("");

  const entitiesByGlobalId = useMemo(() => {
    const map = new Map<string, NativeIfcEntity[]>();
    for (const entity of document.entities) {
      if (!entity.globalId) {
        continue;
      }
      const list = map.get(entity.globalId);
      if (list) {
        list.push(entity);
      } else {
        map.set(entity.globalId, [entity]);
      }
    }
    return map;
  }, [document.entities]);

  const definitionsByLowercaseValue = useMemo(() => {
    const map = new Map<string, ObjectInfoIdDefinition[]>();
    for (const [value, definitions] of index.definitionsByValue) {
      const key = value.toLowerCase();
      const list = map.get(key);
      if (list) {
        list.push(...definitions);
      } else {
        map.set(key, [...definitions]);
      }
    }
    return map;
  }, [index.definitionsByValue]);

  const referenceCountByValue = useMemo(() => {
    const counts = new Map<string, number>();
    for (const reference of index.references) {
      if (!reference.value) {
        continue;
      }
      counts.set(reference.value, (counts.get(reference.value) ?? 0) + 1);
    }
    return counts;
  }, [index.references]);

  const tokens = useMemo(() => tokenizeIdInput(input), [input]);
  const results = useMemo(
    () =>
      tokens.map((token) =>
        checkIdToken(token, document, index, {
          definitionsByLowercaseValue,
          entitiesByGlobalId,
          referenceCountByValue,
        }),
      ),
    [
      tokens,
      document,
      index,
      definitionsByLowercaseValue,
      entitiesByGlobalId,
      referenceCountByValue,
    ],
  );

  const okCount = results.filter((result) => result.status === "ok").length;
  const problemCount = results.filter(
    (result) => result.status === "duplicate" || result.status === "missing",
  ).length;
  const hintCount = results.length - okCount - problemCount;

  return (
    <CollapsibleSection
      defaultOpen={defaultOpen}
      meta="Objektinfo-ID, #STEP-ID oder GlobalId"
      title="ID-Prüfung"
    >
      <div className="grid gap-1.5">
        <Textarea
          aria-label="IDs prüfen"
          className="min-h-16 font-mono text-xs"
          placeholder={
            "IDs eingeben — mehrere getrennt durch Komma oder Zeile.\nz. B. TGA-001, #4711, 1kTvXnbbzCWw8lcMd1dR4o"
          }
          value={input}
          onChange={(event) => setInput(event.currentTarget.value)}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Prüft Existenz, Eindeutigkeit und Referenzen live
            {tokens.length >= CHECK_TOKEN_CAP
              ? ` · maximal ${CHECK_TOKEN_CAP} IDs`
              : ""}
            .
          </p>
          {input ? (
            <Button
              className="h-6 px-2 text-[11px]"
              variant="ghost"
              onClick={() => setInput("")}
            >
              Leeren
            </Button>
          ) : null}
        </div>
      </div>

      {results.length ? (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="neutral">
              {results.length.toLocaleString("de-DE")} geprüft
            </Badge>
            {okCount ? (
              <Badge tone="success">
                {okCount.toLocaleString("de-DE")} OK
              </Badge>
            ) : null}
            {problemCount ? (
              <Badge tone="danger">
                {problemCount.toLocaleString("de-DE")}{" "}
                {problemCount === 1 ? "Problem" : "Probleme"}
              </Badge>
            ) : null}
            {hintCount ? (
              <Badge tone="warning">
                {hintCount.toLocaleString("de-DE")}{" "}
                {hintCount === 1 ? "Hinweis" : "Hinweise"}
              </Badge>
            ) : null}
          </div>
          <RowList>
            {results.map((result) => (
              <IdCheckResultRow
                key={result.token}
                result={result}
                selectedId={selectedId}
                onSelectEntity={onSelectEntity}
              />
            ))}
          </RowList>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          Noch keine IDs eingegeben.
        </p>
      )}
    </CollapsibleSection>
  );
}

function IdCheckResultRow({
  result,
  selectedId,
  onSelectEntity,
}: {
  result: IdCheckResult;
  selectedId: number;
  onSelectEntity(id: number): void;
}) {
  const meta = CHECK_STATUS_META[result.status];
  const visibleMatches = result.matches.slice(0, CHECK_MATCHES_CAP);
  const hiddenMatches = result.matches.length - visibleMatches.length;
  const selected = result.matches.some(
    (match) => match.entityId === selectedId,
  );
  return (
    <div
      className={cn(
        "grid min-w-0 gap-1 px-2.5 py-2",
        selected && "bg-primary/10",
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <Badge tone={meta.tone}>{meta.label}</Badge>
        <span
          className="min-w-0 flex-1 truncate font-mono text-xs font-medium text-foreground"
          title={result.token}
        >
          {result.token}
        </span>
        <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {CHECK_KIND_LABELS[result.kind]}
        </span>
      </div>
      {result.note ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {result.note}
        </p>
      ) : null}
      {visibleMatches.length ? (
        <div className="grid gap-1">
          {visibleMatches.map((match, matchIndex) => (
            <button
              className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded border border-border/60 bg-muted/30 px-2 py-1 text-left transition-colors hover:border-primary/50 hover:bg-muted/50"
              key={`${match.entityId}:${matchIndex}`}
              title="Objekt öffnen"
              type="button"
              onClick={() => onSelectEntity(match.entityId)}
            >
              <span className="min-w-0 truncate text-[11px] font-medium text-foreground">
                {match.primary}
              </span>
              {match.secondary ? (
                <span className="min-w-0 truncate text-[10px] text-muted-foreground">
                  {match.secondary}
                </span>
              ) : null}
            </button>
          ))}
          {hiddenMatches > 0 ? (
            <p className="text-[11px] text-muted-foreground">
              … {hiddenMatches.toLocaleString("de-DE")} weitere Treffer
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// Nur Komma, Semikolon und Zeilenumbruch trennen — Objektinfo-IDs dürfen
// Leerzeichen enthalten.
function tokenizeIdInput(raw: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const part of raw.split(/[,;\n]+/)) {
    const token = part.trim();
    if (!token || seen.has(token)) {
      continue;
    }
    seen.add(token);
    tokens.push(token);
    if (tokens.length >= CHECK_TOKEN_CAP) {
      break;
    }
  }
  return tokens;
}

function checkIdToken(
  token: string,
  document: NativeIfcDocument,
  index: ObjectInfoIndex,
  lookups: IdCheckLookups,
): IdCheckResult {
  const stepMatch = /^#(\d+)$/.exec(token);
  if (stepMatch) {
    return checkStepToken(token, Number(stepMatch[1]), document, index);
  }

  if (GLOBAL_ID_PATTERN.test(token)) {
    const entities = lookups.entitiesByGlobalId.get(token);
    if (entities?.length) {
      return {
        kind: "globalid",
        matches: entities.map(entityMatch),
        note:
          entities.length > 1
            ? `${entities.length.toLocaleString("de-DE")} Entitäten teilen diese GlobalId.`
            : "GlobalId ist eindeutig.",
        status: entities.length > 1 ? "duplicate" : "ok",
        token,
      };
    }
  }

  const definitions = index.definitionsByValue.get(token) ?? [];
  if (definitions.length) {
    const referenceCount = lookups.referenceCountByValue.get(token) ?? 0;
    const referenceNote = referenceCount
      ? `${referenceCount.toLocaleString("de-DE")} eingehende ${referenceCount === 1 ? "Referenz" : "Referenzen"}`
      : "keine eingehenden Referenzen";
    return {
      kind: "objektinfo",
      matches: definitions.map(definitionMatch),
      note:
        definitions.length > 1
          ? `${definitions.length.toLocaleString("de-DE")} Definitionen mit dieser ID · ${referenceNote}.`
          : `Eindeutig definiert · ${referenceNote}.`,
      status: definitions.length > 1 ? "duplicate" : "ok",
      token,
    };
  }

  if (/^\d+$/.test(token) && document.entityById.has(Number(token))) {
    const result = checkStepToken(token, Number(token), document, index);
    return {
      ...result,
      note: `Keine Objektinfo-ID mit diesem Wert — als STEP-ID interpretiert. ${result.note ?? ""}`.trim(),
    };
  }

  const external = index.externalDefinitionsByValue.get(token) ?? [];
  if (external.length) {
    return {
      kind: "objektinfo",
      matches: external.map(definitionMatch),
      note: `Nur als _ID außerhalb von ${OBJECT_INFO_PSET_NAME} definiert.`,
      status: "external",
      token,
    };
  }

  const caseMatches =
    lookups.definitionsByLowercaseValue.get(token.toLowerCase()) ?? [];
  if (caseMatches.length) {
    const values = [
      ...new Set(caseMatches.map((definition) => definition.value)),
    ];
    return {
      kind: "objektinfo",
      matches: caseMatches.map(definitionMatch),
      note: `Groß-/Kleinschreibung weicht ab — gefunden als ${values
        .map((value) => `„${value}“`)
        .join(", ")}.`,
      status: "case-mismatch",
      token,
    };
  }

  return {
    kind: "objektinfo",
    matches: [],
    note: "Keine Objektinfo-ID, externe _ID, STEP-ID oder GlobalId mit diesem Wert.",
    status: "missing",
    token,
  };
}

function checkStepToken(
  token: string,
  entityId: number,
  document: NativeIfcDocument,
  index: ObjectInfoIndex,
): IdCheckResult {
  const entity = document.entityById.get(entityId);
  if (!entity) {
    return {
      kind: "step",
      matches: [],
      note: `Keine Entität #${entityId} im Dokument.`,
      status: "missing",
      token,
    };
  }
  const definitions = index.definitionsByEntity.get(entityId) ?? [];
  const references = index.referencesByEntity.get(entityId) ?? [];
  const noteParts = [
    definitions.length
      ? `Objektinfo-ID: ${definitions
          .map((definition) => definition.value || "leer")
          .join(", ")}`
      : "Keine Objektinfo-ID am Objekt",
  ];
  if (references.length) {
    noteParts.push(
      `${references.length.toLocaleString("de-DE")} ausgehende ID-${references.length === 1 ? "Referenz" : "Referenzen"}`,
    );
  }
  return {
    kind: "step",
    matches: [entityMatch(entity)],
    note: `${noteParts.join(" · ")}.`,
    status: "ok",
    token,
  };
}

function entityMatch(entity: NativeIfcEntity): IdCheckMatch {
  return {
    entityId: entity.id,
    primary: `#${entity.id} ${shortType(entity.type)}${entity.name ? ` ${entity.name}` : ""}`,
    secondary: entity.globalId ? `GlobalId ${entity.globalId}` : undefined,
  };
}

function definitionMatch(definition: ObjectInfoIdDefinition): IdCheckMatch {
  return {
    entityId: definition.entityId,
    primary: `#${definition.entityId} ${shortType(definition.entityType)}${
      definition.entityName ? ` ${definition.entityName}` : ""
    }`,
    secondary: `${definition.psetName}.${definition.propertyName}`,
  };
}

export function IdChip({
  label,
  onSelect,
  title,
}: {
  label: string;
  onSelect(): void;
  title: string;
}) {
  return (
    <button
      className="inline-flex h-5 shrink-0 items-center rounded border border-border/70 bg-muted/40 px-1.5 font-mono text-[10px] font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
      title={title}
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      {label}
    </button>
  );
}

export function RowList({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-border/50 overflow-hidden rounded-md border border-border/60 bg-card">
      {children}
    </div>
  );
}
