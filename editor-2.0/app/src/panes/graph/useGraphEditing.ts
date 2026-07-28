/**
 * Bearbeitungslogik des Graph-Panes (M2): Knoten verbinden, Kanten löschen,
 * Objekte samt Kaskade löschen. Der Hook hält nur den Dialogzustand — jede
 * Modelländerung läuft über `execute` durch die Command-Pipeline.
 */
import { useCallback, useState } from "react";
import type { Connection } from "@xyflow/react";
import { useCommands } from "../../commands/pipeline";
import {
  cmdCreateRelation,
  cmdDeleteRelation,
} from "../../commands/relationCommands";
import {
  cmdDeleteEntityCascade,
  planEntityRemoval,
  type RemovalPlan,
} from "../../commands/entityCommands";
import {
  allowedRelationClasses,
  type RelationClassRule,
} from "../../core/model/relationshipRules";
import type { ModelSession } from "../../core/session";

export interface PendingConnect {
  sourceId: number;
  targetId: number;
  sourceLabel: string;
  targetLabel: string;
  /** Zwischen diesen beiden Klassen zulässige Beziehungsarten */
  rules: RelationClassRule[];
}

export interface PendingRemoval {
  expressId: number;
  label: string;
  plan: RemovalPlan;
}

export interface GraphEditing {
  connect: PendingConnect | null;
  removal: PendingRemoval | null;
  onConnect(connection: Connection): void;
  confirmConnect(rule: RelationClassRule): void;
  cancelConnect(): void;
  requestRemoval(expressId: number): void;
  confirmRemoval(): void;
  cancelRemoval(): void;
  deleteRelation(relId: number, description: string): void;
}

export function useGraphEditing(
  docId: string | null,
  session: ModelSession | null,
): GraphEditing {
  const execute = useCommands((s) => s.execute);
  const [connect, setConnect] = useState<PendingConnect | null>(null);
  const [removal, setRemoval] = useState<PendingRemoval | null>(null);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!session) return;
      const sourceId = Number(connection.source);
      const targetId = Number(connection.target);
      if (!Number.isFinite(sourceId) || !Number.isFinite(targetId)) return;
      if (sourceId === targetId) return;
      const sourceType = session.identityOf(sourceId).type;
      const targetType = session.identityOf(targetId).type;
      setConnect({
        sourceId,
        targetId,
        sourceLabel: session.labelOf(sourceId),
        targetLabel: session.labelOf(targetId),
        rules: allowedRelationClasses(sourceType, targetType),
      });
    },
    [session],
  );

  const cancelConnect = useCallback(() => setConnect(null), []);

  const confirmConnect = useCallback(
    (rule: RelationClassRule) => {
      if (!docId || !session || !connect) return;
      execute(
        docId,
        cmdCreateRelation(session, rule.ifcClass, connect.sourceId, [
          connect.targetId,
        ]),
      );
      setConnect(null);
    },
    [docId, session, connect, execute],
  );

  const requestRemoval = useCallback(
    (expressId: number) => {
      if (!session) return;
      setRemoval({
        expressId,
        label: session.labelOf(expressId),
        plan: planEntityRemoval(session, expressId),
      });
    },
    [session],
  );

  const cancelRemoval = useCallback(() => setRemoval(null), []);

  const confirmRemoval = useCallback(() => {
    if (!docId || !session || !removal) return;
    execute(docId, cmdDeleteEntityCascade(session, removal.expressId));
    setRemoval(null);
  }, [docId, session, removal, execute]);

  const deleteRelation = useCallback(
    (relId: number, description: string) => {
      if (!docId || !session || !relId) return;
      execute(docId, cmdDeleteRelation(session, relId, description));
    },
    [docId, session, execute],
  );

  return {
    connect,
    removal,
    onConnect,
    confirmConnect,
    cancelConnect,
    requestRemoval,
    confirmRemoval,
    cancelRemoval,
    deleteRelation,
  };
}
