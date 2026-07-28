/**
 * Modus „Übersicht": Identität des Objekts plus eine kurze Zusammenfassung,
 * wie viele Eigenschafts-, Mengen- und Beziehungsdatensätze vorhanden sind.
 */
import { useMemo, useState } from "react";
import type { ModelSession } from "../../core/session";
import { DimValue, SectionHeading } from "./parts";

interface OverviewSectionProps {
  session: ModelSession;
  expressId: number;
  /** Steigt bei jeder Mutation — erzwingt Neuberechnung der Zusammenfassung. */
  revision: number;
}

export default function OverviewSection({
  session,
  expressId,
  revision,
}: OverviewSectionProps) {
  const identity = useMemo(
    () => session.identityOf(expressId),
    [session, expressId],
  );
  const summary = useMemo(
    () => ({
      psets: session.psetsOf(expressId).length,
      quantities: session.quantitiesOf(expressId).length,
      relations: session.relationsOf(expressId).length,
    }),
    // revision hält die Zahlen nach setProperty aktuell
    [session, expressId, revision],
  );

  return (
    <div>
      <SectionHeading>Identität</SectionHeading>
      <table className="kv-table">
        <tbody>
          <tr>
            <td className="dim">Klasse</td>
            <td>{identity.type}</td>
          </tr>
          <tr>
            <td className="dim">Name</td>
            <td>
              <DimValue value={identity.name} />
            </td>
          </tr>
          <tr>
            <td className="dim">Beschreibung</td>
            <td>
              <DimValue value={identity.description} />
            </td>
          </tr>
          <tr>
            <td className="dim">ObjectType</td>
            <td>
              <DimValue value={identity.objectType} />
            </td>
          </tr>
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
                <span style={{ fontFamily: "ui-monospace, monospace" }}>
                  <DimValue value={identity.globalId} />
                </span>
                <CopyButton text={identity.globalId} />
              </span>
            </td>
          </tr>
          <tr>
            <td className="dim">expressId</td>
            <td>#{identity.expressId}</td>
          </tr>
        </tbody>
      </table>

      <SectionHeading>Zusammenfassung</SectionHeading>
      <table className="kv-table">
        <tbody>
          <tr>
            <td className="dim">Eigenschaftssätze</td>
            <td>{summary.psets}</td>
          </tr>
          <tr>
            <td className="dim">Mengensätze</td>
            <td>{summary.quantities}</td>
          </tr>
          <tr>
            <td className="dim">Beziehungen</td>
            <td>{summary.relations}</td>
          </tr>
        </tbody>
      </table>
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
      className="btn"
      onClick={() => void copy()}
      disabled={!text}
      title="GlobalId in die Zwischenablage kopieren"
    >
      {copied ? "Kopiert" : "Kopieren"}
    </button>
  );
}
