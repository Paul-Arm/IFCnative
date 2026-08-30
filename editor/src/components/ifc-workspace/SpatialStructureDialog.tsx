/**
 * Eingabemaske für "Raumstruktur anlegen": vervollständigt in einem
 * geöffneten Dokument (z. B. einem leeren Hub-Modell) die räumliche
 * Grundstruktur Projekt → Standort → Gebäude → Geschoss und kann dabei
 * freie Bauteile ohne Zuordnung direkt in das Geschoss hängen.
 */

import { Network } from "lucide-react";
import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { NativeSpatialStructureDraft } from "@/ifc";

import { Button, CheckboxField, LabeledInput } from "./ui";

export interface SpatialStructureDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existiert bereits ein IFCPROJECT? Dann entfällt das Namensfeld. */
  hasProject: boolean;
  /** Vorbelegung des Projektnamens (z. B. Dateiname ohne Endung). */
  defaultProjectName: string;
  /** Anzahl der Bauteile ohne räumliche Zuordnung im Dokument. */
  orphanCount: number;
  onCreate: (draft: NativeSpatialStructureDraft) => void;
}

export function SpatialStructureDialog({
  open,
  onOpenChange,
  hasProject,
  defaultProjectName,
  orphanCount,
  onCreate,
}: SpatialStructureDialogProps) {
  const [projectName, setProjectName] = useState(defaultProjectName);
  const [siteName, setSiteName] = useState("Gelände");
  const [buildingName, setBuildingName] = useState("Gebäude A");
  const [storeyName, setStoreyName] = useState("EG");
  const [adoptOrphans, setAdoptOrphans] = useState(true);

  // Frischer Formularzustand bei jedem Öffnen.
  useEffect(() => {
    if (open) {
      setProjectName(defaultProjectName);
      setSiteName("Gelände");
      setBuildingName("Gebäude A");
      setStoreyName("EG");
      setAdoptOrphans(true);
    }
  }, [open, defaultProjectName]);

  const canCreate = hasProject || Boolean(projectName.trim());

  const handleCreate = () => {
    if (!canCreate) {
      return;
    }
    onCreate({
      adoptOrphans: orphanCount > 0 && adoptOrphans,
      buildingName: buildingName.trim() || "Gebäude",
      projectName: projectName.trim() || "Projekt",
      siteName: siteName.trim() || "Gelände",
      storeyName: storeyName.trim() || "EG",
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Raumstruktur anlegen</DialogTitle>
          <DialogDescription>
            Ergänzt die fehlenden Ebenen Projekt → Standort → Gebäude →
            Geschoss; vorhandene Ebenen werden wiederverwendet.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2.5">
          {!hasProject ? (
            <LabeledInput
              label="Projektname"
              value={projectName}
              onChangeText={setProjectName}
            />
          ) : null}
          <div className="grid gap-2.5 sm:grid-cols-3">
            <LabeledInput
              label="Standort (Site)"
              value={siteName}
              onChangeText={setSiteName}
            />
            <LabeledInput
              label="Gebäude"
              value={buildingName}
              onChangeText={setBuildingName}
            />
            <LabeledInput
              label="Geschoss"
              value={storeyName}
              onChangeText={setStoreyName}
            />
          </div>
          {orphanCount > 0 ? (
            <CheckboxField
              checked={adoptOrphans}
              description="Bauteile ohne räumliche Zuordnung werden per Containment in das Geschoss gehängt."
              label={`${orphanCount} freie${orphanCount === 1 ? "s" : ""} Bauteil${orphanCount === 1 ? "" : "e"} dem Geschoss zuordnen`}
              onCheckedChange={setAdoptOrphans}
            />
          ) : null}
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Abbrechen</Button>
          <Button disabled={!canCreate} variant="default" onClick={handleCreate}>
            <Network aria-hidden className="size-3.5" />
            Anlegen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
