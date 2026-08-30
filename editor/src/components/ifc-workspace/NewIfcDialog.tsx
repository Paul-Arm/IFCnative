/**
 * Eingabemaske für "Neue IFC erstellen" (Startseite): fragt die benötigten
 * IFC-Startwerte ab — Projektname, Autor/Organisation (STEP-Header) und die
 * räumliche Grundstruktur Standort → Gebäude → Geschoss. Daraus entsteht
 * eine frische IFC4X3-Datei mit zufälligen GlobalIds.
 */

import { FilePlus2 } from "lucide-react";
import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { Button, CheckboxField, LabeledInput } from "./ui";

/** Vom Formular abgefragte Startwerte einer neuen IFC-Datei. */
export interface NewIfcDraft {
  fileName: string;
  projectName: string;
  author: string;
  organization: string;
  siteName: string;
  buildingName: string;
  storeyName: string;
  /** Beispielquader als erstes Bauteil einfügen (sonst nur Struktur). */
  includeSampleProduct: boolean;
}

export interface NewIfcDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (draft: NewIfcDraft) => void;
}

function toIfcFileName(name: string): string {
  const trimmed = name.trim() || "Neues Projekt";
  return /\.ifc$/i.test(trimmed) ? trimmed : `${trimmed}.ifc`;
}

export function NewIfcDialog({ open, onOpenChange, onCreate }: NewIfcDialogProps) {
  const [projectName, setProjectName] = useState("Neues Projekt");
  const [fileName, setFileName] = useState("Neues Projekt.ifc");
  // Solange der Dateiname nicht von Hand geändert wurde, folgt er dem
  // Projektnamen.
  const [fileNameTouched, setFileNameTouched] = useState(false);
  const [author, setAuthor] = useState("");
  const [organization, setOrganization] = useState("");
  const [siteName, setSiteName] = useState("Gelände");
  const [buildingName, setBuildingName] = useState("Gebäude A");
  const [storeyName, setStoreyName] = useState("EG");
  const [includeSampleProduct, setIncludeSampleProduct] = useState(false);

  // Frischer Formularzustand bei jedem Öffnen.
  useEffect(() => {
    if (open) {
      setProjectName("Neues Projekt");
      setFileName("Neues Projekt.ifc");
      setFileNameTouched(false);
      setAuthor("");
      setOrganization("");
      setSiteName("Gelände");
      setBuildingName("Gebäude A");
      setStoreyName("EG");
      setIncludeSampleProduct(false);
    }
  }, [open]);

  const handleProjectNameChange = (next: string) => {
    setProjectName(next);
    if (!fileNameTouched) {
      setFileName(toIfcFileName(next));
    }
  };

  const canCreate = Boolean(projectName.trim());

  const handleCreate = () => {
    if (!canCreate) {
      return;
    }
    onCreate({
      author: author.trim(),
      buildingName: buildingName.trim() || "Gebäude",
      fileName: toIfcFileName(fileName),
      includeSampleProduct,
      organization: organization.trim(),
      projectName: projectName.trim(),
      siteName: siteName.trim() || "Gelände",
      storeyName: storeyName.trim() || "EG",
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Neue IFC erstellen</DialogTitle>
          <DialogDescription>
            Startwerte der neuen Datei — Schema IFC4X3, SI-Einheiten (Meter),
            räumliche Struktur Projekt → Standort → Gebäude → Geschoss.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2.5">
          <div className="grid gap-2.5 sm:grid-cols-2">
            <LabeledInput
              label="Projektname"
              value={projectName}
              onChangeText={handleProjectNameChange}
            />
            <LabeledInput
              label="Dateiname"
              mono
              value={fileName}
              onChangeText={(next) => {
                setFileName(next);
                setFileNameTouched(true);
              }}
            />
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <LabeledInput
              label="Autor (STEP-Header)"
              value={author}
              onChangeText={setAuthor}
            />
            <LabeledInput
              label="Organisation (STEP-Header)"
              value={organization}
              onChangeText={setOrganization}
            />
          </div>
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
          <CheckboxField
            checked={includeSampleProduct}
            description="Ein Quader mit Beispiel-Eigenschaften als erstes Bauteil im Geschoss."
            label="Beispielobjekt einfügen"
            onCheckedChange={setIncludeSampleProduct}
          />
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Abbrechen</Button>
          <Button disabled={!canCreate} variant="default" onClick={handleCreate}>
            <FilePlus2 aria-hidden className="size-3.5" />
            Erstellen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
