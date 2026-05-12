import { Pressable, ScrollView, Text, View } from "react-native";

import type {
    NativeIfcDocument,
    NativeIfcEntity,
    NativeIfcTreeNode,
} from "@/ifc";

import { styles } from "./styles";

export function StructurePanel({
  document,
  expanded,
  filteredEntities,
  search,
  selectedId,
  onSelect,
  onToggle,
}: {
  document: NativeIfcDocument;
  expanded: Set<number>;
  filteredEntities: NativeIfcEntity[];
  search: string;
  selectedId: number;
  onSelect(id: number, source?: string): void;
  onToggle(id: number): void;
}) {
  return (
    <ScrollView style={styles.panelScroll}>
      {search.trim() ? (
        filteredEntities.map((entity) => (
          <EntityRow
            entity={entity}
            key={entity.id}
            selected={entity.id === selectedId}
            onPress={() => onSelect(entity.id, "tree")}
          />
        ))
      ) : document.spatialRoots.length ? (
        document.spatialRoots.map((node) => (
          <TreeNode
            document={document}
            expanded={expanded}
            key={node.id}
            node={node}
            selectedId={selectedId}
            onSelect={onSelect}
            onToggle={onToggle}
          />
        ))
      ) : (
        <Text style={styles.empty}>No spatial roots indexed.</Text>
      )}
    </ScrollView>
  );
}

function TreeNode({
  document,
  expanded,
  node,
  selectedId,
  onSelect,
  onToggle,
  depth = 0,
}: {
  document: NativeIfcDocument;
  expanded: Set<number>;
  node: NativeIfcTreeNode;
  selectedId: number;
  onSelect(id: number, source?: string): void;
  onToggle(id: number): void;
  depth?: number;
}) {
  const entity = document.entityById.get(node.id);
  if (!entity) {
    return null;
  }
  const childCount = node.children.length;
  const isExpanded = expanded.has(node.id);
  return (
    <View>
      <Pressable
        onPress={() => {
          onSelect(entity.id, "tree");
          if (childCount > 0) {
            onToggle(entity.id);
          }
        }}
        style={[
          styles.treeItem,
          { marginLeft: depth * 12 },
          selectedId === entity.id && styles.treeItemSelected,
        ]}
      >
        <View style={styles.treeTitleRow}>
          {childCount > 0 ? (
            <Text style={styles.treeToggle}>{isExpanded ? "-" : "+"}</Text>
          ) : null}
          <Text style={styles.treeTitle} numberOfLines={1}>
            {entity.name || `#${entity.id}`}
          </Text>
        </View>
        <Text style={styles.treeMeta}>
          #{entity.id} {entity.type} - {node.relation}
          {childCount ? ` - ${childCount.toLocaleString()} children` : ""}
        </Text>
      </Pressable>
      {isExpanded
        ? node.children.map((child) => (
            <TreeNode
              depth={depth + 1}
              document={document}
              expanded={expanded}
              key={`${node.id}-${child.id}`}
              node={child}
              selectedId={selectedId}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))
        : null}
    </View>
  );
}

function EntityRow({
  entity,
  selected,
  onPress,
}: {
  entity: NativeIfcEntity;
  selected: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.treeItem, selected && styles.treeItemSelected]}
    >
      <Text style={styles.treeTitle} numberOfLines={1}>
        {entity.name || `#${entity.id}`}
      </Text>
      <Text style={styles.treeMeta}>
        #{entity.id} {entity.type}
      </Text>
    </Pressable>
  );
}

export function findTreePath(document: NativeIfcDocument, id: number) {
  const path: NativeIfcEntity[] = [];
  const visit = (node: NativeIfcTreeNode): boolean => {
    const entity = document.entityById.get(node.id);
    if (entity) {
      path.push(entity);
    }
    if (node.id === id) {
      return true;
    }
    if (node.children.some(visit)) {
      return true;
    }
    path.pop();
    return false;
  };
  document.spatialRoots.some(visit);
  return path;
}
