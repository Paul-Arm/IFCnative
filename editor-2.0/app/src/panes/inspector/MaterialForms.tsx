/**
 * Anlegen-Formulare des Ressourcen-Modus, Teil Material (M9):
 * einfaches Material (neu oder vorhandenes wählen) und Schichtaufbau
 * (LayerSet + LayerSetUsage mit Richtung/Richtungssinn/Offset).
 */
import { useMemo, useState } from "react";
import type { ModelSession } from "../../core/session";
import {
  cmdAssignMaterial,
  cmdAssignMaterialLayers,
} from "../../commands/resourceCommands";
import type { LayerRow } from "../../domain/resources/emit";
import { existingResourceOptions } from "../../domain/resources/read";
import {
  NumberRow,
  ResourceForm,
  runResourceCommand,
  SelectRow,
  TextRow,
  useFormStatus,
} from "./resourceParts";

const NEW_OPTION = "0";

export function MaterialForm({
  docId,
  session,
  expressId,
  revision,
}: {
  docId: string;
  session: ModelSession;
  expressId: number;
  revision: number;
}) {
  const [status, setStatus] = useFormStatus();
  const [materialId, setMaterialId] = useState(NEW_OPTION);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");

  const options = useMemo(
    () => existingResourceOptions(session, ["IFCMATERIAL"]),
     
    [session, revision],
  );

  const useExisting = materialId !== NEW_OPTION;
  const submit = (): void =>
    runResourceCommand(
      docId,
      () =>
        cmdAssignMaterial(session, [expressId], {
          materialId: useExisting ? Number(materialId) : null,
          name: useExisting
            ? (options.find((o) => String(o.id) === materialId)?.label ?? "")
            : name,
          category,
        }),
      setStatus,
    );

  return (
    <ResourceForm
      title="Material zuweisen …"
      submitLabel="Zuweisen"
      status={status}
      onSubmit={submit}
      disabled={!useExisting && !name.trim()}
    >
      <SelectRow
        label="Material"
        value={materialId}
        onChange={setMaterialId}
        options={[
          { value: NEW_OPTION, label: "— Neu anlegen —" },
          ...options.map((o) => ({ value: String(o.id), label: o.label })),
        ]}
      />
      {!useExisting && (
        <>
          <TextRow label="Name" value={name} onChange={setName} placeholder="z. B. Beton C30/37" />
          <TextRow label="Kategorie" value={category} onChange={setCategory} placeholder="z. B. Concrete" />
        </>
      )}
    </ResourceForm>
  );
}

/** `Material;Dicke[;Schichtname[;Kategorie]]` je Zeile → LayerRow[]. */
function parseLayerRows(text: string): LayerRow[] {
  const rows: LayerRow[] = [];
  for (const line of text.split("\n")) {
    const parts = line.split(";").map((p) => p.trim());
    if (!parts[0]) continue;
    const thickness = Number.parseFloat((parts[1] ?? "").replace(",", "."));
    rows.push({
      materialName: parts[0],
      thickness: Number.isFinite(thickness) && thickness > 0 ? thickness : 0.1,
      name: parts[2] || undefined,
      category: parts[3] || undefined,
    });
  }
  return rows;
}

const DIRECTIONS = [
  { value: "AXIS1", label: "AXIS1 (X)" },
  { value: "AXIS2", label: "AXIS2 (Y)" },
  { value: "AXIS3", label: "AXIS3 (Z)" },
];
const SENSES = [
  { value: "POSITIVE", label: "Positiv" },
  { value: "NEGATIVE", label: "Negativ" },
];

export function MaterialLayersForm({
  docId,
  session,
  expressId,
}: {
  docId: string;
  session: ModelSession;
  expressId: number;
}) {
  const [status, setStatus] = useFormStatus();
  const [setName, setSetName] = useState("");
  const [direction, setDirection] = useState("AXIS2");
  const [sense, setSense] = useState("POSITIVE");
  const [offset, setOffset] = useState(0);
  const [rowsText, setRowsText] = useState("Beton;0.2;Kern;LoadBearing\nDämmung;0.08;Dämmung;Insulation");

  const submit = (): void =>
    runResourceCommand(
      docId,
      () =>
        cmdAssignMaterialLayers(session, [expressId], {
          setName,
          layers: parseLayerRows(rowsText),
          direction: direction as "AXIS1" | "AXIS2" | "AXIS3",
          sense: sense as "POSITIVE" | "NEGATIVE",
          offset,
        }),
      setStatus,
    );

  return (
    <ResourceForm
      title="Schichtaufbau zuweisen …"
      submitLabel="Zuweisen"
      status={status}
      onSubmit={submit}
      disabled={parseLayerRows(rowsText).length === 0}
    >
      <TextRow label="Set-Name" value={setName} onChange={setSetName} placeholder="z. B. Außenwand 28er" />
      <SelectRow label="Richtung" value={direction} onChange={setDirection} options={DIRECTIONS} />
      <SelectRow label="Richtungssinn" value={sense} onChange={setSense} options={SENSES} />
      <NumberRow label="Offset" value={offset} onChange={setOffset} />
      <div className="form-hint">
        Schichten: Material;Dicke;Name;Kategorie — eine je Zeile
      </div>
      <textarea
        className="input mono"
        rows={3}
        style={{ width: "100%", resize: "vertical" }}
        value={rowsText}
        onChange={(event) => setRowsText(event.target.value)}
      />
    </ResourceForm>
  );
}
