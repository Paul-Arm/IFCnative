import { useMemo } from "react";
import { ScrollView, Text, View } from "react-native";

import type { NativeIfcDocument } from "@/ifc";
import {
  previewEntityAwareDiffLines,
  summarizeEntityAwareDiff,
} from "@/ifc/entityDiff";

import { styles } from "./styles";
import { Button } from "./ui";

export function DiffPanel({
  currentText,
  pendingSummary,
  pendingText,
  onApply,
  onDiscard,
}: {
  currentText: string;
  pendingSummary: string;
  pendingText: string;
  onApply(): void;
  onDiscard(): void;
}) {
  const lines = useMemo(
    () =>
      pendingText ? previewEntityAwareDiffLines(currentText, pendingText) : [],
    [currentText, pendingText],
  );
  const summary = useMemo(
    () =>
      pendingText
        ? summarizeEntityAwareDiff(currentText, pendingText)
        : undefined,
    [currentText, pendingText],
  );
  const added = lines.filter((line) => line.kind === "add").length;
  const removed = lines.filter((line) => line.kind === "remove").length;

  if (!pendingText) {
    return (
      <View style={styles.diffEmpty}>
        <Text style={styles.infoTitle}>No pending IFC changes</Text>
        <Text style={styles.empty}>
          Builder, inspector and graph edits create a draft first. Review this
          diff, then apply it before export.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.console}>
      <View style={styles.diffHeader}>
        <View style={styles.diffHeaderText}>
          <Text style={styles.infoTitle}>{pendingSummary}</Text>
          <Text style={styles.empty}>
            {summary?.changedEntities ?? 0} changed /{" "}
            {summary?.addedEntities ?? 0} added /{" "}
            {summary?.removedEntities ?? 0} removed STEP entities. IFC export
            stays disabled until this draft is applied or discarded.
          </Text>
        </View>
        <View style={styles.actions}>
          <Button label="Apply" primary onPress={onApply} />
          <Button label="Discard" onPress={onDiscard} />
        </View>
      </View>
      {summary &&
      (summary.relationshipChanges.length > 0 ||
        summary.placementChanges.length > 0 ||
        summary.geometryChanges.length > 0) ? (
        <View style={styles.diffSummaryGrid}>
          {summary.placementChanges.length > 0 ? (
            <View style={styles.diffSummaryCard}>
              <Text style={styles.diffSummaryTitle}>Placement changes</Text>
              {summary.placementChanges.slice(0, 5).map((change) => (
                <Text key={change.pointId} style={styles.diffSummaryText}>
                  #{change.pointId}
                  {formatPlacementProducts(change)} XYZ{" "}
                  {formatPoint(change.before)} → {formatPoint(change.after)} Δ{" "}
                  {formatPoint(change.delta)}
                </Text>
              ))}
            </View>
          ) : null}
          {summary.relationshipChanges.length > 0 ? (
            <View style={styles.diffSummaryCard}>
              <Text style={styles.diffSummaryTitle}>Relationship changes</Text>
              {summary.relationshipChanges.slice(0, 5).map((change) => (
                <Text
                  key={`${change.action}-${change.id}`}
                  style={styles.diffSummaryText}
                >
                  #{change.id} {change.type} {change.action}:{" "}
                  {change.after ?? change.before}
                </Text>
              ))}
            </View>
          ) : null}
          {summary.geometryChanges.length > 0 ? (
            <View style={styles.diffSummaryCard}>
              <Text style={styles.diffSummaryTitle}>Geometry changes</Text>
              {summary.geometryChanges.slice(0, 5).map((change) => (
                <Text
                  key={`${change.action}-${change.id}`}
                  style={styles.diffSummaryText}
                >
                  #{change.id}
                  {formatGeometryProducts(change)} {change.action}:{" "}
                  {change.after ?? change.before}
                </Text>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
      <ScrollView style={styles.diffLines}>
        <Text style={styles.diffLine}>
          {" "}
          Raw hunks: {added} additions / {removed} removals
        </Text>
        {lines.map((line, index) => (
          <Text
            key={`${line.kind}-${index}-${line.text}`}
            style={[
              styles.diffLine,
              line.kind === "add" && styles.diffLineAdd,
              line.kind === "remove" && styles.diffLineRemove,
            ]}
          >
            {line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "}{" "}
            {line.text}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}

function formatPoint(point: [number, number, number]) {
  return `(${point
    .map((value) =>
      Number(value)
        .toFixed(3)
        .replace(/\.0+$/, "")
        .replace(/(\.\d*?)0+$/, "$1"),
    )
    .join(", ")})`;
}

function formatPlacementProducts(
  change: ReturnType<
    typeof summarizeEntityAwareDiff
  >["placementChanges"][number],
) {
  if (!change.affectedProducts.length) {
    return "";
  }
  const labels = change.affectedProducts
    .slice(0, 3)
    .map(
      (product) =>
        `#${product.id} ${product.type}${product.name ? ` '${product.name}'` : ""}`,
    )
    .join(", ");
  return ` (${labels}${change.affectedProducts.length > 3 ? " …" : ""})`;
}

function formatGeometryProducts(
  change: ReturnType<
    typeof summarizeEntityAwareDiff
  >["geometryChanges"][number],
) {
  if (!change.affectedProducts.length) {
    return "";
  }
  const labels = change.affectedProducts
    .slice(0, 3)
    .map(
      (product) =>
        `#${product.id} ${product.type}${product.name ? ` '${product.name}'` : ""}`,
    )
    .join(", ");
  return ` (${labels}${change.affectedProducts.length > 3 ? " …" : ""})`;
}

export function ConsolePanel({
  lines,
  onClear,
}: {
  lines: string[];
  onClear(): void;
}) {
  return (
    <View style={styles.console}>
      <Button label="Clear" onPress={onClear} />
      <ScrollView style={styles.consoleLines}>
        {lines.map((line, index) => (
          <Text key={`${line}-${index}`} style={styles.consoleLine}>
            {line}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}

export function DiagnosticsPanel({ document }: { document: NativeIfcDocument }) {
  return (
    <ScrollView style={styles.panelScroll}>
      {document.diagnostics.map((diagnostic) => (
        <Text key={diagnostic} style={styles.monoLine}>
          {diagnostic}
        </Text>
      ))}
    </ScrollView>
  );
}
