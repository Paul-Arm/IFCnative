import {
  type NativeIfcDocument,
  type ObjectInfoIndex,
  type ObjectInfoValidationFinding,
} from "@/ifc";

import { Badge, InfoSection } from "../ui";
import { CappedItems, EntityChip, SubHeading, TextLine } from "./shared";

/* ------------------------------------------------------------------ */
/* Objektinfo-Zusammenfassung (Tab "Übersicht")                        */
/* ------------------------------------------------------------------ */

export function ObjectInfoSummary({
  document,
  findings,
  index,
  selectedId,
  onSelectEntity,
}: {
  document: NativeIfcDocument;
  findings: ObjectInfoValidationFinding[];
  index: ObjectInfoIndex;
  selectedId: number;
  onSelectEntity(entityId: number): void;
}) {
  const definitions = index.definitionsByEntity.get(selectedId) ?? [];
  const outgoing = index.referencesByEntity.get(selectedId) ?? [];
  const incoming = index.references.filter(
    (reference) =>
      reference.targetDefinitions.some(
        (definition) => definition.entityId === selectedId,
      ) ||
      reference.externalDefinitions.some(
        (definition) => definition.entityId === selectedId,
      ),
  );
  const localFindings = findings.filter((finding) =>
    objectInfoFindingTouchesEntity(finding, selectedId),
  );

  return (
    <InfoSection title="Objektinfo">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={localFindings.length ? "warning" : "success"}>
          {localFindings.length.toLocaleString("de-DE")} Findings
        </Badge>
        <span className="text-[11px] text-muted-foreground">
          {definitions.length.toLocaleString("de-DE")} IDs ·{" "}
          {outgoing.length.toLocaleString("de-DE")} ausgehend ·{" "}
          {incoming.length.toLocaleString("de-DE")} eingehend
        </span>
      </div>

      <SubHeading>Objektinfo-IDs</SubHeading>
      {definitions.length ? (
        <CappedItems
          items={definitions}
          limit={10}
          renderItem={(definition) => (
            <div
              key={definition.propertyId}
              className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-md bg-muted/30 px-2 py-1 text-xs"
            >
              <span className="font-mono font-medium text-foreground">
                {definition.value || "–"}
              </span>
              <span className="min-w-0 truncate text-muted-foreground">
                #{definition.psetId} {definition.psetName} · #
                {definition.propertyId} {definition.propertyName}
              </span>
            </div>
          )}
        />
      ) : (
        <TextLine>
          Kein ePset_Objektinformationen._ID am ausgewählten Objekt.
        </TextLine>
      )}

      <SubHeading>Ausgehende ID-Referenzen</SubHeading>
      {outgoing.length ? (
        <CappedItems
          items={outgoing}
          limit={15}
          renderItem={(reference) => {
            const target =
              reference.targetDefinitions[0]?.entityId ??
              reference.externalDefinitions[0]?.entityId;
            return (
              <div
                key={reference.propertyId}
                className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md bg-muted/30 px-2 py-1 text-xs"
              >
                <span className="font-mono font-medium text-foreground">
                  {reference.value || "–"}
                </span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {reference.psetName}.{reference.propertyName}
                </span>
                {target ? (
                  <EntityChip
                    document={document}
                    id={target}
                    onSelect={onSelectEntity}
                  />
                ) : (
                  <span className="text-muted-foreground">
                    Kein Ziel gefunden
                  </span>
                )}
              </div>
            );
          }}
        />
      ) : (
        <TextLine>Keine ausgehenden ID-Referenzen.</TextLine>
      )}

      <SubHeading>Eingehende ID-Referenzen</SubHeading>
      {incoming.length ? (
        <CappedItems
          items={incoming}
          limit={15}
          renderItem={(reference) => (
            <div
              key={reference.propertyId}
              className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md bg-muted/30 px-2 py-1 text-xs"
            >
              <span className="font-mono font-medium text-foreground">
                {reference.value || "–"}
              </span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {reference.psetName}.{reference.propertyName}
              </span>
              <EntityChip
                document={document}
                id={reference.entityId}
                onSelect={onSelectEntity}
              />
            </div>
          )}
        />
      ) : (
        <TextLine>Keine eingehenden ID-Referenzen.</TextLine>
      )}

      <SubHeading>Lokale Findings</SubHeading>
      {localFindings.length ? (
        <CappedItems
          items={localFindings}
          limit={10}
          renderItem={(finding) => (
            <div
              key={finding.id}
              className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md bg-muted/30 px-2 py-1 text-xs"
            >
              <Badge
                tone={
                  finding.severity === "error"
                    ? "danger"
                    : finding.severity === "warning"
                      ? "warning"
                      : "info"
                }
              >
                {finding.kind}
              </Badge>
              <span className="min-w-0 flex-1 break-words text-foreground">
                {finding.message}
              </span>
            </div>
          )}
        />
      ) : (
        <TextLine>Keine lokalen Objektinfo-Findings.</TextLine>
      )}
    </InfoSection>
  );
}

function objectInfoFindingTouchesEntity(
  finding: ObjectInfoValidationFinding,
  entityId: number,
) {
  return (
    finding.entityId === entityId ||
    finding.definitions?.some(
      (definition) => definition.entityId === entityId,
    ) ||
    finding.externalDefinitions?.some(
      (definition) => definition.entityId === entityId,
    ) ||
    finding.references?.some((reference) => reference.entityId === entityId)
  );
}
