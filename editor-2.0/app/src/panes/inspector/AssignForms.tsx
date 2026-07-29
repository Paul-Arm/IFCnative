/**
 * Anlegen-Formulare des Ressourcen-Modus, Teil 2 (M9): Klassifikation,
 * Dokument, Gruppe/Zone/System, Typzuweisung und SI-Einheit (modellweit).
 * Jedes Formular committet genau einen Command über die Pipeline.
 */
import { useMemo, useState } from "react";
import type { ModelSession } from "../../core/session";
import {
  cmdAddSiUnit,
  cmdAssignClassification,
  cmdAssignDocument,
  cmdAssignToGroup,
  cmdAssignType,
} from "../../commands/resourceCommands";
import {
  GROUP_CLASSES,
  TYPE_CLASSES,
  type GroupClass,
} from "../../domain/resources/objects";
import { existingResourceOptions } from "../../domain/resources/read";
import {
  ResourceForm,
  runResourceCommand,
  SelectRow,
  TextRow,
  useFormStatus,
} from "./resourceParts";

const NEW_OPTION = "0";

interface TargetProps {
  docId: string;
  session: ModelSession;
  expressId: number;
  revision: number;
}

export function ClassificationForm({ docId, session, expressId }: TargetProps) {
  const [status, setStatus] = useFormStatus();
  const [system, setSystem] = useState("");
  const [identification, setIdentification] = useState("");
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");

  return (
    <ResourceForm
      title="Klassifikation zuweisen …"
      submitLabel="Zuweisen"
      status={status}
      disabled={!system.trim() || !identification.trim()}
      onSubmit={() =>
        runResourceCommand(
          docId,
          () =>
            cmdAssignClassification(session, [expressId], {
              system,
              identification,
              name,
              location,
            }),
          setStatus,
        )
      }
    >
      <TextRow label="System" value={system} onChange={setSystem} placeholder="z. B. DIN 276" />
      <TextRow label="Kennung" value={identification} onChange={setIdentification} placeholder="z. B. KG 331" />
      <TextRow label="Name" value={name} onChange={setName} placeholder="z. B. Tragende Wände" />
      <TextRow label="Ort/URL" value={location} onChange={setLocation} />
    </ResourceForm>
  );
}

export function DocumentForm({ docId, session, expressId }: TargetProps) {
  const [status, setStatus] = useFormStatus();
  const [identification, setIdentification] = useState("");
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");

  return (
    <ResourceForm
      title="Dokument zuweisen …"
      submitLabel="Zuweisen"
      status={status}
      disabled={!name.trim() && !identification.trim()}
      onSubmit={() =>
        runResourceCommand(
          docId,
          () =>
            cmdAssignDocument(session, [expressId], {
              identification,
              name,
              location,
              description,
            }),
          setStatus,
        )
      }
    >
      <TextRow label="Kennung" value={identification} onChange={setIdentification} placeholder="z. B. PLAN-001" />
      <TextRow label="Name" value={name} onChange={setName} placeholder="z. B. Grundriss EG" />
      <TextRow label="Ort/URL" value={location} onChange={setLocation} />
      <TextRow label="Beschreibung" value={description} onChange={setDescription} />
    </ResourceForm>
  );
}

export function GroupForm({ docId, session, expressId, revision }: TargetProps) {
  const [status, setStatus] = useFormStatus();
  const [groupId, setGroupId] = useState(NEW_OPTION);
  const [groupClass, setGroupClass] = useState<string>("IFCGROUP");
  const [name, setName] = useState("");
  const [longName, setLongName] = useState("");

  const options = useMemo(
    () =>
      existingResourceOptions(session, ["IFCGROUP", "IFCZONE", "IFCSYSTEM"]),
     
    [session, revision],
  );
  const useExisting = groupId !== NEW_OPTION;

  return (
    <ResourceForm
      title="Gruppe/Zone/System zuweisen …"
      submitLabel="Zuweisen"
      status={status}
      disabled={!useExisting && !name.trim()}
      onSubmit={() =>
        runResourceCommand(
          docId,
          () =>
            cmdAssignToGroup(session, [expressId], {
              groupId: useExisting ? Number(groupId) : null,
              groupClass: groupClass as GroupClass,
              name: useExisting
                ? (options.find((o) => String(o.id) === groupId)?.label ?? "")
                : name,
              longName,
            }),
          setStatus,
        )
      }
    >
      <SelectRow
        label="Gruppe"
        value={groupId}
        onChange={setGroupId}
        options={[
          { value: NEW_OPTION, label: "— Neu anlegen —" },
          ...options.map((o) => ({ value: String(o.id), label: o.label })),
        ]}
      />
      {!useExisting && (
        <>
          <SelectRow
            label="Art"
            value={groupClass}
            onChange={setGroupClass}
            options={GROUP_CLASSES.map((g) => ({ value: g.value, label: g.label }))}
          />
          <TextRow label="Name" value={name} onChange={setName} placeholder="z. B. Brandabschnitt BA1" />
          {groupClass === "IFCZONE" && (
            <TextRow label="LongName" value={longName} onChange={setLongName} />
          )}
        </>
      )}
    </ResourceForm>
  );
}

export function TypeForm({ docId, session, expressId, revision }: TargetProps) {
  const [status, setStatus] = useFormStatus();
  const [typeId, setTypeId] = useState(NEW_OPTION);
  const [typeClass, setTypeClass] = useState("IFCWALLTYPE");
  const [name, setName] = useState("");
  const [tag, setTag] = useState("");

  const options = useMemo(
    () =>
      existingResourceOptions(
        session,
        TYPE_CLASSES.map((def) => def.ifcClass),
      ),
     
    [session, revision],
  );
  const useExisting = typeId !== NEW_OPTION;

  return (
    <ResourceForm
      title="Typ zuweisen …"
      submitLabel="Zuweisen"
      status={status}
      disabled={!useExisting && !name.trim()}
      onSubmit={() =>
        runResourceCommand(
          docId,
          () =>
            cmdAssignType(session, [expressId], {
              typeId: useExisting ? Number(typeId) : null,
              typeClass,
              name: useExisting
                ? (options.find((o) => String(o.id) === typeId)?.label ?? "")
                : name,
              tag,
            }),
          setStatus,
        )
      }
    >
      <SelectRow
        label="Typ-Objekt"
        value={typeId}
        onChange={setTypeId}
        options={[
          { value: NEW_OPTION, label: "— Neu anlegen —" },
          ...options.map((o) => ({ value: String(o.id), label: o.label })),
        ]}
      />
      {!useExisting && (
        <>
          <SelectRow
            label="Klasse"
            value={typeClass}
            onChange={setTypeClass}
            options={TYPE_CLASSES.map((def) => ({
              value: def.ifcClass,
              label: def.label,
            }))}
          />
          <TextRow label="Name" value={name} onChange={setName} placeholder="z. B. AW 24 Beton" />
          <TextRow label="Tag" value={tag} onChange={setTag} />
        </>
      )}
    </ResourceForm>
  );
}

const UNIT_TYPES = ["LENGTHUNIT", "AREAUNIT", "VOLUMEUNIT", "MASSUNIT", "TIMEUNIT"];
const UNIT_NAMES = ["METRE", "SQUARE_METRE", "CUBIC_METRE", "GRAM", "SECOND"];
const UNIT_PREFIXES = ["", "MILLI", "CENTI", "DECI", "KILO"];
const toOptions = (values: readonly string[]): Array<{ value: string; label: string }> =>
  values.map((v) => ({ value: v, label: v || "— ohne —" }));

/** Einheiten sind modellweit — das Formular braucht keine Auswahl. */
export function UnitForm({ docId, session }: { docId: string; session: ModelSession }) {
  const [status, setStatus] = useFormStatus();
  const [unitType, setUnitType] = useState("AREAUNIT");
  const [prefix, setPrefix] = useState("");
  const [name, setName] = useState("SQUARE_METRE");

  return (
    <ResourceForm
      title="SI-Einheit ergänzen …"
      submitLabel="Hinzufügen"
      status={status}
      onSubmit={() =>
        runResourceCommand(
          docId,
          () => cmdAddSiUnit(session, { unitType, prefix: prefix || null, name }),
          setStatus,
          "Einheit ergänzt.",
        )
      }
    >
      <SelectRow label="UnitType" value={unitType} onChange={setUnitType} options={toOptions(UNIT_TYPES)} />
      <SelectRow label="Präfix" value={prefix} onChange={setPrefix} options={toOptions(UNIT_PREFIXES)} />
      <SelectRow label="Einheit" value={name} onChange={setName} options={toOptions(UNIT_NAMES)} />
    </ResourceForm>
  );
}
