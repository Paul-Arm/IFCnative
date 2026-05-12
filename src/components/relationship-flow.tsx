import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { RelationshipFlowProps } from './relationship-flow.types';

export default function RelationshipFlow({
  capped,
  depth,
  edges,
  nodes,
  relationshipCount,
  relationshipOptions,
  relationshipTypeFilters,
  onClearPositions,
  onDepth,
  onRelationshipTypeFilters,
  onSelect,
  onToggleChildren,
  onTogglePin,
}: RelationshipFlowProps) {
  return (
    <View style={styles.root}>
      <View style={styles.toolbar}>
        <Text style={styles.summary}>
          {nodes.length} nodes - {relationshipCount} rels {capped ? '- capped' : ''}
        </Text>
        <View style={styles.depthRow}>
          {[0, 1, 2, 3, 4].map((value) => (
            <Pressable
              key={value}
              onPress={() => onDepth(value)}
              style={[styles.depthButton, depth === value && styles.depthButtonActive]}>
              <Text style={[styles.depthText, depth === value && styles.depthTextActive]}>{value}</Text>
            </Pressable>
          ))}
          <Pressable onPress={onClearPositions} style={styles.depthButton}>
            <Text style={styles.depthText}>Auto</Text>
          </Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
          <Pressable
            onPress={() => onRelationshipTypeFilters([])}
            style={[styles.filterChip, relationshipTypeFilters.length === 0 && styles.filterChipActive]}>
            <Text style={[styles.filterChipText, relationshipTypeFilters.length === 0 && styles.filterChipTextActive]}>All rels</Text>
          </Pressable>
          {relationshipOptions.map((option) => {
            const active = relationshipTypeFilters.includes(option.value);
            return (
              <Pressable
                key={option.value}
                onPress={() => {
                  const next = active
                    ? relationshipTypeFilters.filter((value) => value !== option.value)
                    : [...relationshipTypeFilters, option.value];
                  onRelationshipTypeFilters(next);
                }}
                style={[styles.filterChip, active && styles.filterChipActive]}>
                <Text style={[styles.filterChipText, active && styles.filterChipTextActive]} numberOfLines={1}>
                  {shortRelationship(option.label)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      <ScrollView style={styles.list}>
        {nodes.map((node) => (
          <Pressable
            key={node.id}
            onPress={() => onSelect(node.id)}
            style={[styles.node, node.selected && styles.nodeSelected, node.pinned && styles.nodePinned]}>
            <View style={styles.nodeHeader}>
              <Text style={[styles.nodeTitle, node.selected && styles.nodeTitleSelected]} numberOfLines={1}>
                #{node.id} {shortType(node.entity.type)}
              </Text>
              {node.childCount > 0 ? (
                <Pressable
                  onPress={() => onToggleChildren(node.id, node.childrenLoaded)}
                  style={styles.nodeButton}>
                  <Text style={styles.nodeButtonText}>
                    {node.childrenLoaded ? '-' : `+${Math.min(node.childCount, 99)}`}
                  </Text>
                </Pressable>
              ) : null}
              <Pressable onPress={() => onTogglePin(node.id)} style={styles.nodeButton}>
                <Text style={styles.nodeButtonText}>{node.pinned ? 'PIN' : '+'}</Text>
              </Pressable>
            </View>
            <Text style={[styles.nodeName, node.selected && styles.nodeTitleSelected]} numberOfLines={1}>
              {node.entity.name || node.entity.globalId || node.entity.type}
            </Text>
          </Pressable>
        ))}
        {!nodes.length ? <Text style={styles.empty}>No graph nodes.</Text> : null}
        {edges.length ? <Text style={styles.empty}>{edges.length} relationships indexed.</Text> : null}
      </ScrollView>
    </View>
  );
}

function shortType(type: string) {
  return type.replace(/^IFC/i, '');
}

function shortRelationship(type: string) {
  return type.replace(/^IFCREL/i, '').replace(/^IFC/i, '');
}

const styles = StyleSheet.create({
  depthButton: {
    borderColor: '#d4d4d8',
    borderRadius: 6,
    borderWidth: 1,
    minWidth: 30,
    paddingHorizontal: 7,
    paddingVertical: 6,
  },
  depthButtonActive: {
    backgroundColor: '#0f766e',
    borderColor: '#0f766e',
  },
  depthRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  depthText: {
    color: '#18181b',
    fontSize: 10,
    textAlign: 'center',
  },
  depthTextActive: {
    color: '#ffffff',
  },
  empty: {
    color: '#71717a',
    fontSize: 12,
    paddingVertical: 8,
  },
  filterChip: {
    borderColor: '#d4d4d8',
    borderRadius: 999,
    borderWidth: 1,
    marginRight: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  filterChipActive: {
    backgroundColor: '#0f766e',
    borderColor: '#0f766e',
  },
  filterChipText: {
    color: '#18181b',
    fontSize: 10,
  },
  filterChipTextActive: {
    color: '#ffffff',
  },
  filterScroll: {
    maxWidth: '100%',
  },
  list: {
    padding: 8,
  },
  node: {
    backgroundColor: '#cffafe',
    borderColor: '#0f766e',
    borderRadius: 8,
    borderWidth: 2,
    marginBottom: 8,
    padding: 8,
  },
  nodeButton: {
    backgroundColor: '#ffffff',
    borderColor: '#0f766e',
    borderRadius: 4,
    borderWidth: 1,
    minWidth: 26,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  nodeButtonText: {
    color: '#0f766e',
    fontSize: 10,
    textAlign: 'center',
  },
  nodeHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  nodeName: {
    color: '#18181b',
    fontSize: 11,
    marginTop: 4,
  },
  nodePinned: {
    backgroundColor: '#bbf7d0',
  },
  nodeSelected: {
    backgroundColor: '#0f766e',
    borderColor: '#18181b',
  },
  nodeTitle: {
    color: '#18181b',
    flex: 1,
    fontSize: 11,
  },
  nodeTitleSelected: {
    color: '#ffffff',
  },
  root: {
    borderColor: '#e4e4e7',
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 430,
    overflow: 'hidden',
  },
  summary: {
    color: '#52525b',
    flex: 1,
    fontSize: 12,
  },
  toolbar: {
    alignItems: 'center',
    borderBottomColor: '#e4e4e7',
    borderBottomWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    padding: 8,
  },
});
