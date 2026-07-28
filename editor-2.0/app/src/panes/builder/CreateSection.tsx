/**
 * Abschnitt „Neues Bauteil": Klasse, Profil, Maße, Position und Parent.
 * Der Parent ist der ausgewählte räumliche Knoten, sonst die Auswahl aus
 * dem Strukturbaum (Geschoss vorausgewählt).
 */
import { useMemo, useState } from "react";
import type { ModelSession } from "../../core/session";
import { useCommands, useDocRevision } from "../../commands/pipeline";
import { cmdCreateElement } from "../../commands/geometryCommands";
import { useSelection } from "../../store/selection";
import {
  BUILDER_CLASSES,
  DEFAULT_CREATE_PARAMS,
  PROFILE_LABELS,
  builderClass,
  type BuilderClassId,
  type CreateElementParams,
  type ProfileKind,
} from "../../domain/geometry";
import { usePickStore } from "../viewer/pickStore";
import { formatPointStatus, roundMm } from "../viewer/worldCoords";
import { defaultParent, spatialOptions } from "./spatialOptions";
import {
  NumberField,
  SectionTitle,
  SelectField,
  StatusLine,
  TextField,
} from "./fields";

const CLASS_OPTIONS = BUILDER_CLASSES.map((entry) => ({
  value: entry.id,
  label: entry.label,
}));

const PROFILE_OPTIONS = (
  Object.keys(PROFILE_LABELS) as ProfileKind[]
).map((kind) => ({ value: kind, label: PROFILE_LABELS[kind] }));

export default function CreateSection({
  docId,
  session,
  selectedSpatialId,
}: {
  docId: string;
  session: ModelSession;
  /** Ausgewählter räumlicher Knoten, falls vorhanden */
  selectedSpatialId: number | null;
}) {
  const revision = useDocRevision(docId);
  const options = useMemo(
    () => spatialOptions(session),
    [session, revision],
  );
  const [parentChoice, setParentChoice] = useState<number | null>(null);
  const [params, setParams] = useState<CreateElementParams>(
    DEFAULT_CREATE_PARAMS,
  );
  const [status, setStatus] = useState<{ text: string; error?: boolean }>({
    text: "",
  });
  // Letzter 3D-Pick aus dem Viewer (M9) — nur Punkte DIESES Dokuments.
  const lastPick = usePickStore((s) => s.last);
  const pick = lastPick && lastPick.docId === docId ? lastPick : null;

  const parentId =
    selectedSpatialId ?? parentChoice ?? defaultParent(options);
  const def = builderClass(params.klasse);
  const patch = (next: Partial<CreateElementParams>): void =>
    setParams((current) => ({ ...current, ...next }));

  function create(): void {
    if (parentId === null) {
      setStatus({ text: "Kein räumlicher Elternknoten verfügbar.", error: true });
      return;
    }
    try {
      const command = cmdCreateElement(session, parentId, params);
      useCommands.getState().execute(docId, command);
      const created = command.createdId();
      if (created !== null) useSelection.getState().select(docId, created);
      setStatus({ text: `Angelegt: #${created ?? "?"} — ${command.label}` });
    } catch (error) {
      setStatus({
        text: error instanceof Error ? error.message : String(error),
        error: true,
      });
    }
  }

  return (
    <section>
      <SectionTitle
        title="Neues Bauteil"
        note={`Alle Maße in Metern, Position relativ zum Elternknoten. ${def.hint}`}
      />

      {selectedSpatialId !== null ? (
        <p className="text-dim" style={{ fontSize: "0.75rem", margin: "0 0 6px" }}>
          Parent aus Auswahl: {session.labelOf(selectedSpatialId)}
        </p>
      ) : (
        <SelectField
          label="Parent"
          value={String(parentId ?? "")}
          options={options.map((option) => ({
            value: String(option.expressId),
            label: option.label,
          }))}
          onChange={(value) => setParentChoice(Number.parseInt(value, 10))}
          hint="Räumlicher Knoten, in den das Bauteil eingehängt wird"
        />
      )}

      <SelectField
        label="Klasse"
        value={params.klasse}
        options={CLASS_OPTIONS}
        onChange={(value) => patch({ klasse: value as BuilderClassId })}
      />
      <SelectField
        label="Profil"
        value={params.profil}
        options={PROFILE_OPTIONS}
        onChange={(value) => patch({ profil: value as ProfileKind })}
      />

      {params.profil === "rechteck" ? (
        <>
          <NumberField
            label="Breite (X)"
            value={params.breite}
            onChange={(value) => patch({ breite: value })}
          />
          <NumberField
            label="Tiefe (Y)"
            value={params.tiefe}
            onChange={(value) => patch({ tiefe: value })}
          />
        </>
      ) : (
        <NumberField
          label="Radius"
          value={params.radius}
          onChange={(value) => patch({ radius: value })}
        />
      )}
      <NumberField
        label="Höhe / Länge"
        value={params.hoehe}
        onChange={(value) => patch({ hoehe: value })}
        hint={def.hint}
      />

      <NumberField
        label="Position X"
        value={params.x}
        step={0.1}
        onChange={(value) => patch({ x: value })}
      />
      <NumberField
        label="Position Y"
        value={params.y}
        step={0.1}
        onChange={(value) => patch({ y: value })}
      />
      <NumberField
        label="Position Z"
        value={params.z}
        step={0.1}
        onChange={(value) => patch({ z: value })}
      />
      <button
        className="btn"
        disabled={!pick}
        title={
          pick
            ? `Übernimmt ${formatPointStatus(pick)} (Weltkoordinaten — passt, ` +
              "solange der Elternknoten im Ursprung liegt)."
            : "Erst im Viewer mit „Koordinaten picken" einen Punkt wählen."
        }
        onClick={() =>
          pick &&
          patch({ x: roundMm(pick.x), y: roundMm(pick.y), z: roundMm(pick.z) })
        }
      >
        Position aus Pick übernehmen
      </button>

      <TextField
        label="Name"
        value={params.name}
        placeholder={def.label}
        onChange={(value) => patch({ name: value })}
      />
      <TextField
        label="Tag"
        value={params.tag}
        placeholder="optional"
        onChange={(value) => patch({ tag: value })}
      />

      <button
        className="btn"
        data-active="true"
        style={{ marginTop: 6 }}
        onClick={create}
      >
        Erstellen
      </button>
      <StatusLine text={status.text} error={status.error} />
    </section>
  );
}
