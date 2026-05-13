import { ScrollView, Text, View } from "react-native";

import type { NativeIfcDocument } from "@/ifc";

import { styles } from "./styles";
import { Button } from "./ui";

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

export function DiagnosticsPanel({
  document,
}: {
  document: NativeIfcDocument;
}) {
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
