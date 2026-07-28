/**
 * IDS-Verwaltung des IDS-Fensters: geladene Anforderungsdokumente auflisten,
 * neue aus Datei laden oder aus einer Objektkatalog-Klasse erzeugen, wieder
 * entfernen.
 *
 * Die Dokumente liegen im app-weiten Store `useIdsDocuments`
 * (`domain/checks/idsSource.ts`) — derselbe, den auch der IDS-Bereich des
 * Prüfzentrums bedient. Hier wird also nichts dupliziert: was hier geladen
 * wird, kennt auch das Prüfzentrum und umgekehrt.
 */
import { useRef, useState } from "react";

import { buildCatalogIds } from "../../domain/catalog/ids";
import { catalogObjectLabel } from "../../domain/catalog/model";
import { useIdsDocuments } from "../../domain/checks/idsSource";
import { useCatalog } from "../catalog/store";

export interface DocumentsSectionProps {
  /** Wird nach jeder Änderung an der Dokumentenliste gerufen. */
  onChanged(): void;
}

export default function DocumentsSection({ onChanged }: DocumentsSectionProps) {
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
    for (const file of [...(files ?? [])]) addFromXml(file.name, await file.text());
    if (fileInput.current) fileInput.current.value = "";
    onChanged();
  }

  return (
    <section style={{ borderBottom: "1px solid var(--border)" }}>
      <div className="pane-toolbar" style={{ border: 0 }}>
        <strong style={{ fontWeight: 600 }}>Anforderungen (IDS)</strong>
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
          title="IDS-Dokument (.ids/.xml) laden — gilt für alle geöffneten Modelle"
          type="button"
        >
          Datei laden
        </button>
        {objectTypes.length > 0 && (
          <>
            <select
              className="input"
              value={selected?.id ?? ""}
              onChange={(event) => setClassId(event.target.value)}
              title="Klasse aus dem Objektkatalog"
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
                onChanged();
              }}
              title="Pflichtmerkmale der Katalogklasse als IDS-Anforderungen übernehmen"
              type="button"
            >
              aus Objektkatalog übernehmen
            </button>
          </>
        )}
      </div>

      {error && (
        <p style={{ color: "var(--error)", margin: 0, padding: "0 8px 6px" }}>
          {error}
        </p>
      )}

      {entries.length === 0 ? (
        <p className="text-dim" style={{ margin: 0, padding: "0 8px 6px" }}>
          Kein IDS geladen — ohne Anforderungsdokument gibt es nichts zu prüfen.
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: "0 0 6px" }}>
          {entries.map((entry) => (
            <li
              key={entry.id}
              style={{
                alignItems: "baseline",
                display: "flex",
                gap: 6,
                padding: "1px 8px",
              }}
            >
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                {entry.name}
              </span>
              <span className="text-dim">
                {entry.specCount} Spezifikation(en)
              </span>
              <button
                className="btn"
                onClick={() => {
                  remove(entry.id);
                  onChanged();
                }}
                title="Dieses IDS-Dokument entfernen"
                type="button"
              >
                Entfernen
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
