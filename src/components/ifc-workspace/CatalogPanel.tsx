import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import {
    catalogObjectLabel,
    normalizeCatalogToken,
    type CatalogValidationFinding,
    type IfcObjectCatalog,
    type NativeIfcDocument,
} from "@/ifc";

import { styles } from "./styles";
import { Button, CollapsibleSection, LabeledInput } from "./ui";

export function CatalogPanel({
  catalog,
  document,
  findings,
  importing,
  selectedCatalogObjectId,
  selectedId,
  onApplyFinding,
  onImportCatalog,
  onSelectCatalogObject,
}: {
  catalog: IfcObjectCatalog | null;
  document: NativeIfcDocument;
  findings: CatalogValidationFinding[];
  importing: boolean;
  selectedCatalogObjectId: string;
  selectedId: number;
  onApplyFinding(finding: CatalogValidationFinding): void;
  onImportCatalog(): Promise<void>;
  onSelectCatalogObject(id: string): void;
}) {
  const [query, setQuery] = useState("");
  const selectedEntity = document.entityById.get(selectedId);
  const selectedObject = catalog?.objectTypes.find(
    (objectType) => objectType.id === selectedCatalogObjectId,
  );
  const visibleObjects = useMemo(() => {
    const token = normalizeCatalogToken(query);
    const objects = catalog?.objectTypes ?? [];
    if (!token) {
      return objects.slice(0, 80);
    }
    return objects
      .filter((objectType) =>
        [
          objectType.name,
          objectType.code,
          objectType.ifcClass,
          objectType.sheetName,
        ]
          .map(normalizeCatalogToken)
          .some((value) => value.includes(token)),
      )
      .slice(0, 120);
  }, [catalog?.objectTypes, query]);
  const quickFixCount = findings.filter((finding) => finding.quickFix).length;

  return (
    <View style={styles.console}>
      <View style={styles.diffHeader}>
        <View style={styles.diffHeaderText}>
          <Text style={styles.infoTitle}>Objektkatalog</Text>
          <Text style={styles.empty}>
            {catalog
              ? `${catalog.objectTypes.length.toLocaleString()} Klassen / ${countProperties(catalog).toLocaleString()} Property-Regeln`
              : "Kein Katalog geladen."}
          </Text>
        </View>
        <Button
          disabled={importing}
          label={importing ? "Import..." : "Import Catalog"}
          primary={!catalog}
          onPress={() => void onImportCatalog()}
        />
      </View>

      {catalog ? (
        <ScrollView style={styles.panelScroll}>
          <CollapsibleSection
            defaultOpen
            title="Auswahl"
            meta={
              selectedEntity ? `#${selectedId} ${selectedEntity.type}` : "-"
            }
          >
            <LabeledInput
              label="Katalogfilter"
              value={query}
              onChangeText={setQuery}
            />
            <ScrollView nestedScrollEnabled style={styles.catalogList}>
              {visibleObjects.map((objectType) => {
                const selected = objectType.id === selectedCatalogObjectId;
                return (
                  <Pressable
                    key={objectType.id}
                    onPress={() => onSelectCatalogObject(objectType.id)}
                    style={({ pressed }) => [
                      styles.catalogItem,
                      selected && styles.treeItemSelected,
                      pressed && styles.segmentPressed,
                    ]}
                  >
                    <Text style={styles.treeTitle} numberOfLines={1}>
                      {catalogObjectLabel(objectType)}
                    </Text>
                    <Text style={styles.treeMeta} numberOfLines={1}>
                      {objectType.ifcClass} /{" "}
                      {objectType.propertyRules.length.toLocaleString()} Regeln
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </CollapsibleSection>

          <CollapsibleSection
            defaultOpen
            title="Pruefung"
            meta={
              selectedObject
                ? `${catalogObjectLabel(selectedObject)} / ${findings.length.toLocaleString()} Findings`
                : "Keine Klasse gewaehlt"
            }
          >
            {selectedObject ? (
              <View style={styles.editBlock}>
                <Text style={styles.infoTitle}>
                  {catalogObjectLabel(selectedObject)}
                </Text>
                <Text style={styles.treeMeta}>
                  Sheet {selectedObject.sheetName}, {selectedObject.ifcClass},
                  Version {selectedObject.version || "-"}
                </Text>
                <Text style={styles.treeMeta}>
                  {selectedObject.propertyRules
                    .filter((rule) => rule.requirement === "required")
                    .length.toLocaleString()}{" "}
                  erforderliche /{" "}
                  {selectedObject.propertyRules.length.toLocaleString()} gesamte
                  Properties
                </Text>
              </View>
            ) : null}

            {findings.length ? (
              <View style={styles.catalogFindingStack}>
                <Text style={styles.empty}>
                  {findings.length.toLocaleString()} Warnungen,{" "}
                  {quickFixCount.toLocaleString()} Quick-Fixes
                </Text>
                {findings.map((finding) => (
                  <View key={finding.id} style={styles.catalogFinding}>
                    <Text style={styles.diffSummaryTitle}>{finding.kind}</Text>
                    <Text style={styles.diffSummaryText}>
                      {finding.message}
                    </Text>
                    {finding.quickFix ? (
                      <Button
                        label={finding.quickFix.label}
                        onPress={() => onApplyFinding(finding)}
                      />
                    ) : null}
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.empty}>
                {selectedObject
                  ? "Keine Katalogwarnungen fuer die aktuelle Kombination."
                  : "Katalogklasse waehlen."}
              </Text>
            )}
          </CollapsibleSection>

          <CollapsibleSection title="Importdiagnose" meta={catalog.fileName}>
            {catalog.diagnostics.map((diagnostic) => (
              <Text key={diagnostic} style={styles.monoLine}>
                {diagnostic}
              </Text>
            ))}
          </CollapsibleSection>
        </ScrollView>
      ) : (
        <View style={styles.diffEmpty}>
          <Text style={styles.infoTitle}>Kein Katalog geladen</Text>
          <Text style={styles.empty}>
            Excel-Datei importieren, danach erscheint die Katalogpruefung.
          </Text>
        </View>
      )}
    </View>
  );
}

function countProperties(catalog: IfcObjectCatalog) {
  return catalog.objectTypes.reduce(
    (total, objectType) => total + objectType.propertyRules.length,
    0,
  );
}
