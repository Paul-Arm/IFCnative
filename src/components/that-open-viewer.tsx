import { StyleSheet, Text, View } from "react-native";

export interface ViewerCoordinatePick {
  entityId?: number;
  globalId?: string;
  localId?: number;
  source: "thatopen";
  x: number;
  y: number;
  z: number;
}

export interface ThatOpenViewerProps {
  fileName: string;
  ifcBytes?: ArrayBuffer | null;
  ifcText: string;
  isDraftPreview?: boolean;
  selectedId: number;
  selectedName?: string;
  onLog?(line: string): void;
  onMoveSelected?(delta: ViewerMoveDelta): void;
  onPickCoordinates?(pick: ViewerCoordinatePick): void;
  onSelect(id: number, source?: string, globalId?: string): void;
}

export interface ViewerMoveDelta {
  x?: number;
  y?: number;
  z?: number;
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
    fontSize: 12,
    marginTop: 6,
    textAlign: "center",
  },
  title: {
    color: "#18181b",
    fontSize: 16,
  },
});
