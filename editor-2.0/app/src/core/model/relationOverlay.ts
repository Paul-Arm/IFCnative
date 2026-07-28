/**
 * Sitzungs-Overlay für Beziehungen (M2).
 *
 * Der RelationshipGraph des Parsers (`store.relationships`) ist statisch: er
 * wird beim Parsen als CSR aufgebaut und kennt keine später hinzugefügten
 * Kanten. Dieses Overlay hält deshalb pro Sitzung
 *  - neu angelegte Beziehungen (die zugehörige IfcRel*-Instanz liegt als
 *    Overlay-Entity im `StoreEditor`) und
 *  - die expressIds entfernter Beziehungen (geparste Beziehungen können nicht
 *    aus dem CSR gelöscht werden, sie werden nur als unterdrückt gemerkt).
 *
 * `relationsOf`/`neighborsOf` mischen beides beim Lesen ein.
 */
import type { RelationshipType } from "@ifc-lite/data";

export interface OverlayRelation {
  /** expressId der IfcRel*-Instanz im Mutations-Overlay */
  readonly relExpressId: number;
  readonly relType: RelationshipType;
  /** STEP-Klasse in Großschreibung, z. B. „IFCRELAGGREGATES" */
  readonly ifcClass: string;
  /** „Relating"-Seite — Quelle der Kante, wie im geparsten Graphen */
  readonly sourceId: number;
  /** „Related"-Seite(n) — Ziele der Kante */
  readonly targetIds: readonly number[];
}

export interface OverlayRelationRow {
  relId: number;
  relType: RelationshipType;
  ifcClass: string;
  /** expressId der Gegenseite aus Sicht des abgefragten Objekts */
  otherId: number;
  direction: "forward" | "inverse";
}

export class RelationOverlay {
  private readonly added = new Map<number, OverlayRelation>();
  private readonly suppressed = new Set<number>();
  /**
   * Review-Befund 1: Bei Multi-Target-Beziehungen (ein
   * IfcRelContainedInSpatialStructure für alle Wände eines Geschosses) darf
   * das Löschen EINES Mitglieds die Beziehung nicht global unterdrücken.
   * Diese Map merkt sich je Beziehung die entfernten Mitglieder;
   * `relationsOf` blendet nur deren Kanten aus.
   */
  private readonly suppressedMembers = new Map<number, Set<number>>();
  private rev = 0;

  /** Zählt jede Änderung — Panes hängen ihre Caches daran auf. */
  get revision(): number {
    return this.rev;
  }

  /** Anzahl aktiver Overlay-Beziehungen (ohne unterdrückte). */
  get addedCount(): number {
    return this.added.size;
  }

  /** Anzahl unterdrückter (entfernter) Beziehungen. */
  get suppressedCount(): number {
    return this.suppressed.size;
  }

  /** Neue Beziehung aufnehmen. */
  addRelation(relation: OverlayRelation): void {
    this.added.set(relation.relExpressId, relation);
    this.suppressed.delete(relation.relExpressId);
    this.rev++;
  }

  /**
   * Beziehung entfernen. Overlay-Beziehungen verschwinden aus der Liste,
   * geparste werden als unterdrückt gemerkt (der CSR bleibt unangetastet).
   * Gibt den vorherigen Overlay-Datensatz für das Undo zurück.
   */
  removeRelation(relId: number): OverlayRelation | null {
    const previous = this.added.get(relId) ?? null;
    this.added.delete(relId);
    this.suppressed.add(relId);
    this.rev++;
    return previous;
  }

  /** Undo von `removeRelation`. */
  restoreRelation(relId: number, previous?: OverlayRelation | null): void {
    this.suppressed.delete(relId);
    if (previous) this.added.set(relId, previous);
    this.rev++;
  }

  /** Undo von `addRelation` — die Beziehung verschwindet spurlos. */
  dropRelation(relId: number): void {
    this.added.delete(relId);
    this.suppressed.delete(relId);
    this.rev++;
  }

  isSuppressed(relId: number): boolean {
    return this.suppressed.has(relId);
  }

  /** Einzelnes Mitglied einer Multi-Target-Beziehung ausblenden. */
  suppressMember(relId: number, expressId: number): void {
    let members = this.suppressedMembers.get(relId);
    if (!members) {
      members = new Set<number>();
      this.suppressedMembers.set(relId, members);
    }
    members.add(expressId);
    this.rev++;
  }

  /** Undo von `suppressMember`. */
  unsuppressMember(relId: number, expressId: number): void {
    const members = this.suppressedMembers.get(relId);
    if (!members) return;
    members.delete(expressId);
    if (members.size === 0) this.suppressedMembers.delete(relId);
    this.rev++;
  }

  isMemberSuppressed(relId: number, expressId: number): boolean {
    return this.suppressedMembers.get(relId)?.has(expressId) ?? false;
  }

  getRelation(relId: number): OverlayRelation | null {
    return this.added.get(relId) ?? null;
  }

  /**
   * Alle aktiven Overlay-Beziehungen in Einfügereihenfolge — ohne
   * unterdrückte Beziehungen und ohne einzeln entfernte Mitglieder.
   */
  all(): OverlayRelation[] {
    const rows: OverlayRelation[] = [];
    for (const relation of this.added.values()) {
      if (this.suppressed.has(relation.relExpressId)) continue;
      const targetIds = relation.targetIds.filter(
        (id) => !this.isMemberSuppressed(relation.relExpressId, id),
      );
      if (targetIds.length === 0) continue;
      rows.push(targetIds.length === relation.targetIds.length
        ? relation
        : { ...relation, targetIds });
    }
    return rows;
  }

  /** Zeilen für ein Objekt, in beiden Richtungen. */
  relationsFor(expressId: number): OverlayRelationRow[] {
    const rows: OverlayRelationRow[] = [];
    for (const relation of this.added.values()) {
      if (this.suppressed.has(relation.relExpressId)) continue;
      const base = {
        relId: relation.relExpressId,
        relType: relation.relType,
        ifcClass: relation.ifcClass,
      };
      if (relation.sourceId === expressId) {
        for (const targetId of relation.targetIds) {
          if (this.isMemberSuppressed(relation.relExpressId, targetId)) continue;
          rows.push({ ...base, otherId: targetId, direction: "forward" });
        }
      }
      if (this.isMemberSuppressed(relation.relExpressId, expressId)) continue;
      if (relation.targetIds.includes(expressId)) {
        rows.push({
          ...base,
          otherId: relation.sourceId,
          direction: "inverse",
        });
      }
    }
    return rows;
  }
}
