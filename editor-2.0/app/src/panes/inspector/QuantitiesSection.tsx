/**
 * Modus „Mengen": IfcElementQuantity-Sätze mit editierbaren Zahlenwerten.
 * Werte werden numerisch geprüft und über die Pipeline geschrieben
 * (`cmdSetQuantity`); zusätzlich lässt sich ein neuer Mengensatz mit erster
 * Menge anlegen (`cmdCreateQuantitySet`).
 */
import { useMemo, useState } from "react";
import { QuantityType } from "@ifc-lite/data";
import { useCommands, type EditorCommand } from "../../commands/pipeline";
import {
  cmdCreateQuantitySet,
  cmdSetQuantity,
} from "../../commands/quantityCommands";
import type { ModelSession } from "../../core/session";
import ValueEditor from "./ValueEditor";
import { DimValue, SectionHeading } from "./parts";
import { readQuantitySets } from "./overlay";
import { QUANTITY_TYPES, parseNumber } from "./values";

interface QuantitiesSectionProps {
  docId: string;
  session: ModelSession;
  expressId: number;
  /** Steigt bei jeder Mutation — erzwingt Neuladen der Mengen. */
  revision: number;
  onMutate(): void;
}

export default function QuantitiesSection({
  docId,
  session,
  expressId,
  revision,
  onMutate,
}: QuantitiesSectionProps) {
  const sets = useMemo(
    () => readQuantitySets(session, expressId),
    [session, expressId, revision],
  );

  function run(command: EditorCommand): void {
    useCommands.getState().execute(docId, command);
    onMutate();
  }

  return (
    <div>
      <NewQuantitySetForm
        existing={sets.map((s) => s.name)}
        onCreate={(qsetName, quantity) =>
          run(cmdCreateQuantitySet(session, expressId, qsetName, [quantity]))
        }
      />

      {sets.length === 0 && (
        <p className="pane-empty">
          Keine Mengen für dieses Objekt — oben einen Mengensatz anlegen.
        </p>
      )}

      {sets.map((set) => (
        <div key={set.name}>
          <SectionHeading>{set.name}</SectionHeading>
          <table className="kv-table">
            <thead>
              <tr>
                <th className="text-dim" style={{ width: "40%" }}>
                  Name
                </th>
                <th className="text-dim">Wert</th>
                <th className="text-dim" style={{ width: "20%" }}>
                  Einheit
                </th>
              </tr>
            </thead>
            <tbody>
              {set.quantities.map((quantity) => (
                <tr key={quantity.name}>
                  <td className="dim">{quantity.name}</td>
                  <td>
                    <ValueEditor
                      key={`${set.name}|${quantity.name}`}
                      value={String(quantity.value)}
                      kind="real"
                      onCommit={(draft) => {
                        const value = parseNumber(draft);
                        if (value === null) return;
                        run(
                          cmdSetQuantity(
                            session,
                            expressId,
                            set.name,
                            quantity.name,
                            value,
                            quantity.type,
                            quantity.unit,
                          ),
                        );
                      }}
                    />
                  </td>
                  <td className="dim">
                    <DimValue value={quantity.unit ?? ""} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

interface NewQuantitySetFormProps {
  existing: readonly string[];
  onCreate(
    qsetName: string,
    quantity: { name: string; value: number; quantityType: QuantityType },
  ): void;
}

function NewQuantitySetForm({ existing, onCreate }: NewQuantitySetFormProps) {
  const [qsetName, setQsetName] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<QuantityType>(QuantityType.Length);
  const [draft, setDraft] = useState("");

  const trimmedSet = qsetName.trim();
  const trimmedName = name.trim();
  const value = parseNumber(draft);
  const duplicate = existing.includes(trimmedSet);
  const ready =
    trimmedSet.length > 0 &&
    !duplicate &&
    trimmedName.length > 0 &&
    value !== null;

  function create(): void {
    if (!ready || value === null) return;
    onCreate(trimmedSet, { name: trimmedName, value, quantityType: type });
    setQsetName("");
    setName("");
    setDraft("");
  }

  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        alignItems: "center",
        padding: 8,
        borderBottom: "1px solid var(--border)",
        flexWrap: "wrap",
      }}
    >
      <span className="text-dim" style={{ fontSize: "0.75rem" }}>
        Neuer Mengensatz
      </span>
      <input
        className="input"
        style={{
          flex: "1 1 130px",
          minWidth: 100,
          borderColor: duplicate ? "var(--error)" : undefined,
        }}
        placeholder="z. B. Qto_WallBaseQuantities"
        value={qsetName}
        title={duplicate ? "Dieser Name ist bereits vergeben" : undefined}
        onChange={(event) => setQsetName(event.target.value)}
      />
      <input
        className="input"
        style={{ flex: "1 1 100px", minWidth: 80 }}
        placeholder="Menge"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <select
        className="input"
        value={type}
        onChange={(event) => setType(Number(event.target.value) as QuantityType)}
      >
        {QUANTITY_TYPES.map((entry) => (
          <option key={entry.type} value={entry.type}>
            {entry.label}
          </option>
        ))}
      </select>
      <input
        className="input"
        style={{
          width: 90,
          borderColor: draft && value === null ? "var(--error)" : undefined,
        }}
        placeholder="Wert"
        inputMode="decimal"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            create();
          }
        }}
      />
      <button className="btn" disabled={!ready} onClick={create}>
        Anlegen
      </button>
    </div>
  );
}
