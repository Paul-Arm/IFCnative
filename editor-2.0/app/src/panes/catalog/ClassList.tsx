/** Durchsuchbare Klassenliste des Objektkatalogs (Anzeige gedeckelt). */
import { useMemo } from "react";

import {
  normalizeCatalogToken,
  type CatalogObjectType,
  type IfcObjectCatalog,
} from "../../domain/catalog/model";
import { useCatalog } from "./store";

/** Obergrenze der angezeigten Klassen — große Kataloge bleiben bedienbar. */
export const CLASS_LIST_CAP = 120;

function matches(objectType: CatalogObjectType, token: string): boolean {
  if (!token) return true;
  return (
    normalizeCatalogToken(objectType.name).includes(token) ||
    normalizeCatalogToken(objectType.code).includes(token) ||
    normalizeCatalogToken(objectType.ifcClass).includes(token)
  );
}

export default function ClassList({ catalog }: { catalog: IfcObjectCatalog }) {
  const search = useCatalog((s) => s.search);
  const setSearch = useCatalog((s) => s.setSearch);
  const selectedId = useCatalog((s) => s.selectedId);
  const select = useCatalog((s) => s.select);

  const found = useMemo(() => {
    const token = normalizeCatalogToken(search);
    return catalog.objectTypes.filter((objectType) =>
      matches(objectType, token),
    );
  }, [catalog, search]);

  const shown = found.slice(0, CLASS_LIST_CAP);

  return (
    <div
      style={{
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        minWidth: 220,
        width: 280,
      }}
    >
      <div style={{ padding: "6px 8px" }}>
        <input
          className="input"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Klasse suchen …"
          style={{ width: "100%" }}
          value={search}
        />
      </div>
      <div className="pane-body">
        {shown.map((objectType) => (
          <button
            className="row-item"
            data-selected={objectType.id === selectedId}
            key={objectType.id}
            onClick={() => select(objectType.id)}
            title={`${objectType.ifcClass} · ${objectType.propertyRules.length} Merkmale`}
            type="button"
          >
            {objectType.name}
            {objectType.code ? (
              <span className="text-dim"> · {objectType.code}</span>
            ) : null}
          </button>
        ))}
        {found.length === 0 ? (
          <p className="pane-empty">Keine Klasse passt zur Suche.</p>
        ) : null}
        {found.length > shown.length ? (
          <p className="text-dim" style={{ padding: "6px 8px" }}>
            {found.length - shown.length} weitere Klassen ausgeblendet — Suche
            verfeinern.
          </p>
        ) : null}
      </div>
    </div>
  );
}
