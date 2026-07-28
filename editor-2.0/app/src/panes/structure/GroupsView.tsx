/**
 * Gruppen-Ansicht des Struktur-Panes (portiert aus der ersten React-App,
 * Branch `old-react-tauri-improvements`): Kategorie → Gruppe → Mitglieder,
 * mit Suche, Auswahl-Sync und Hover-Aktionen (Gruppen verwalten, Mitglied
 * aus der Gruppe lösen). Alle Modelländerungen laufen als Commands durch
 * die Pipeline (undo-bar).
 */
import { useMemo, useState, type MouseEvent } from "react";
import { useCommands, useDocRevision } from "../../commands/pipeline";
import { cmdDeleteRelation } from "../../commands/relationCommands";
import type { DocumentEntry } from "../../store/documents";
import { useSelection, useSelectionOf } from "../../store/selection";
import {
  buildGroupsModel,
  type GroupMemberNode,
  type GroupNode,
} from "./groupsModel";

export default function GroupsView({
  document,
  query,
  onManageGroups,
}: {
  document: DocumentEntry;
  query: string;
  onManageGroups(expressId: number): void;
}) {
  const docId = document.id;
  const session = document.session;
  const revision = useDocRevision(docId);

  const model = useMemo(
    () => buildGroupsModel(session),
    [session, revision],
  );

  const selection = useSelectionOf(docId);
  const selectedIds = useMemo(() => new Set(selection), [selection]);
  const select = useSelection((s) => s.select);
  const requestFocus = useSelection((s) => s.requestFocus);
  const execute = useCommands((s) => s.execute);

  /** Zugeklappte Gruppen-Pfade (Standard: alles offen, wie im Original). */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const needle = query.trim().toLowerCase();

  const toggle = (path: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  };

  const onActivate = (event: MouseEvent, expressId: number) => {
    select(docId, expressId, event.ctrlKey || event.metaKey);
  };

  const removeMembership = (member: GroupMemberNode) => {
    if (!member.relId) return;
    execute(
      docId,
      cmdDeleteRelation(
        session,
        member.relId,
        `„${member.label}" aus „${member.groupLabel}"`,
        [member.expressId],
      ),
    );
  };

  if (model.groupCount === 0) {
    return (
      <div className="pane-body" style={{ padding: 12 }}>
        <div className="grp-empty">
          <p style={{ margin: 0, fontWeight: 500, color: "var(--text)" }}>
            Keine Gruppen im Modell.
          </p>
          <p style={{ margin: "6px 0 0" }}>
            Gruppen, Systeme und Zonen erscheinen hier, sobald das IFC
            IFCRELASSIGNSTOGROUP-Zuweisungen enthält. Neue Gruppen lassen sich
            über das Kontextmenü des Baums („Gruppen verwalten …") für die
            aktuelle Auswahl anlegen.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="pane-body" style={{ padding: "4px 4px 8px" }}>
      {model.categories.map((category) => {
        const groups = needle
          ? category.groups.filter((group) => groupMatches(group, needle))
          : category.groups;
        if (groups.length === 0) return null;
        return (
          <section key={category.label}>
            <div className="grp-cat">{category.label}</div>
            {groups.map((group) => (
              <GroupRow
                key={group.expressId}
                group={group}
                path={`${category.label}/${group.expressId}`}
                needle={needle}
                collapsed={collapsed}
                selectedIds={selectedIds}
                onToggle={toggle}
                onActivate={onActivate}
                onFocus={(id) => requestFocus(docId, id)}
                onManageGroups={onManageGroups}
                onRemoveMembership={removeMembership}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}

/** Trifft die Suche die Gruppe selbst oder (rekursiv) eines ihrer Mitglieder? */
function groupMatches(group: GroupNode, needle: string): boolean {
  if (rowText(group.label, group.type, group.expressId).includes(needle)) {
    return true;
  }
  return group.members.some(function matches(member): boolean {
    if (rowText(member.label, member.type, member.expressId).includes(needle)) {
      return true;
    }
    return member.children.some(matches);
  });
}

function rowText(label: string, type: string, expressId: number): string {
  return `${label} ${type} #${expressId}`.toLowerCase();
}

interface RowCallbacks {
  onToggle(path: string): void;
  onActivate(event: MouseEvent, expressId: number): void;
  onFocus(expressId: number): void;
  onManageGroups(expressId: number): void;
  onRemoveMembership(member: GroupMemberNode): void;
}

function GroupRow({
  group,
  path,
  needle,
  collapsed,
  selectedIds,
  ...callbacks
}: {
  group: GroupNode;
  path: string;
  needle: string;
  collapsed: Set<string>;
  selectedIds: ReadonlySet<number>;
} & RowCallbacks) {
  const isCollapsed = collapsed.has(path);
  return (
    <div>
      <EntityRow
        expressId={group.expressId}
        type={group.type}
        label={group.label}
        depth={0}
        isGroup
        hasChildren={group.members.length > 0}
        expanded={!isCollapsed}
        selected={selectedIds.has(group.expressId)}
        member={null}
        path={path}
        {...callbacks}
      />
      {!isCollapsed &&
        group.members.map((member, index) => (
          <MemberRows
            key={`${member.expressId}:${index}`}
            member={member}
            path={`${path}/${member.expressId}:${index}`}
            depth={1}
            needle={needle}
            collapsed={collapsed}
            selectedIds={selectedIds}
            {...callbacks}
          />
        ))}
    </div>
  );
}

function MemberRows({
  member,
  path,
  depth,
  needle,
  collapsed,
  selectedIds,
  ...callbacks
}: {
  member: GroupMemberNode;
  path: string;
  depth: number;
  needle: string;
  collapsed: Set<string>;
  selectedIds: ReadonlySet<number>;
} & RowCallbacks) {
  const isCollapsed = collapsed.has(path);
  return (
    <>
      <EntityRow
        expressId={member.expressId}
        type={member.type}
        label={member.label}
        depth={depth}
        isGroup={member.children.length > 0}
        hasChildren={member.children.length > 0}
        expanded={!isCollapsed}
        selected={selectedIds.has(member.expressId)}
        member={member}
        path={path}
        {...callbacks}
      />
      {!isCollapsed &&
        member.children.map((child, index) => (
          <MemberRows
            key={`${child.expressId}:${index}`}
            member={child}
            path={`${path}/${child.expressId}:${index}`}
            depth={depth + 1}
            needle={needle}
            collapsed={collapsed}
            selectedIds={selectedIds}
            {...callbacks}
          />
        ))}
    </>
  );
}

function EntityRow({
  expressId,
  type,
  label,
  depth,
  isGroup,
  hasChildren,
  expanded,
  selected,
  member,
  path,
  onToggle,
  onActivate,
  onFocus,
  onManageGroups,
  onRemoveMembership,
}: {
  expressId: number;
  type: string;
  label: string;
  depth: number;
  isGroup: boolean;
  hasChildren: boolean;
  expanded: boolean;
  selected: boolean;
  member: GroupMemberNode | null;
  path: string;
} & RowCallbacks) {
  return (
    <div
      className="grp-row"
      data-selected={selected ? "true" : undefined}
      style={{ paddingLeft: 6 + depth * 14 }}
      onClick={(event) => onActivate(event, expressId)}
      onDoubleClick={() => onFocus(expressId)}
      title={`#${expressId} · ${type}`}
    >
      {hasChildren ? (
        <button
          type="button"
          className="grp-chevron"
          aria-label={expanded ? "Zuklappen" : "Aufklappen"}
          onClick={(event) => {
            event.stopPropagation();
            onToggle(path);
          }}
        >
          {expanded ? "▾" : "▸"}
        </button>
      ) : (
        <span className="grp-chevron" aria-hidden="true" />
      )}
      <span className="grp-label" style={isGroup ? { fontWeight: 500 } : undefined}>
        {label}
      </span>
      <span className="grp-type">{type.replace(/^IFC/i, "")}</span>
      <span className="grp-actions">
        <button
          type="button"
          className="grp-action"
          title="Gruppen verwalten …"
          onClick={(event) => {
            event.stopPropagation();
            onManageGroups(expressId);
          }}
        >
          ⚙
        </button>
        {member ? (
          <button
            type="button"
            className="grp-action"
            title={
              member.relId
                ? `Aus „${member.groupLabel}" entfernen`
                : "Mitgliedschaft aus dem Parser ohne Record-Id — nicht lösbar"
            }
            disabled={!member.relId}
            onClick={(event) => {
              event.stopPropagation();
              onRemoveMembership(member);
            }}
          >
            ×
          </button>
        ) : null}
      </span>
    </div>
  );
}
