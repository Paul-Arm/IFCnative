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
  onRemove,
  onSelect,
  onToggle,
}: {
  document: NativeIfcDocument;
  expanded: Set<number>;
  filteredEntities: NativeIfcEntity[];
  search: string;
  selectedId: number;
  onRemove(id: number): void;
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
            onRemove={onRemove}
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
            onRemove={onRemove}
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
  onRemove,
  onSelect,
  onToggle,
  depth = 0,
}: {
  document: NativeIfcDocument;
  expanded: Set<number>;
  node: NativeIfcTreeNode;
  selectedId: number;
  onRemove(id: number): void;
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
      <View
        style={[
          styles.treeItem,
          { marginLeft: depth * 12 },
          selectedId === entity.id && styles.treeItemSelected,
        ]}
      >
        <View style={styles.treeActionRow}>
          <Pressable
            onPress={() => {
              onSelect(entity.id, "tree");
              if (childCount > 0) {
                onToggle(entity.id);
              }
            }}
            style={styles.treePrimaryAction}
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
          {entity.type !== "IFCPROJECT" ? (
            <Pressable
              onPress={() => onRemove(entity.id)}
              style={styles.treeDeleteButton}
            >
              <Text style={styles.treeDeleteButtonText}>Del</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      {isExpanded
        ? node.children.map((child) => (
            <TreeNode
              depth={depth + 1}
              document={document}
              expanded={expanded}
              key={`${node.id}-${child.id}`}
              node={child}
              selectedId={selectedId}
              onRemove={onRemove}
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
  onRemove,
  onPress,
}: {
  entity: NativeIfcEntity;
  selected: boolean;
  onRemove(id: number): void;
  onPress(): void;
}) {
  return (
    <View style={[styles.treeItem, selected && styles.treeItemSelected]}>
      <View style={styles.treeActionRow}>
        <Pressable onPress={onPress} style={styles.treePrimaryAction}>
          <Text style={styles.treeTitle} numberOfLines={1}>
            {entity.name || `#${entity.id}`}
          </Text>
          <Text style={styles.treeMeta}>
            #{entity.id} {entity.type}
          </Text>
        </Pressable>
        {entity.type !== "IFCPROJECT" ? (
          <Pressable
            onPress={() => onRemove(entity.id)}
            style={styles.treeDeleteButton}
          >
            <Text style={styles.treeDeleteButtonText}>Del</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
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
