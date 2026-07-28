/**
 * Dialog „Gruppen verwalten" (portiert aus der ersten React-App, Branch
 * `old-react-tauri-improvements`): zeigt die Gruppenmitgliedschaften eines
 * Objekts und erlaubt das Zuweisen zu einer bestehenden bzw. das Anlegen
 * einer neuen Gruppe. Der Dialog bleibt nach Aktionen offen — die Listen
 * aktualisieren sich über die Dokument-Revision live.
 *
 * Schreibwege: `cmdAssignToGroup` (bestehend/neu) und `cmdDeleteRelation`
 * mit memberIds (nur die Mitgliedschaft löschen) — beides undo-bar.
 */
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { RelationshipType } from "@ifc-lite/data";
import { useCommands, useDocRevision } from "../../commands/pipeline";
import { cmdDeleteRelation } from "../../commands/relationCommands";
import { cmdAssignToGroup } from "../../commands/resourceCommands";
import { GROUP_CLASSES, type GroupClass } from "../../domain/resources/objects";
import type { DocumentEntry } from "../../store/documents";
import {
  buildGroupsModel,
  entityLabelOf,
  entityTypeOf,
} from "./groupsModel";

const BACKDROP: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 60,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "color-mix(in srgb, var(--bg) 60%, transparent)",
};

const PANEL: CSSProperties = {
  width: "min(460px, 92%)",
  maxHeight: "85%",
  overflow: "auto",
  padding: "14px 16px",
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "var(--bg-panel)",
  color: "var(--text)",
  boxShadow: "var(--shadow-popover)",
};

const SECTION_TITLE: CSSProperties = {
  margin: "0 0 6px",
  fontSize: "0.65rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "var(--text-dim)",
};

export default function GroupManagerDialog({
  document,
  entityId,
  onClose,
}: {
  document: DocumentEntry;
  entityId: number;
  onClose(): void;
}) {
  const docId = document.id;
  const session = document.session;
  const revision = useDocRevision(docId);
  const execute = useCommands((s) => s.execute);

  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [newGroupClass, setNewGroupClass] = useState<GroupClass>("IFCGROUP");
  const [newGroupName, setNewGroupName] = useState("");

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
    }
    window.document.addEventListener("keydown", onKey);
    return () => window.document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Formularzustand pro Ziel-Entität zurücksetzen.
  useEffect(() => {
    setSelectedGroupId("");
    setNewGroupName("");
  }, [entityId]);

  /** Mitgliedschaften des Objekts: Gruppe (otherId) + Record (relId). */
  const memberships = useMemo(
    () =>
      session
        .relationsOf(entityId)
        .filter(
          (row) =>
            row.relType === RelationshipType.AssignsToGroup &&
            row.direction === "inverse",
        ),
    [session, entityId, revision],
  );

  /** Alle Gruppen des Modells außer dem Objekt selbst und bestehenden. */
  const assignableGroups = useMemo(() => {
    const memberOf = new Set(memberships.map((row) => row.otherId));
    return buildGroupsModel(session)
      .categories.flatMap((category) => category.groups)
      .filter(
        (group) =>
          group.expressId !== entityId && !memberOf.has(group.expressId),
      );
  }, [session, entityId, revision, memberships]);

  const entityLabel = `${session.labelOf(entityId)}`;

  const assignExisting = () => {
    const groupId = Number(selectedGroupId);
    if (!groupId) return;
    execute(
      docId,
      cmdAssignToGroup(session, [entityId], {
        groupId,
        groupClass: "IFCGROUP",
        name: entityLabelOf(session, groupId),
      }),
    );
    setSelectedGroupId("");
  };

  const createGroup = () => {
    execute(
      docId,
      cmdAssignToGroup(session, [entityId], {
        groupClass: newGroupClass,
        name: newGroupName,
      }),
    );
    setNewGroupName("");
  };

  const removeMembership = (groupId: number, relId: number) => {
    if (!relId) return;
    execute(
      docId,
      cmdDeleteRelation(
        session,
        relId,
        `„${entityLabel}" aus „${entityLabelOf(session, groupId)}"`,
        [entityId],
      ),
    );
  };

  // Portal an <body>: innerhalb eines Mosaic-Fensters würde der Dialog vom
  // Stacking-Kontext des Fensters gefangen und von späteren Fenstern
  // (z. B. dem Viewer-Canvas) übermalt.
  return createPortal(
    <div style={BACKDROP} onMouseDown={onClose}>
      <div
        style={PANEL}
        role="dialog"
        aria-label="Gruppen verwalten"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h3 style={{ margin: "0 0 2px", fontSize: "0.95rem" }}>
          Gruppen verwalten
        </h3>
        <p className="text-dim" style={{ margin: "0 0 14px", fontSize: "0.75rem" }}>
          {entityLabel}
        </p>

        <section style={{ marginBottom: 14 }}>
          <h4 style={SECTION_TITLE}>Mitglied in</h4>
          {memberships.length === 0 ? (
            <p className="text-dim" style={{ margin: 0, fontSize: "0.75rem" }}>
              Keine Gruppenmitgliedschaften.
            </p>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 4 }}>
              {memberships.map((row) => (
                <li
                  key={`${row.otherId}:${row.relId}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "4px 8px",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-md)",
                    fontSize: "0.8125rem",
                  }}
                >
                  <span style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {row.otherName || entityLabelOf(session, row.otherId)}
                  </span>
                  <span className="text-dim" style={{ flex: "none", fontSize: "0.65rem", textTransform: "uppercase" }}>
                    #{row.otherId} ·{" "}
                    {(entityTypeOf(session, row.otherId) || "?").replace(/^IFC/i, "")}
                  </span>
                  <button
                    type="button"
                    className="btn"
                    style={{ padding: "0 8px", minHeight: "1.5rem" }}
                    title={
                      row.relId
                        ? "Aus Gruppe entfernen"
                        : "Mitgliedschaft ohne Record-Id — nicht lösbar"
                    }
                    disabled={!row.relId}
                    onClick={() => removeMembership(row.otherId, row.relId)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section style={{ marginBottom: 14 }}>
          <h4 style={SECTION_TITLE}>Zu bestehender Gruppe hinzufügen</h4>
          {assignableGroups.length === 0 ? (
            <p className="text-dim" style={{ margin: 0, fontSize: "0.75rem" }}>
              Keine weiteren Gruppen im Modell.
            </p>
          ) : (
            <div style={{ display: "flex", gap: 8 }}>
              <select
                className="input"
                style={{ flex: 1, minWidth: 0 }}
                value={selectedGroupId}
                onChange={(event) => setSelectedGroupId(event.target.value)}
              >
                <option value="">Gruppe wählen …</option>
                {assignableGroups.map((group) => (
                  <option key={group.expressId} value={group.expressId}>
                    {group.label} (#{group.expressId} · {group.type.replace(/^IFC/i, "")})
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn"
                disabled={!selectedGroupId}
                onClick={assignExisting}
              >
                Hinzufügen
              </button>
            </div>
          )}
        </section>

        <section>
          <h4 style={SECTION_TITLE}>Neue Gruppe anlegen</h4>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <select
              className="input"
              style={{ flex: "0 0 9rem" }}
              value={newGroupClass}
              onChange={(event) =>
                setNewGroupClass(event.target.value as GroupClass)
              }
            >
              {GROUP_CLASSES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <input
              className="input"
              style={{ flex: 1, minWidth: 0 }}
              placeholder="z. B. Brandabschnitt A"
              value={newGroupName}
              onChange={(event) => setNewGroupName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") createGroup();
              }}
            />
          </div>
          <button type="button" className="btn" data-active="true" onClick={createGroup}>
            Anlegen &amp; zuweisen
          </button>
        </section>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
          <button type="button" className="btn" onClick={onClose}>
            Schließen
          </button>
        </div>
      </div>
    </div>,
    // Nicht `document.body`: die Prop `document` (DocumentEntry) verschattet
    // hier das globale Objekt.
    window.document.body,
  );
}
