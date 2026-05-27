import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import {
  OBJECT_INFO_PSET_NAME,
  type NativeIfcDocument,
  type ObjectInfoIdDefinition,
  type ObjectInfoIdReference,
  type ObjectInfoIndex,
  type ObjectInfoValidationFinding,
} from "@/ifc";

import { styles } from "./styles";
import { Button, CollapsibleSection, LabeledInput } from "./ui";

export function ObjectInfoPanel({
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
  onSelectEntity(id: number): void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = normalizeSearch(query);
  const visibleFindings = useMemo(
    () =>
      findings
        .filter((finding) => matchesFinding(finding, normalizedQuery))
        .slice(0, 200),
    [findings, normalizedQuery],
  );
  const visibleDefinitions = useMemo(
    () =>
      index.definitions
        .filter((definition) => matchesDefinition(definition, normalizedQuery))
        .slice(0, 240),
    [index.definitions, normalizedQuery],
  );
  const visibleReferences = useMemo(
    () =>
      index.references
        .filter((reference) => matchesReference(reference, normalizedQuery))
        .slice(0, 240),
    [index.references, normalizedQuery],
  );
  const errorCount = findings.filter(
    (finding) => finding.severity === "error",
  ).length;
  const warningCount = findings.filter(
    (finding) => finding.severity === "warning",
  ).length;
  const infoCount = findings.filter(
    (finding) => finding.severity === "info",
  ).length;

  return (
    <View style={styles.console}>
      <View style={styles.diffHeader}>
        <View style={styles.diffHeaderText}>
          <Text style={styles.infoTitle}>Objektinfo: IDs</Text>
          <Text style={styles.empty}>
            {index.definitions.length.toLocaleString()} Objektinfo-IDs /{" "}
            {index.references.length.toLocaleString()} ID-Referenzen /{" "}
            {findings.length.toLocaleString()} Findings
          </Text>
        </View>
      </View>

      <ScrollView style={styles.panelScroll}>
        <View style={styles.editBlock}>
          <Text style={styles.treeMeta}>
            Registry: {OBJECT_INFO_PSET_NAME}._ID. Referenzen: Properties mit
            Suffix ID, ohne _ID.
          </Text>
          <LabeledInput label="Filter" value={query} onChangeText={setQuery} />
        </View>

        <View style={styles.diffSummaryGrid}>
          <SummaryCard label="Fehler" value={errorCount} />
          <SummaryCard label="Warnungen" value={warningCount} />
          <SummaryCard label="Info" value={infoCount} />
          <SummaryCard
            label="Externe _ID"
            value={index.externalDefinitions.length}
          />
        </View>

        <CollapsibleSection
          defaultOpen
          title="Findings"
          meta={`${visibleFindings.length.toLocaleString()} sichtbar`}
        >
          {visibleFindings.length ? (
            <View style={styles.catalogFindingStack}>
              {visibleFindings.map((finding) => (
                <FindingRow
                  document={document}
                  finding={finding}
                  key={finding.id}
                  selectedId={selectedId}
                  onSelectEntity={onSelectEntity}
                />
              ))}
            </View>
          ) : (
            <Text style={styles.empty}>Keine Findings fuer diesen Filter.</Text>
          )}
        </CollapsibleSection>

        <CollapsibleSection
          defaultOpen
          title="Objektinfo-Registry"
          meta={`${visibleDefinitions.length.toLocaleString()} sichtbar`}
        >
          {visibleDefinitions.length ? (
            <View style={styles.catalogFindingStack}>
              {visibleDefinitions.map((definition) => (
                <DefinitionRow
                  definition={definition}
                  key={`${definition.entityId}:${definition.propertyId}`}
                  selected={definition.entityId === selectedId}
                  onSelectEntity={onSelectEntity}
                />
              ))}
            </View>
          ) : (
            <Text style={styles.empty}>Keine Objektinfo-IDs gefunden.</Text>
          )}
        </CollapsibleSection>

        <CollapsibleSection
          title="ID-Referenzen"
          meta={`${visibleReferences.length.toLocaleString()} sichtbar`}
        >
          {visibleReferences.length ? (
            <View style={styles.catalogFindingStack}>
              {visibleReferences.map((reference) => (
                <ReferenceRow
                  key={`${reference.entityId}:${reference.propertyId}`}
                  reference={reference}
                  selected={reference.entityId === selectedId}
                  onSelectEntity={onSelectEntity}
                />
              ))}
            </View>
          ) : (
            <Text style={styles.empty}>Keine ID-Referenzen gefunden.</Text>
          )}
        </CollapsibleSection>
      </ScrollView>
    </View>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.diffSummaryCard}>
      <Text style={styles.diffSummaryTitle}>{label}</Text>
      <Text style={styles.diffSummaryText}>{value.toLocaleString()}</Text>
    </View>
  );
}

function FindingRow({
  document,
  finding,
  selectedId,
  onSelectEntity,
}: {
  document: NativeIfcDocument;
  finding: ObjectInfoValidationFinding;
  selectedId: number;
  onSelectEntity(id: number): void;
}) {
  const targetEntityId =
    finding.definitions?.[0]?.entityId ??
    finding.externalDefinitions?.[0]?.entityId;
  const selected = finding.entityId === selectedId;
  return (
    <View style={[styles.catalogFinding, selected && styles.treeItemSelected]}>
      <Text style={styles.diffSummaryTitle}>
        {finding.severity.toUpperCase()} / {finding.kind}
      </Text>
      <Text style={styles.diffSummaryText}>{finding.message}</Text>
      <Text style={styles.treeMeta} numberOfLines={1}>
        {finding.value ? `${finding.value} / ` : ""}
        {finding.entityId
          ? entityLabel(document, finding.entityId)
          : "Dokument"}
      </Text>
      <View style={styles.actions}>
        {finding.entityId ? (
          <Button
            label="Objekt oeffnen"
            onPress={() => onSelectEntity(finding.entityId as number)}
          />
        ) : null}
        {targetEntityId ? (
          <Button
            label="Ziel oeffnen"
            onPress={() => onSelectEntity(targetEntityId)}
          />
        ) : null}
      </View>
    </View>
  );
}

function DefinitionRow({
  definition,
  selected,
  onSelectEntity,
}: {
  definition: ObjectInfoIdDefinition;
  selected: boolean;
  onSelectEntity(id: number): void;
}) {
  return (
    <Pressable
      onPress={() => onSelectEntity(definition.entityId)}
      style={({ pressed }) => [
        styles.catalogFinding,
        selected && styles.treeItemSelected,
        pressed && styles.segmentPressed,
      ]}
    >
      <Text style={styles.diffSummaryTitle}>{definition.value || "-"}</Text>
      <Text style={styles.treeMeta} numberOfLines={1}>
        #{definition.entityId} {definition.entityType}{" "}
        {definition.entityName || ""}
      </Text>
      <Text style={styles.diffSummaryText}>
        #{definition.psetId} {definition.psetName} / #{definition.propertyId}{" "}
        {definition.propertyName}
      </Text>
    </Pressable>
  );
}

function ReferenceRow({
  reference,
  selected,
  onSelectEntity,
}: {
  reference: ObjectInfoIdReference;
  selected: boolean;
  onSelectEntity(id: number): void;
}) {
  const resolved = reference.targetDefinitions[0]?.entityId;
  const external = reference.externalDefinitions[0]?.entityId;
  return (
    <View style={[styles.catalogFinding, selected && styles.treeItemSelected]}>
      <Text style={styles.diffSummaryTitle}>{reference.value || "-"}</Text>
      <Text style={styles.treeMeta} numberOfLines={1}>
        #{reference.entityId} {reference.entityType}{" "}
        {reference.entityName || ""}
      </Text>
      <Text style={styles.diffSummaryText}>
        {reference.psetName}.{reference.propertyName}
      </Text>
      <Text style={styles.treeMeta} numberOfLines={1}>
        {resolved
          ? `Objektinfo-Ziel #${resolved}`
          : external
            ? `Externe _ID-Familie #${external}`
            : "Kein Ziel gefunden"}
      </Text>
      <View style={styles.actions}>
        <Button
          label="Objekt oeffnen"
          onPress={() => onSelectEntity(reference.entityId)}
        />
        {resolved ? (
          <Button
            label="Ziel oeffnen"
            onPress={() => onSelectEntity(resolved)}
          />
        ) : external ? (
          <Button
            label="Extern oeffnen"
            onPress={() => onSelectEntity(external)}
          />
        ) : null}
      </View>
    </View>
  );
}

function matchesFinding(
  finding: ObjectInfoValidationFinding,
  normalizedQuery: string,
) {
  if (!normalizedQuery) {
    return true;
  }
  return [
    finding.kind,
    finding.message,
    finding.propertyName,
    finding.psetName,
    finding.value,
    finding.entityId ? `#${finding.entityId}` : "",
  ].some((value) => normalizeSearch(value ?? "").includes(normalizedQuery));
}

function matchesDefinition(
  definition: ObjectInfoIdDefinition,
  normalizedQuery: string,
) {
  if (!normalizedQuery) {
    return true;
  }
  return [
    definition.value,
    definition.entityName,
    definition.entityType,
    definition.propertyName,
    definition.psetName,
    `#${definition.entityId}`,
  ].some((value) => normalizeSearch(value).includes(normalizedQuery));
}

function matchesReference(
  reference: ObjectInfoIdReference,
  normalizedQuery: string,
) {
  if (!normalizedQuery) {
    return true;
  }
  return [
    reference.value,
    reference.entityName,
    reference.entityType,
    reference.propertyName,
    reference.psetName,
    `#${reference.entityId}`,
  ].some((value) => normalizeSearch(value).includes(normalizedQuery));
}

function entityLabel(document: NativeIfcDocument, entityId: number) {
  const entity = document.entityById.get(entityId);
  return entity
    ? `#${entityId} ${entity.type} ${entity.name || ""}`
    : `#${entityId}`;
}

function normalizeSearch(value = "") {
  return value.trim().toLowerCase();
}
