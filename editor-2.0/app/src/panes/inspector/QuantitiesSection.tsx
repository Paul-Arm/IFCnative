/**
 * Modus „Mengen": IfcElementQuantity-Sätze rein lesend als Tabellen.
 */
import { useMemo } from "react";
import type { ModelSession } from "../../core/session";
import { DimValue, SectionHeading } from "./parts";

interface QuantitiesSectionProps {
  session: ModelSession;
  expressId: number;
}

export default function QuantitiesSection({
  session,
  expressId,
}: QuantitiesSectionProps) {
  const sets = useMemo(
    () => session.quantitiesOf(expressId),
    [session, expressId],
  );

  if (sets.length === 0) {
    return <p className="pane-empty">Keine Mengen für dieses Objekt.</p>;
  }

  return (
    <div>
      {sets.map((set) => (
        <div key={set.name}>
          <SectionHeading>{set.name}</SectionHeading>
          <table className="kv-table">
            <thead>
              <tr>
                <th className="text-dim" style={{ width: "45%" }}>
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
                    <DimValue value={quantity.value} />
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
