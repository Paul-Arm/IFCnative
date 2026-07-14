import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { NativeEntityRemovalPlan, NativeIfcEntity } from "@/ifc";

export function DeleteEntityDialog({
  entity,
  onCancel,
  onConfirm,
  plan,
}: {
  entity: NativeIfcEntity | null;
  onCancel(): void;
  onConfirm(): void;
  plan: NativeEntityRemovalPlan | null;
}) {
  const removedCount = plan?.removedEntityIds.length ?? 0;
  const relationshipCount = plan?.relationshipCount ?? 0;
  const additionalCount = Math.max(
    0,
    removedCount - relationshipCount - (entity ? 1 : 0),
  );

  return (
    <Dialog
      open={Boolean(entity && plan)}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>IFC-Entität wirklich löschen?</DialogTitle>
          <DialogDescription>
            #{entity?.id} {entity?.type}
            {entity?.name ? ` · ${entity.name}` : ""} wird aus dem nativen
            IFC-Dokument entfernt.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm">
          <strong className="block text-destructive">
            Diese Aktion entfernt {removedCount.toLocaleString("de-DE")} IFC-
            {removedCount === 1 ? "Entität" : "Entitäten"}.
          </strong>
          <span className="mt-1 block text-muted-foreground">
            Darunter {relationshipCount.toLocaleString("de-DE")} Beziehungen
            {additionalCount > 0
              ? ` und ${additionalCount.toLocaleString("de-DE")} weitere abhängige Entitäten/Ressourcen`
              : ""}
            . Die Aktion kann anschließend mit Strg+Z rückgängig gemacht werden.
          </span>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Abbrechen
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            <Trash2 aria-hidden />
            Löschen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
