import { StyleSheet, Text, View } from "react-native";

export interface ThatOpenViewerProps {
  fileName: string;
  ifcBytes?: ArrayBuffer | null;
  ifcText: string;
  selectedId: number;
  selectedName?: string;
  onLog?(line: string): void;
  onMoveSelected?(delta: { x?: number; y?: number; z?: number }): void;
  onSelect(id: number, source?: string): void;
}

export default function ThatOpenViewer({ fileName }: ThatOpenViewerProps) {
  return (
    <View style={styles.fallback}>
      <Text style={styles.title}>ThatOpen Viewer</Text>
      <Text style={styles.text}>{fileName}</Text>
      <Text style={styles.text}>
        The ThatOpen WebGL viewer is available in the web build.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: "center",
    backgroundColor: "#f8fafc",
    borderColor: "#d4d4d8",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 440,
    padding: 24,
  },
  text: {
    color: "#52525b",
    fontSize: 13,
    marginTop: 6,
    textAlign: "center",
  },
  title: {
    color: "#18181b",
    fontSize: 18,
    fontWeight: "900",
  },
});
