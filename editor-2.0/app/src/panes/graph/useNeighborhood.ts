/**
 * Nachbarschafts-Traversierung für das Graph-Pane (lesend, M1).
 * Breitensuche ab dem Anker über `neighborsOf`, mit Kanten-Deduplizierung
 * und harter Knotenobergrenze.
 */
import { useMemo } from "react";
import type { RelationshipType } from "@ifc-lite/data";
import { neighborsOf } from "../../core/model/relations";
import type { ModelSession } from "../../core/session";

/** Obergrenze der dargestellten Knoten; darüber wird gekappt. */
export const NODE_CAP = 400;

export interface GraphNodeInfo {
  expressId: number;
  /** BFS-Ebene, 0 = Anker */
  depth: number;
  type: string;
  name: string;
  /** Kompaktes Knotenlabel (max. ~24 Zeichen) */
  label: string;
  /** Vollständiges Label für Tooltip und Suche */
  title: string;
}

export interface GraphEdgeInfo {
  id: string;
  /** Quelle in Beziehungsrichtung (nicht in BFS-Richtung) */
  source: number;
  target: number;
  relType: RelationshipType;
  label: string;
  /** expressId der IfcRel*-Instanz — Angriffspunkt zum Löschen */
  relId: number;
  /** Herkunft: geparst oder in dieser Sitzung angelegt */
  origin: "parsed" | "overlay";
}

export interface Neighborhood {
  anchorId: number;
  nodes: GraphNodeInfo[];
  edges: GraphEdgeInfo[];
  /** true, wenn die Knotenobergrenze gegriffen hat */
  capped: boolean;
}

/** „IfcWall · Außenwand OG1" auf max. `max` Zeichen gekürzt. */
export function compactLabel(type: string, name: string, max = 24): string {
  const text = name ? `${type} · ${name}` : type;
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function nodeInfo(
  session: ModelSession,
  expressId: number,
  depth: number,
  type: string,
  name: string,
): GraphNodeInfo {
  return {
    expressId,
    depth,
    type,
    name,
    label: compactLabel(type, name),
    title: session.labelOf(expressId),
  };
}

/**
 * Breitensuche bis `maxDepth` Ebenen. `types` schränkt die Beziehungsarten
 * ein; `undefined` bedeutet „alle".
 */
export function buildNeighborhood(
  session: ModelSession,
  anchorId: number,
  maxDepth: number,
  types?: ReadonlySet<RelationshipType>,
): Neighborhood {
  const store = session.store;
  const overlay = session.relationOverlay;
  const nodes = new Map<number, GraphNodeInfo>();
  const edges = new Map<string, GraphEdgeInfo>();
  let capped = false;

  const anchor = session.identityOf(anchorId);
  nodes.set(
    anchorId,
    nodeInfo(session, anchorId, 0, anchor.type, anchor.name),
  );

  let frontier: number[] = [anchorId];
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const next: number[] = [];
    for (const current of frontier) {
      for (const row of neighborsOf(store, current, types, overlay)) {
        if (row.otherId === current) continue;
        // Gelöschte Objekte verschwinden aus dem Graphen.
        if (session.isDeleted(row.otherId)) continue;
        if (!nodes.has(row.otherId)) {
          if (nodes.size >= NODE_CAP) {
            capped = true;
            continue;
          }
          nodes.set(
            row.otherId,
            nodeInfo(
              session,
              row.otherId,
              depth + 1,
              row.otherType,
              row.otherName,
            ),
          );
          next.push(row.otherId);
        }
        const source = row.direction === "forward" ? current : row.otherId;
        const target = row.direction === "forward" ? row.otherId : current;
        const id = `${source}-${target}-${row.relType}-${row.relId}`;
        if (!edges.has(id)) {
          edges.set(id, {
            id,
            source,
            target,
            relType: row.relType,
            label: row.label,
            relId: row.relId,
            origin: row.origin,
          });
        }
      }
    }
    frontier = next;
  }

  return {
    anchorId,
    nodes: [...nodes.values()],
    edges: [...edges.values()].filter(
      (edge) => nodes.has(edge.source) && nodes.has(edge.target),
    ),
    capped,
  };
}

/**
 * Memoisierte Variante für das Pane. `revision` erzwingt den Neuaufbau nach
 * jeder Modelländerung (Command-Historie und Beziehungs-Overlay).
 */
export function useNeighborhood(
  session: ModelSession | null,
  anchorId: number | null,
  maxDepth: number,
  types: ReadonlySet<RelationshipType> | undefined,
  revision = 0,
): Neighborhood | null {
  return useMemo(() => {
    if (!session || anchorId === null) return null;
    if (session.isDeleted(anchorId)) return null;
    return buildNeighborhood(session, anchorId, maxDepth, types);
    // revision ist bewusst Teil der Abhängigkeiten: der Graph liest aus
    // Store und Overlay, deren Änderungen React nicht sieht.
  }, [session, anchorId, maxDepth, types, revision]);
}
