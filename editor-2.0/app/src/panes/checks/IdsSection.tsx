/**
 * IDS-Bereich des Prüfzentrums: Anforderungsdokumente laden (Datei oder aus
 * einer Objektkatalog-Klasse erzeugt), auflisten und wieder entfernen.
 * Geladene Dokumente gelten für alle Modelle; geprüft werden sie von der
 * Quelle `domain/checks/idsSource.ts`.
 */
import { useRef, useState } from "react";

import { buildCatalogIds } from "../../domain/catalog/ids";
import { catalogObjectLabel } from "../../domain/catalog/model";
import { useIdsDocuments } from "../../domain/checks/idsSource";
import { useCatalog } from "../catalog/store";

export default function IdsSection() {
  const entries = useIdsDocuments((s) => s.entries);
  const error = useIdsDocuments((s) => s.error);
  const addFromXml = useIdsDocuments((s) => s.addFromXml);
  const remove = useIdsDocuments((s) => s.remove);
  const catalog = useCatalog((s) => s.catalog);
  const fileInput = useRef<HTMLInputElement>(null);
  const [classId, setClassId] = useState("");

  const objectTypes = catalog?.objectTypes ?? [];
  const selected =
    objectTypes.find((entry) => entry.id === classId) ?? objectTypes[0] ?? null;

  async function loadFiles(files: FileList | null): Promise<void> {
    for (const file of [...(files ?? [])]) {
      addFromXml(file.name, await file.text());
    }
    if (fileInput.current) fileInput.current.value = "";
  }

  return (
    <section
      style={{ borderBottom: "1px solid var(--border-60)", padding: "0 0 6px" }}
    >
      <div className="pane-toolbar">
        <strong className="card-title">IDS</strong>
        <input
          ref={fileInput}
          type="file"
          accept=".ids,.xml"
          multiple
          style={{ display: "none" }}
          onChange={(event) => void loadFiles(event.target.files)}
        />
        <button
          className="btn"
          onClick={() => fileInput.current?.click()}
          title="IDS-Dokument (.ids) laden"
          type="button"
        >
          IDS-Datei laden
        </button>
        {objectTypes.length > 0 && (
          <>
            <select
              className="input"
              value={selected?.id ?? ""}
              onChange={(event) => setClassId(event.target.value)}
            >
              {objectTypes.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {catalogObjectLabel(entry)}
                </option>
              ))}
            </select>
            <button
              className="btn"
              disabled={!selected}
              onClick={() => {
                if (!selected) return;
                addFromXml(
                  `Katalog: ${catalogObjectLabel(selected)}`,
                  buildCatalogIds(selected),
                );
              }}
              title="Pflichtmerkmale der Katalogklasse als IDS-Anforderungen übernehmen"
              type="button"
            >
              aus Objektkatalog-Klasse übernehmen
            </button>
          </>
        )}
      </div>

      {error && (
        <p className="msg msg-error" style={{ margin: "6px 0 0" }}>
          {error}
        </p>
      )}

      {entries.length === 0 ? (
        <p className="list-note" style={{ marginTop: 4 }}>
          Kein IDS geladen — die IDS-Quelle liefert dann keine Befunde.
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: "4px 0 0", padding: 0 }}>
          {entries.map((entry) => (
            <li key={entry.id} className="list-row">
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {entry.name}
              </span>
              <span className="badge">
                {entry.specCount} Spezifikation(en)
              </span>
              <span className="row-actions">
                <button
                  className="btn btn-sm"
                  onClick={() => remove(entry.id)}
                  title="Dieses IDS-Dokument entfernen"
                  type="button"
                >
                  Entfernen
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
