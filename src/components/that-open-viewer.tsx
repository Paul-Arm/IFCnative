import { StyleSheet, Text, View } from "react-native";

export interface ViewerCoordinatePick {
  documentId?: string;
  entityId?: number;
  fileName?: string;
  globalId?: string;
  localId?: number;
  modelId?: string;
  source: "thatopen";
  x: number;
  y: number;
  z: number;
}

export interface ThatOpenViewerModel {
  documentId: string;
  fileName: string;
  ifcBytes?: ArrayBuffer | null;
  ifcFile?: File | null;
  ifcText: string;
  revision: number;
  selectedId: number;
  selectedName?: string;
}

export interface ThatOpenViewerProps {
  activeDocumentId: string;
  activeModelDeferredReason?: string;
  activeModelFileName?: string;
  activeModelLoaded?: boolean;
  models: ThatOpenViewerModel[];
  onLoadActiveModel?(): void;
  onLog?(line: string): void;
  onMoveSelected?(delta: ViewerMoveDelta): void;
  onPickCoordinates?(pick: ViewerCoordinatePick): void;
  onSelect(
    id: number,
    source?: string,
    globalId?: string,
    documentId?: string,
  ): void;
}

export interface ViewerMoveDelta {
  x?: number;
  y?: number;
  z?: number;
}

export default function ThatOpenViewer({
  activeDocumentId,
  activeModelDeferredReason,
  activeModelFileName,
  activeModelLoaded = true,
  models,
  onLoadActiveModel,
}: ThatOpenViewerProps) {
  const activeModel =
    models.find((model) => model.documentId === activeDocumentId) ?? models[0];
  return (
    <View style={styles.fallback}>
      <Text style={styles.title}>ThatOpen Viewer</Text>
      <Text style={styles.text}>
        {activeModel?.fileName ?? activeModelFileName ?? "No IFC loaded"}
      </Text>
      {!activeModelLoaded && activeModelDeferredReason ? (
        <Text style={styles.text}>{activeModelDeferredReason}</Text>
      ) : null}
      {!activeModelLoaded && onLoadActiveModel ? (
        <Text style={styles.text}>
          3D loading is available in the web build.
        </Text>
      ) : null}
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
