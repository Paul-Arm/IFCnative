/**
 * Modus „Übersicht": Identität des Objekts plus eine kurze Zusammenfassung.
 * Name, Beschreibung und ObjectType sind editierbar (Commit bei Blur oder
 * Enter) und laufen über `cmdSetAttribute` durch die Pipeline. GlobalId,
 * Klasse und expressId bleiben bewusst schreibgeschützt.
 */
import { useMemo, useState } from "react";
import { useCommands, useDocRevision } from "../../commands/pipeline";
import { cmdSetAttribute } from "../../commands/propertyCommands";
import type { ModelSession } from "../../core/session";
import ValueEditor from "./ValueEditor";
import { DimValue } from "./parts";
import { readAttributes, readPsets, readQuantitySets } from "./overlay";

interface OverviewSectionProps {
  docId: string;
  session: ModelSession;
  expressId: number;
}

const EDITABLE: ReadonlyArray<{
  attr: "Name" | "Description" | "ObjectType";
  label: string;
  field: "name" | "description" | "objectType";
}> = [
  { attr: "Name", label: "Name", field: "name" },
  { attr: "Description", label: "Beschreibung", field: "description" },
  { attr: "ObjectType", label: "ObjectType", field: "objectType" },
];

export default function OverviewSection({
  docId,
  session,
  expressId,
}: OverviewSectionProps) {
  // Dokumentweite Revision (do/undo/redo) — die einzige Memo-Abhängigkeit
  // für Lesestände aus der Sitzung.
  const revision = useDocRevision(docId);

  const identity = useMemo(
    () => session.identityOf(expressId),
    [session, expressId, revision],
  );
  const attributes = useMemo(
    () => readAttributes(session, expressId),
    [session, expressId, revision],
  );
  const summary = useMemo(
    () => ({
      psets: readPsets(session, expressId).length,
      quantities: readQuantitySets(session, expressId).length,
      relations: session.relationsOf(expressId).length,
    }),
    [session, expressId, revision],
  );

  function commit(attr: string, value: string, oldValue: string): void {
    if (value === oldValue) return;
    useCommands
      .getState()
      .execute(docId, cmdSetAttribute(session, expressId, attr, value, oldValue));
  }

  return (
    <div className="pane-stack">
      <div className="card">
        <div className="card-head">
          <span className="card-title">Identität</span>
        </div>
        <table className="kv-table">
          <tbody>
          <tr>
            <td className="dim">Klasse</td>
            <td>{identity.type}</td>
          </tr>
          {EDITABLE.map((entry) => (
            <tr key={entry.attr}>
              <td className="dim">{entry.label}</td>
              <td>
                <ValueEditor
                  key={`${expressId}|${entry.attr}|${revision}`}
                  value={attributes[entry.field]}
                  kind="text"
                  title={`${entry.attr} bearbeiten`}
                  onCommit={(draft) =>
                    commit(entry.attr, draft, attributes[entry.field])
                  }
                />
              </td>
            </tr>
          ))}
          <tr>
            <td className="dim">GlobalId</td>
            <td>
              <span
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span className="mono">
                  <DimValue value={identity.globalId} />
                </span>
                <CopyButton text={identity.globalId} />
              </span>
            </td>
          </tr>
          <tr>
            <td className="dim">expressId</td>
            <td className="mono">#{identity.expressId}</td>
          </tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="card-head">
          <span className="card-title">Zusammenfassung</span>
        </div>
        <table className="kv-table">
          <tbody>
            <tr>
              <td className="dim">Eigenschaftssätze</td>
              <td className="mono">{summary.psets}</td>
            </tr>
            <tr>
              <td className="dim">Mengensätze</td>
              <td className="mono">{summary.quantities}</td>
            </tr>
            <tr>
              <td className="dim">Beziehungen</td>
              <td className="mono">{summary.relations}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      className="btn btn-sm"
      onClick={() => void copy()}
      disabled={!text}
      title="GlobalId in die Zwischenablage kopieren"
    >
      {copied ? "Kopiert" : "Kopieren"}
    </button>
  );
}
