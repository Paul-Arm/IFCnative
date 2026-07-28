/**
 * Klassendetail: Kopfdaten und je Merkmalsgruppe eine Tabelle mit Typ,
 * Einheit, Pflicht, LoI und Gewerken. Zusätzlich der IDS-Export der Klasse.
 */
import { useMemo, useState } from "react";

import {
  buildCatalogIds,
  catalogIdsFileName,
  catalogIdsRules,
} from "../../domain/catalog/ids";
import {
  CATALOG_LOI_LEVELS,
  catalogRequirementLabel,
  catalogRuleLoiLabel,
  catalogRuleTradeLabel,
  groupCatalogRulesByPset,
  type CatalogLoiLevel,
  type CatalogObjectType,
} from "../../domain/catalog/model";

function downloadIds(objectType: CatalogObjectType, loi: CatalogLoiLevel | null) {
  const xml = buildCatalogIds(objectType, { loi });
  const url = URL.createObjectURL(new Blob([xml], { type: "application/xml" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = catalogIdsFileName(objectType);
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function ClassDetail({
  objectType,
}: {
  objectType: CatalogObjectType;
}) {
  const [loi, setLoi] = useState<CatalogLoiLevel | "">("");
  const groups = useMemo(
    () => [...groupCatalogRulesByPset(objectType.propertyRules)],
    [objectType],
  );
  const idsCount = catalogIdsRules(objectType, {
    loi: loi === "" ? null : loi,
  }).length;

  return (
    <section style={{ padding: "8px 10px" }}>
      <h3 style={{ margin: "0 0 4px" }}>
        {objectType.name}
        {objectType.code ? (
          <span className="text-dim"> · {objectType.code}</span>
        ) : null}
      </h3>
      <p className="text-dim" style={{ margin: "0 0 8px" }}>
        IFC-Klasse {objectType.ifcClass} · {objectType.propertyRules.length}{" "}
        Merkmale in {groups.length} Merkmalsgruppen
        {objectType.version ? ` · Version ${objectType.version}` : ""} · Quelle „
        {objectType.sheetName}"
      </p>

      <div className="pane-toolbar" style={{ border: 0, padding: 0 }}>
        <label className="text-dim" htmlFor="catalog-loi">
          LoI-Filter
        </label>
        <select
          className="input"
          id="catalog-loi"
          onChange={(event) =>
            setLoi(event.target.value as CatalogLoiLevel | "")
          }
          value={loi}
        >
          <option value="">alle Stufen</option>
          {CATALOG_LOI_LEVELS.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
        <button
          className="btn"
          disabled={idsCount === 0}
          onClick={() => downloadIds(objectType, loi === "" ? null : loi)}
          title="Pflichtmerkmale als IDS-1.0-Dokument herunterladen"
          type="button"
        >
          IDS exportieren ({idsCount})
        </button>
      </div>

      {groups.map(([psetName, rules]) => (
        <div key={psetName} style={{ marginTop: 12 }}>
          <strong>{psetName}</strong>
          <table className="kv-table">
            <thead>
              <tr>
                <th>Merkmal</th>
                <th>Typ</th>
                <th>Einheit</th>
                <th>Pflicht</th>
                <th>LoI</th>
                <th>Gewerke</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id}>
                  <td>{rule.propertyName}</td>
                  <td className="dim">{rule.valueType}</td>
                  <td className="dim">{rule.unit || "—"}</td>
                  <td className="dim">
                    {catalogRequirementLabel(rule.requirement)}
                  </td>
                  <td className="dim">{catalogRuleLoiLabel(rule) || "—"}</td>
                  <td className="dim">{catalogRuleTradeLabel(rule) || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}
