/**
 * Modus „Eigenschaften": alle Psets als Tabellen, Werte editierbar.
 * Commit erfolgt bei Blur oder Enter und nur, wenn sich der Wert geändert hat;
 * geschrieben wird über das Mutations-Overlay der Sitzung.
 */
import { useEffect, useMemo, useState } from "react";
import type { ModelSession, PsetView } from "../../core/session";
import { SectionHeading } from "./parts";

interface PropertiesSectionProps {
  session: ModelSession;
  expressId: number;
  /** Freitextfilter über Pset-Name, Property-Name und Wert. */
  query: string;
  /** Steigt bei jeder Mutation — erzwingt Neuladen der Psets. */
  revision: number;
  /** Meldet dem Pane eine erfolgte Änderung (touch + Refresh). */
  onMutate(): void;
}

export default function PropertiesSection({
  session,
  expressId,
  query,
  revision,
  onMutate,
}: PropertiesSectionProps) {
  const psets = useMemo(
    () => session.psetsOf(expressId),
    // revision lädt die Psets nach einem Commit neu
    [session, expressId, revision],
  );
  const visible = useMemo(() => filterPsets(psets, query), [psets, query]);

  function commit(psetName: string, propName: string, value: string): void {
    session.setProperty(expressId, psetName, propName, value);
    onMutate();
  }

  if (psets.length === 0) {
    return <p className="pane-empty">Keine Eigenschaftssätze für dieses Objekt.</p>;
  }
  if (visible.length === 0) {
    return <p className="pane-empty">Kein Treffer für „{query}".</p>;
  }

  return (
    <div>
      {visible.map((pset) => (
        <div key={pset.name}>
          <SectionHeading>{pset.name}</SectionHeading>
          <table className="kv-table">
            <thead>
              <tr>
                <th className="text-dim" style={{ width: "45%" }}>
                  Property
                </th>
                <th className="text-dim">Wert</th>
              </tr>
            </thead>
            <tbody>
              {pset.properties.map((property) => (
                <tr key={property.name}>
                  <td className="dim">{property.name}</td>
                  <td>
                    <ValueInput
                      key={`${expressId}|${pset.name}|${property.name}`}
                      value={property.value}
                      onCommit={(next) => commit(pset.name, property.name, next)}
                    />
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

function filterPsets(psets: PsetView[], query: string): PsetView[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return psets;
  const result: PsetView[] = [];
  for (const pset of psets) {
    if (pset.name.toLowerCase().includes(needle)) {
      result.push(pset);
      continue;
    }
    const properties = pset.properties.filter(
      (p) =>
        p.name.toLowerCase().includes(needle) ||
        p.value.toLowerCase().includes(needle),
    );
    if (properties.length > 0) result.push({ name: pset.name, properties });
  }
  return result;
}

interface ValueInputProps {
  value: string;
  onCommit(next: string): void;
}

function ValueInput({ value, onCommit }: ValueInputProps) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  function commit(): void {
    if (draft !== value) onCommit(draft);
  }

  return (
    <input
      className="input"
      style={{ width: "100%" }}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          event.preventDefault();
          setDraft(value);
        }
      }}
    />
  );
}
