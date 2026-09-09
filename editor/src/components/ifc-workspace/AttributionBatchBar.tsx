import { useMemo, useState } from "react";
import { Check, ChevronDown, Columns3 } from "lucide-react";
import { planColumnChanges, type CellChange, type FillMode, type ReferenceOption } from "@/ifc/attribution/editing";
import type { ReferenceKind, TableColumn, TableRow } from "@/ifc/attribution/table";
import { Input } from "@/components/ui/input";
import { Button } from "./ui";
import { AttributionReferenceInput } from "./AttributionReferenceInput";

/** Explicit selection, editable value and a preview before a single undoable transaction. */
export function AttributionBatchBar({ rows, columns, references, onApply, onClear }: {
  rows: TableRow[];
  columns: TableColumn[];
  references: Partial<Record<ReferenceKind, ReferenceOption[]>>;
  onApply(column: TableColumn, changes: CellChange[]): void;
  onClear(): void;
}) {
  const [columnKey, setColumnKey] = useState("");
  const [value, setValue] = useState("");
  const [mode, setMode] = useState<FillMode>("empty");
  const [preview, setPreview] = useState(false);
  const [fieldSearch, setFieldSearch] = useState("");
  const editable = columns.filter((column) => !column.derived && !column.position);
  const column = editable.find((entry) => entry.key === columnKey);
  const suggestions = column?.reference ? references[column.reference] : undefined;
  const terms = fieldSearch.trim().toLocaleLowerCase("de-DE").split(/\s+/).filter(Boolean);
  const choices = editable.filter((entry) => entry.key === columnKey || terms.every((term) => `${entry.psetLabel} ${entry.property}`.toLocaleLowerCase("de-DE").includes(term)));
  const changes = useMemo(() => column ? planColumnChanges(rows, column, value, mode) : [], [rows, column, value, mode]);
  return (
    <section aria-label="Mehrere Objekte attribuieren" className="shrink-0 rounded-lg border border-primary/25 bg-accent/25 p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Columns3 className="size-4 text-primary" />
        <strong>{rows.length} ausgewählt</strong>
        <Input aria-label="Eigenschaft für Sammeländerung suchen" placeholder="Feld suchen …" className="h-8 w-36 text-xs" value={fieldSearch} onChange={(event) => setFieldSearch(event.target.value)} />
        <select aria-label="Gemeinsames Feld" className="h-8 min-w-40 max-w-64 rounded-md border border-input bg-background px-2" value={columnKey} onChange={(event) => { setColumnKey(event.target.value); setValue(""); setPreview(false); }}>
          <option value="">Eigenschaft wählen …</option>
          {choices.map((entry) => <option key={entry.key} value={entry.key}>{entry.psetLabel} · {entry.property}{entry.hard ? " (Pflicht)" : ""}</option>)}
        </select>
        {column?.reference ? <AttributionReferenceInput key={column.key} label="Gemeinsamer Wert" reference={column.reference} value={value} suggestions={suggestions ?? []} onChange={(next) => { setValue(next); setPreview(false); }} /> : <Input aria-label="Gemeinsamer Wert" placeholder="Wert eingeben" className="h-8 min-w-32 flex-1" value={value} onChange={(event) => { setValue(event.target.value); setPreview(false); }} />}
        <select aria-label="Vorhandene Werte behandeln" className="h-8 rounded-md border border-input bg-background px-2" value={mode} onChange={(event) => { setMode(event.target.value as FillMode); setPreview(false); }}>
          <option value="empty">Nur leere ergänzen</option>
          <option value="all">Vorhandene ersetzen</option>
        </select>
        <Button disabled={!column || !changes.length || !value.trim()} onClick={() => setPreview(!preview)}><ChevronDown className="size-3.5" />{changes.length} Änderungen prüfen</Button>
        <Button variant="ghost" onClick={onClear}>Auswahl aufheben</Button>
      </div>
      {preview && column ? (
        <div className="mt-3 border-t border-primary/15 pt-3">
          <p className="mb-2 text-muted-foreground">{column.psetLabel} · {column.property} auf {changes.length} ausgewählte Objekte anwenden. Fehlende Psets werden angelegt.</p>
          <ul className="mb-3 grid gap-1">
            {changes.slice(0, 3).map((change) => <li key={change.row.key} className="flex flex-wrap gap-x-3"><span className="max-w-48 truncate font-medium">{change.row.label}</span><span className="max-w-48 truncate text-muted-foreground">{change.before || "leer"}</span><span className="max-w-64 truncate">→ {change.after}</span></li>)}
          </ul>
          <div className="flex items-center gap-3">
            <Button variant="default" disabled={!changes.length || !value.trim()} onClick={() => { onApply(column, changes); setPreview(false); }}><Check className="size-3.5" />{changes.length} Änderungen anwenden</Button>
            <span className="text-muted-foreground">Als ein Schritt rückgängig machbar.</span>
          </div>
        </div>
      ) : <p className="mt-2 text-muted-foreground">Feld und Wert wählen, Änderungen prüfen und gemeinsam anwenden. Es zählen nur die hier sichtbaren, ausgewählten Zeilen.</p>}
    </section>
  );
}
