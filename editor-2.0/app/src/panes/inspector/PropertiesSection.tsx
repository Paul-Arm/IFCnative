/**
 * Modus „Eigenschaften": alle Psets eines Objekts als editierbare Tabellen.
 * Jeder Schreibpfad — Wert setzen, Property löschen/anlegen, Pset anlegen,
 * umbenennen, duplizieren, löschen — läuft als Command durch die Pipeline und
 * ist damit undo-fähig und im Audit-Log sichtbar.
 */
import { useMemo, useState } from "react";
import type { PropertyValueType } from "@ifc-lite/data";
import {
  useCommands,
  useDocRevision,
  type EditorCommand,
} from "../../commands/pipeline";
import {
  cmdDeleteProperty,
  cmdSetProperty,
} from "../../commands/propertyCommands";
import {
  COPY_SUFFIX,
  cmdCreatePset,
  cmdDeletePset,
  cmdDuplicatePset,
  cmdRenamePset,
} from "../../commands/psetCommands";
import type { ModelSession } from "../../core/session";
import PsetBlock, { type PropertyCommit } from "./PsetBlock";
import { readPsets, type EditablePset } from "./overlay";
import { toDraft } from "./values";

interface PropertiesSectionProps {
  docId: string;
  session: ModelSession;
  expressId: number;
  /** Freitextfilter über Pset-Name, Property-Name und Wert. */
  query: string;
}

export default function PropertiesSection({
  docId,
  session,
  expressId,
  query,
}: PropertiesSectionProps) {
  // Dokumentweite Revision (do/undo/redo) statt pane-lokalem Zähler.
  const revision = useDocRevision(docId);

  const psets = useMemo(
    () => readPsets(session, expressId),
    [session, expressId, revision],
  );
  const visible = useMemo(() => filterPsets(psets, query), [psets, query]);

  function run(command: EditorCommand): void {
    useCommands.getState().execute(docId, command);
  }

  function setProperty(
    psetName: string,
    propName: string,
    type: PropertyValueType,
    value: PropertyCommit,
  ): void {
    run(cmdSetProperty(session, expressId, psetName, propName, value, type));
  }

  return (
    <div>
      <NewPsetForm
        existing={psets.map((p) => p.name)}
        onCreate={(name) => run(cmdCreatePset(session, expressId, name))}
      />

      {psets.length === 0 && (
        <p className="pane-empty">
          Keine Eigenschaftssätze für dieses Objekt — oben einen anlegen.
        </p>
      )}
      {psets.length > 0 && visible.length === 0 && (
        <p className="pane-empty">Kein Treffer für „{query}".</p>
      )}

      {visible.map((pset) => (
        <PsetBlock
          key={pset.name}
          pset={pset}
          takenNames={psets.map((p) => p.name)}
          onSetProperty={(propName, type, value) =>
            setProperty(pset.name, propName, type, value)
          }
          onDeleteProperty={(propName, type) =>
            run(cmdDeleteProperty(session, expressId, pset.name, propName, type))
          }
          onRename={(newName) =>
            run(cmdRenamePset(session, expressId, pset.name, newName))
          }
          onDuplicate={() =>
            run(
              cmdDuplicatePset(
                session,
                expressId,
                pset.name,
                uniqueName(
                  `${pset.name}${COPY_SUFFIX}`,
                  psets.map((p) => p.name),
                ),
              ),
            )
          }
          onDelete={() => run(cmdDeletePset(session, expressId, pset.name))}
        />
      ))}
    </div>
  );
}

interface NewPsetFormProps {
  existing: readonly string[];
  onCreate(name: string): void;
}

function NewPsetForm({ existing, onCreate }: NewPsetFormProps) {
  const [name, setName] = useState("");
  const trimmed = name.trim();
  const duplicate = existing.includes(trimmed);
  const ready = trimmed.length > 0 && !duplicate;

  function create(): void {
    if (!ready) return;
    onCreate(trimmed);
    setName("");
  }

  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        alignItems: "center",
        padding: "8px",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <span className="text-dim" style={{ fontSize: "0.75rem" }}>
        Neues Pset
      </span>
      <input
        className="input"
        style={{
          flex: 1,
          minWidth: 90,
          borderColor: duplicate ? "var(--error)" : undefined,
        }}
        placeholder="z. B. Pset_WallCommon"
        value={name}
        title={duplicate ? "Dieser Name ist bereits vergeben" : undefined}
        onChange={(event) => setName(event.target.value)}
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

/** „X (Kopie)", „X (Kopie) 2", … — erster Name, der noch frei ist. */
function uniqueName(candidate: string, taken: readonly string[]): string {
  if (!taken.includes(candidate)) return candidate;
  for (let index = 2; index < 1000; index += 1) {
    const next = `${candidate} ${index}`;
    if (!taken.includes(next)) return next;
  }
  return `${candidate} ${Date.now()}`;
}

function filterPsets(psets: EditablePset[], query: string): EditablePset[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return psets;
  const result: EditablePset[] = [];
  for (const pset of psets) {
    if (pset.name.toLowerCase().includes(needle)) {
      result.push(pset);
      continue;
    }
    const properties = pset.properties.filter(
      (p) =>
        p.name.toLowerCase().includes(needle) ||
        toDraft(p.value).toLowerCase().includes(needle),
    );
    if (properties.length > 0) result.push({ name: pset.name, properties });
  }
  return result;
}
