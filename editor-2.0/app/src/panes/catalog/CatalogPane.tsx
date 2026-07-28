/**
 * Pane „Objektkatalog" (M3): Import des openSIM-Katalogs aus Excel,
 * durchsuchbare Klassenliste, Klassendetail mit Merkmalsgruppen und der
 * Abschnitt „Prüfung" gegen die aktuelle Auswahl.
 *
 * Der Katalog liegt im App-weiten Store (`store.ts`), nicht am Dokument —
 * einmal importiert gilt er für alle geöffneten Modelle.
 */
import { useRef } from "react";

import {
  CATALOG_KINDS,
  catalogKindLabel,
  findCatalogObject,
  type CatalogKind,
} from "../../domain/catalog/model";
import CheckSection from "./CheckSection";
import ClassDetail from "./ClassDetail";
import ClassList from "./ClassList";
import { useCatalog } from "./store";

export default function CatalogPane() {
  const catalog = useCatalog((s) => s.catalog);
  const selectedId = useCatalog((s) => s.selectedId);
  const busy = useCatalog((s) => s.busy);
  const error = useCatalog((s) => s.error);
  const importWorkbook = useCatalog((s) => s.importWorkbook);
  const setKind = useCatalog((s) => s.setKind);
  const clear = useCatalog((s) => s.clear);
  const fileInput = useRef<HTMLInputElement>(null);

  const objectType = findCatalogObject(catalog, selectedId);

  return (
    <div className="pane">
      <div className="pane-toolbar">
        <button
          className="btn"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
          type="button"
        >
          {busy ? "Import läuft …" : "Katalog importieren"}
        </button>
        <input
          accept=".xlsx,.xlsm,.xls"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importWorkbook(file);
            event.target.value = "";
          }}
          ref={fileInput}
          style={{ display: "none" }}
          type="file"
        />
        {catalog ? (
          <>
            <label className="text-dim" htmlFor="catalog-kind">
              Variante
            </label>
            <select
              className="input"
              id="catalog-kind"
              onChange={(event) => setKind(event.target.value as CatalogKind)}
              value={catalog.kind}
            >
              {CATALOG_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {catalogKindLabel(kind)}
                </option>
              ))}
            </select>
            <span className="text-dim">
              {catalog.fileName} · {catalog.objectTypes.length} Klassen
            </span>
            <button className="btn" onClick={clear} type="button">
              Entfernen
            </button>
          </>
        ) : null}
      </div>

      {error ? (
        <p className="pane-empty" style={{ color: "var(--error)" }}>
          Import fehlgeschlagen: {error}
        </p>
      ) : null}

      {!catalog ? (
        <p className="pane-empty">
          Noch kein Objektkatalog geladen. Die openSIM-Arbeitsmappe (.xlsx) für
          Diagnostik (BWD) oder Monitoring (MON) importieren — die Variante wird
          automatisch erkannt.
        </p>
      ) : (
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          <ClassList catalog={catalog} />
          <div className="pane-body">
            {catalog.diagnostics.length > 0 ? (
              <ul
                className="text-dim"
                style={{
                  borderBottom: "1px solid var(--border)",
                  margin: 0,
                  padding: "6px 10px 6px 26px",
                }}
              >
                {catalog.diagnostics.map((entry) => (
                  <li key={entry}>{entry}</li>
                ))}
              </ul>
            ) : null}
            {objectType ? (
              <>
                <ClassDetail objectType={objectType} />
                <CheckSection
                  objectType={objectType}
                  objectTypes={catalog.objectTypes}
                />
              </>
            ) : (
              <p className="pane-empty">Keine Klasse gewählt.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
