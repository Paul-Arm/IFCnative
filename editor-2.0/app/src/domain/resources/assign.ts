/**
 * Generisches Command-Gerüst für Ressourcen-Zuordnungen (M9).
 *
 * Muster wie `cmdCreateRelation`/`overlayCreateCommand` (geometryCommands):
 * `run` emittiert Ressource + IfcRel*-Record ins Mutations-Overlay und meldet
 * die Kante am RelationOverlay an (der CSR des Parsers ist statisch — die
 * Anzeige-Seite mischt die Overlay-Kante über `relationsOf` ein, siehe
 * read.ts). `undo` nimmt Overlay-Kante UND alle erzeugten Records zurück
 * (Overlay-Entities werden beim removeEntity vergessen → der Export ist
 * wieder byte-identisch). `redo` stellt die gesicherten NewEntity-Records mit
 * STABILEN expressIds über `restoreNewEntity` wieder her (Befund 12) — ein
 * erneutes `run()` würde neue Ids vergeben.
 */
import type { RelationshipType } from "@ifc-lite/data";
import type { NewEntity } from "@ifc-lite/mutations";
import type { ModelSession } from "../../core/session";
import type { EditorCommand } from "../../commands/pipeline";
import { emitAssociation } from "./objects";

export interface ResourceAssignOptions {
  label: string;
  relType: RelationshipType;
  /** STEP-Klasse des IfcRel*-Records, z. B. „IFCRELASSIGNSTOGROUP" */
  ifcClass: string;
  /** Name-Attribut des IfcRel*-Records */
  relName: string;
  targetIds: readonly number[];
  /**
   * Liefert die expressId der Relating-Seite (Material, Referenz, Gruppe,
   * Typ) — entweder eine vorhandene Id oder frisch emittierte Records, die
   * in `out` gesammelt werden.
   */
  resource(out: NewEntity[]): number;
}

interface AssignBuild {
  resourceId: number;
  relId: number;
  created: NewEntity[];
}

export function resourceAssignCommand(
  session: ModelSession,
  options: ResourceAssignOptions,
): EditorCommand {
  if (options.targetIds.length === 0) {
    throw new Error("Zuordnung ohne Zielobjekte kann nicht angelegt werden.");
  }
  const targetIds = [...options.targetIds];
  /** Snapshot des ersten `run` — überlebt Undo, damit Redo dieselben Ids nutzt. */
  let result: AssignBuild | null = null;

  const link = (build: AssignBuild): void => {
    session.relationOverlay.addRelation({
      relExpressId: build.relId,
      relType: options.relType,
      ifcClass: options.ifcClass,
      sourceId: build.resourceId,
      targetIds,
    });
  };

  return {
    label: options.label,
    run() {
      const created: NewEntity[] = [];
      const resourceId = options.resource(created);
      const relId = emitAssociation(
        session,
        created,
        options.ifcClass,
        options.relName,
        targetIds,
        resourceId,
      );
      result = { resourceId, relId, created };
      link(result);
    },
    undo() {
      if (!result) return;
      session.relationOverlay.dropRelation(result.relId);
      const editor = session.editor();
      for (const record of [...result.created].reverse()) {
        editor.removeEntity(record.expressId);
      }
      // `result` bleibt als Snapshot für das Redo erhalten (stabile Ids).
    },
    redo() {
      if (!result) {
        this.run();
        return;
      }
      for (const record of result.created) {
        session.view.restoreNewEntity(record);
      }
      link(result);
    },
  };
}

/** Beschriftungshelfer für Command-Labels. */
export const countText = (ids: readonly number[]): string =>
  ids.length === 1 ? `#${ids[0]}` : `${ids.length} Objekte`;
