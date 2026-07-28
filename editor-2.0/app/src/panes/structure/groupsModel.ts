/**
 * Datenmodell der Gruppen-Ansicht (portiert aus der ersten React-App,
 * Branch `old-react-tauri-improvements`): Kategorie → Gruppe → Mitglieder aus
 * den IFCRELASSIGNSTOGROUP-Zuweisungen. Die Gruppenstruktur ist ein DAG —
 * ein Objekt kann in mehreren Gruppen stecken und Gruppen können
 * verschachtelt sein; Mitglieder erscheinen deshalb unter jeder Gruppe
 * erneut, Zyklen bricht der visited-Guard ab.
 *
 * Quellen: geparste Gruppen über `store.entityIndex.byType`, in der Sitzung
 * neu angelegte Gruppen über das RelationOverlay (deren Records liegen nur im
 * Mutations-Overlay und fehlen im Parse-Index). Mitgliedschaften kommen aus
 * `session.relationsOf` — damit greifen Overlay-Kanten, unterdrückte
 * Mitglieder und Tombstones automatisch.
 */
import { RelationshipType } from "@ifc-lite/data";
import type { ModelSession } from "../../core/session";

/** Gruppenartige IFC-Klassen, gegliedert für die oberste Baumebene. */
export const GROUP_VIEW_CATEGORIES: ReadonlyArray<{
  label: string;
  types: readonly string[];
}> = [
  {
    label: "Systeme",
    types: [
      "IFCSYSTEM",
      "IFCBUILDINGSYSTEM",
      "IFCBUILTSYSTEM",
      "IFCDISTRIBUTIONSYSTEM",
      "IFCDISTRIBUTIONCIRCUIT",
    ],
  },
  { label: "Zonen", types: ["IFCZONE"] },
  {
    label: "Gruppen",
    // IFCCONDITION/-CRITERION: IFC2x3-Altlasten (in IFC4 entfernt) — nur
    // für die Anzeige alter Dateien, nicht zum Anlegen anbieten.
    types: ["IFCGROUP", "IFCCONDITION", "IFCCONDITIONCRITERION"],
  },
  { label: "Anlagen & Inventar", types: ["IFCASSET", "IFCINVENTORY"] },
  {
    label: "Tragwerk",
    types: [
      "IFCSTRUCTURALANALYSISMODEL",
      "IFCSTRUCTURALLOADGROUP",
      "IFCSTRUCTURALLOADCASE",
      "IFCSTRUCTURALRESULTGROUP",
    ],
  },
];

export const GROUP_ENTITY_TYPES: ReadonlySet<string> = new Set(
  GROUP_VIEW_CATEGORIES.flatMap((category) => category.types),
);

export function isGroupType(type: string): boolean {
  return GROUP_ENTITY_TYPES.has(type.toUpperCase());
}

export interface GroupMemberNode {
  expressId: number;
  type: string;
  label: string;
  /** IfcRel*-Record der Mitgliedschaft (0 = aus dem Parser unbekannt). */
  relId: number;
  groupId: number;
  groupLabel: string;
  /** Gefüllt, wenn das Mitglied selbst eine (nicht zyklische) Gruppe ist. */
  children: GroupMemberNode[];
}

export interface GroupNode {
  expressId: number;
  type: string;
  label: string;
  members: GroupMemberNode[];
}

export interface GroupsModel {
  categories: { label: string; groups: GroupNode[] }[];
  groupCount: number;
}

/**
 * Typname, der auch für Overlay-Entities stimmt: der Parser-Store kennt neu
 * angelegte Records nicht und antwortet dort mit „Unknown" — deshalb hat das
 * Mutations-Overlay Vorrang.
 */
export function entityTypeOf(session: ModelSession, expressId: number): string {
  const overlayEntity = session.view.getNewEntity(expressId);
  if (overlayEntity) return overlayEntity.type.toUpperCase();
  try {
    const type = (session.store.entities.getTypeName(expressId) || "").toUpperCase();
    return type === "UNKNOWN" ? "" : type;
  } catch {
    return "";
  }
}

/** Anzeigename mit Overlay-Vorrang (Attribut 3 = Name bei IfcRoot-Subtypen). */
export function entityLabelOf(session: ModelSession, expressId: number): string {
  const overlayEntity = session.view.getNewEntity(expressId);
  const overlayName = overlayEntity?.attributes[2];
  if (typeof overlayName === "string" && overlayName.trim()) {
    return overlayName;
  }
  return session.labelOf(expressId) || `#${expressId}`;
}

/** Zeilen-Typ auflösen: Parser-Antwort „Unknown"/leer → Overlay befragen. */
function resolveType(
  session: ModelSession,
  expressId: number,
  parsedType: string,
): string {
  const type = (parsedType || "").toUpperCase();
  if (type && type !== "UNKNOWN") return type;
  return entityTypeOf(session, expressId);
}

/** Zeilen-Label auflösen: leere Parser-Namen → Overlay/Fallback. */
function resolveLabel(
  session: ModelSession,
  expressId: number,
  parsedName: string,
): string {
  return parsedName || entityLabelOf(session, expressId);
}

/** Direkte Mitglieder einer Gruppe (forward-Kanten der Zuweisung). */
function memberRowsOf(session: ModelSession, groupId: number) {
  return session
    .relationsOf(groupId)
    .filter(
      (row) =>
        row.relType === RelationshipType.AssignsToGroup &&
        row.direction === "forward" &&
        row.otherId !== groupId,
    );
}

function buildMember(
  session: ModelSession,
  groupId: number,
  groupLabel: string,
  memberId: number,
  memberType: string,
  memberLabel: string,
  relId: number,
  visited: ReadonlySet<number>,
): GroupMemberNode {
  const node: GroupMemberNode = {
    expressId: memberId,
    type: memberType,
    label: memberLabel,
    relId,
    groupId,
    groupLabel,
    children: [],
  };
  // Verschachtelte Gruppe: Mitglieder rekursiv anhängen, Zyklen als Blatt.
  if (isGroupType(memberType) && !visited.has(memberId)) {
    const nextVisited = new Set(visited).add(memberId);
    const label = entityLabelOf(session, memberId);
    for (const row of memberRowsOf(session, memberId)) {
      node.children.push(
        buildMember(
          session,
          memberId,
          label,
          row.otherId,
          resolveType(session, row.otherId, row.otherType),
          resolveLabel(session, row.otherId, row.otherName),
          row.relId,
          nextVisited,
        ),
      );
    }
  }
  return node;
}

export function buildGroupsModel(session: ModelSession): GroupsModel {
  // Alle Gruppen-Entities einsammeln: Parse-Index + Overlay-Zuweisungen.
  const idsByType = new Map<string, number[]>();
  const seen = new Set<number>();
  const push = (type: string, expressId: number) => {
    if (seen.has(expressId) || session.isDeleted(expressId)) return;
    seen.add(expressId);
    const list = idsByType.get(type) ?? [];
    list.push(expressId);
    idsByType.set(type, list);
  };

  for (const type of GROUP_ENTITY_TYPES) {
    for (const id of session.store.entityIndex.byType.get(type) ?? []) {
      push(type, id);
    }
  }
  // In der Sitzung angelegte Gruppen: direkt aus dem Mutations-Overlay —
  // so bleibt auch eine (wieder) leere Gruppe sichtbar und zuweisbar.
  for (const entity of session.view.getNewEntities()) {
    const type = entity.type.toUpperCase();
    if (isGroupType(type)) push(type, entity.expressId);
  }

  const model: GroupsModel = { categories: [], groupCount: 0 };
  for (const category of GROUP_VIEW_CATEGORIES) {
    const groups: GroupNode[] = [];
    for (const type of category.types) {
      for (const expressId of idsByType.get(type) ?? []) {
        const label = entityLabelOf(session, expressId);
        const members = memberRowsOf(session, expressId).map((row) =>
          buildMember(
            session,
            expressId,
            label,
            row.otherId,
            resolveType(session, row.otherId, row.otherType),
            resolveLabel(session, row.otherId, row.otherName),
            row.relId,
            new Set([expressId]),
          ),
        );
        groups.push({ expressId, type, label, members });
      }
    }
    if (groups.length > 0) {
      model.categories.push({ label: category.label, groups });
      model.groupCount += groups.length;
    }
  }
  return model;
}
