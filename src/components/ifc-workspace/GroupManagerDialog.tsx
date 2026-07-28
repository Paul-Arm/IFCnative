import { Plus, Ungroup } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { NativeIfcDocument, NativeIfcEntity } from "@/ifc";

import { GROUP_ENTITY_TYPES, GROUP_TYPES } from "./constants";
import { DropdownField } from "./ui";

/**
 * Popup „Gruppen verwalten": zeigt die Gruppenmitgliedschaften eines Objekts
 * und erlaubt Zuweisen zu einer bestehenden bzw. Anlegen einer neuen Gruppe.
 * Der Dialog bleibt nach Aktionen offen — das Dokument fließt über Props
 * zurück, die Mitgliederliste aktualisiert sich live.
 */
export function GroupManagerDialog({
  document,
  entity,
  onAssignToGroup,
  onClose,
  onCreateGroup,
  onRemoveMembership,
}: {
  document: NativeIfcDocument;
  entity: NativeIfcEntity | null;
  onAssignToGroup(entityId: number, groupId: number): void;
  onClose(): void;
  onCreateGroup(entityId: number, groupType: string, groupName: string): void;
  onRemoveMembership(memberId: number, groupId: number): void;
}) {
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [newGroupType, setNewGroupType] = useState(GROUP_TYPES[0]);
  const [newGroupName, setNewGroupName] = useState("");

  // Formularzustand pro Ziel-Entität zurücksetzen.
  useEffect(() => {
    setSelectedGroupId("");
    setNewGroupName("");
  }, [entity?.id]);

  const memberships = useMemo(() => {
    if (!entity) return [];
    const groups: NativeIfcEntity[] = [];
    for (const relationship of document.relationships) {
      if (!relationship.type.startsWith("IFCRELASSIGNSTOGROUP")) continue;
      if (!relationship.sourceIds.includes(entity.id)) continue;
      for (const groupId of relationship.targetIds) {
        const group = document.entityById.get(groupId);
        if (group && !groups.some((known) => known.id === group.id)) {
          groups.push(group);
        }
      }
    }
    return groups;
  }, [document, entity]);

  const assignableGroups = useMemo(() => {
    if (!entity) return [];
    return document.entities.filter(
      (candidate) =>
        GROUP_ENTITY_TYPES.has(candidate.type) &&
        candidate.id !== entity.id &&
        !memberships.some((group) => group.id === candidate.id),
    );
  }, [document, entity, memberships]);

  const entityLabel = entity
    ? `#${entity.id} ${entity.type}${entity.name ? ` · ${entity.name}` : ""}`
    : "";

  return (
    <Dialog
      open={Boolean(entity)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Gruppen verwalten</DialogTitle>
          <DialogDescription>{entityLabel}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <section className="grid gap-1.5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Mitglied in
            </h3>
            {memberships.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Keine Gruppenmitgliedschaften.
              </p>
            ) : (
              <ul className="grid gap-1">
                {memberships.map((group) => (
                  <li
                    key={group.id}
                    className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {group.name || `#${group.id}`}
                    </span>
                    <span className="shrink-0 text-[10px] uppercase text-muted-foreground">
                      #{group.id} · {group.type.replace(/^IFC/i, "")}
                    </span>
                    <Button
                      aria-label={`Aus '${group.name || `#${group.id}`}' entfernen`}
                      className="size-6 shrink-0"
                      size="icon"
                      title="Aus Gruppe entfernen"
                      variant="ghost"
                      onClick={() =>
                        entity && onRemoveMembership(entity.id, group.id)
                      }
                    >
                      <Ungroup aria-hidden className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="grid gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Zu bestehender Gruppe hinzufügen
            </h3>
            {assignableGroups.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Keine weiteren Gruppen im Modell.
              </p>
            ) : (
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <DropdownField
                    label="Gruppe"
                    options={assignableGroups.map((group) => ({
                      detail: `#${group.id} · ${group.type}`,
                      label: group.name || `#${group.id}`,
                      value: String(group.id),
                    }))}
                    value={selectedGroupId}
                    onChange={setSelectedGroupId}
                  />
                </div>
                <Button
                  disabled={!selectedGroupId}
                  variant="outline"
                  onClick={() => {
                    if (!entity || !selectedGroupId) return;
                    onAssignToGroup(entity.id, Number(selectedGroupId));
                    setSelectedGroupId("");
                  }}
                >
                  <Plus aria-hidden className="size-3.5" /> Hinzufügen
                </Button>
              </div>
            )}
          </section>

          <section className="grid gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Neue Gruppe anlegen
            </h3>
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-2">
              <DropdownField
                label="Gruppentyp"
                options={GROUP_TYPES}
                value={newGroupType}
                onChange={setNewGroupType}
              />
              <label className="grid min-w-0 gap-1.5 text-xs text-muted-foreground">
                Gruppenname
                <Input
                  placeholder="z. B. Brandabschnitt A"
                  value={newGroupName}
                  onChange={(event) =>
                    setNewGroupName(event.currentTarget.value)
                  }
                />
              </label>
            </div>
            <Button
              variant="default"
              onClick={() => {
                if (!entity) return;
                onCreateGroup(entity.id, newGroupType, newGroupName);
                setNewGroupName("");
              }}
            >
              <Plus aria-hidden className="size-3.5" /> Anlegen & zuweisen
            </Button>
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Schließen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
