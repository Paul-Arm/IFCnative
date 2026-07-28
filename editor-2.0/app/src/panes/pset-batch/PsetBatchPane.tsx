/**
 * Pane „Pset Batch": Massenbearbeitung von Eigenschaften über die aktuelle
 * Mehrfachauswahl.
 *
 * Aufbau: Auswahlquellen-Leiste (Auswahl aus Baum/Viewer oder abfragebasiert),
 * eine Aktionsleiste (neues Pset, CSV-Roundtrip) und je Pset eine Matrix
 * (Zeilen = Properties, Spalten = Objekte).
 *
 * Regel für alle Schreibpfade: eine einzelne Zelle geht direkt als
 * `cmdSetProperty` durch die Pipeline; jede Massenänderung läuft erst durch
 * den Vorschau-Dialog (siehe `previews.ts`) und wird dann als EIN Command
 * ausgeführt — ein Undo-Schritt, ein Audit-Eintrag.
 */
import { useMemo, useRef, useState } from "react";
import type { PropertyValueType } from "@ifc-lite/data";
import {
  useCommands,
  useDocRevision,
  type EditorCommand,
} from "../../commands/pipeline";
import { cmdSetProperty } from "../../commands/propertyCommands";
import {
  cmdAddPropertyOnMany,
  cmdCreatePsetOnMany,
} from "../../commands/batchCommands";
import { useActiveDocument, type DocumentEntry } from "../../store/documents";
import { useSelection, useSelectionOf } from "../../store/selection";
import { kindOf, parseDraft } from "../inspector/values";
import PreviewDialog from "./PreviewDialog";
import PsetMatrix from "./PsetMatrix";
import QueryBar from "./QueryBar";
import { buildMatrix, type MatrixRow } from "./matrix";
import { csvFileName, downloadCsv, matrixToCsv } from "./csv";
import {
  csvImportPreview,
  deleteRowPreview,
  setAllPreview,
  type Pending,
} from "./previews";
import "./pset-batch.css";

export default function PsetBatchPane() {
  const doc = useActiveDocument();
  if (!doc) return <p className="pane-empty">Kein Dokument geöffnet.</p>;
  return <BatchBody key={doc.id} doc={doc} />;
}

function BatchBody({ doc }: { doc: DocumentEntry }) {
  const session = doc.session;
  const selection = useSelectionOf(doc.id);
  const setSelection = useSelection((s) => s.setSelection);
  const [pending, setPending] = useState<Pending | null>(null);
  const [newPset, setNewPset] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  // Befund 3: Dokument-Revision aus der Pipeline statt pane-lokalem Zähler —
  // sie steigt auch bei Undo/Redo und bei Edits aus Inspector/Graph/Katalog.
  const revision = useDocRevision(doc.id);

  const matrix = useMemo(
    () => buildMatrix(session, selection),
    [session, selection, revision],
  );

  function run(command: EditorCommand): void {
    useCommands.getState().execute(doc.id, command);
  }

  /** Einzelne Zelle — direkt, ohne Vorschau. */
  function commitCell(
    psetName: string,
    row: MatrixRow,
    expressId: number,
    draft: string,
  ): void {
    const parsed = parseDraft(draft, row.kind);
    if (!parsed.ok) return;
    run(
      cmdSetProperty(
        session,
        expressId,
        psetName,
        row.propName,
        parsed.value,
        row.type,
      ),
    );
  }

  /** Neue Property auf allen Objekten; fehlende Psets entstehen dabei mit. */
  function addProperty(
    psetName: string,
    propName: string,
    type: PropertyValueType,
    draft: string,
  ): void {
    const parsed = parseDraft(draft, kindOf(type));
    if (!parsed.ok) return;
    run(
      cmdAddPropertyOnMany(
        session,
        selection,
        psetName,
        propName,
        parsed.value,
        type,
      ),
    );
  }

  function createPset(): void {
    const name = newPset.trim();
    if (!name) return;
    run(cmdCreatePsetOnMany(session, selection, name));
    setNewPset("");
  }

  async function importCsv(file: File): Promise<void> {
    setPending(
      csvImportPreview(session, matrix, file.name, await file.text()),
    );
  }

  const hasSelection = selection.length > 0;

  return (
    <div className="pane batch-pane">
      <QueryBar
        session={session}
        selectionCount={selection.length}
        onApply={(ids) => setSelection(doc.id, ids)}
      />

      <div className="pane-toolbar">
        <input
          className="input"
          style={{ minWidth: 140 }}
          placeholder="Neues Pset …"
          value={newPset}
          onChange={(event) => setNewPset(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              createPset();
            }
          }}
        />
        <button
          className="btn"
          disabled={!hasSelection || !newPset.trim()}
          title="Legt den Satz auf allen ausgewählten Objekten an; vorhandene werden übersprungen"
          onClick={createPset}
        >
          Anlegen
        </button>
        <span className="batch-divider" />
        <button
          className="btn"
          disabled={!hasSelection}
          title="Matrix als CSV (Semikolon, UTF-8-BOM) speichern"
          onClick={() => downloadCsv(csvFileName(session), matrixToCsv(matrix))}
        >
          CSV exportieren
        </button>
        <button
          className="btn"
          disabled={!hasSelection}
          title="CSV zurücklesen — Abgleich über GlobalId, Vorschau vor der Übernahme"
          onClick={() => fileInput.current?.click()}
        >
          CSV importieren
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          style={{ display: "none" }}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void importCsv(file);
          }}
        />
      </div>

      <div className="pane-body">
        {!hasSelection && (
          <p className="pane-empty">
            Keine Objekte ausgewählt. Wähle im Strukturbaum oder Viewer mehrere
            Objekte (Strg/Umschalt-Klick) — oder setze oben eine Auswahl über
            IFC-Klasse und optionalen Property-Filter. Danach erscheint je
            Eigenschaftssatz eine Matrix: Zeilen sind Properties, Spalten die
            Objekte. Zellen sind direkt editierbar; über die Zeilen-Aktionen
            setzt oder löschst du Werte für die gesamte Auswahl.
          </p>
        )}
        {hasSelection && matrix.blocks.length === 0 && (
          <p className="pane-empty">
            Die Auswahl hat noch keine Eigenschaftssätze — oben einen neuen
            anlegen.
          </p>
        )}
        {hasSelection &&
          matrix.blocks.map((block) => (
            <PsetMatrix
              key={block.psetName}
              block={block}
              columns={matrix.columns}
              total={selection.length}
              onCellCommit={(row, expressId, draft) =>
                commitCell(block.psetName, row, expressId, draft)
              }
              onSetForAll={(row, draft) =>
                setPending(
                  setAllPreview(
                    session,
                    selection,
                    matrix,
                    block.psetName,
                    row,
                    draft,
                  ),
                )
              }
              onDeleteRow={(row) =>
                setPending(
                  deleteRowPreview(
                    session,
                    selection.length,
                    block.psetName,
                    row,
                  ),
                )
              }
              onAddProperty={(propName, type, draft) =>
                addProperty(block.psetName, propName, type, draft)
              }
            />
          ))}
      </div>

      {pending && (
        <PreviewDialog
          title={pending.title}
          note={pending.note}
          rows={pending.rows}
          confirmLabel={pending.confirmLabel}
          onConfirm={() => {
            run(pending.command);
            setPending(null);
          }}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
