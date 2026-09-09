import { useRef, useState } from "react";
import type { ReferenceOption } from "@/ifc/attribution/editing";
import { Input } from "@/components/ui/input";
import { parseMeters, type ReferenceKind } from "@/ifc/attribution/table";
import { AttributionReferenceInput } from "./AttributionReferenceInput";

export function AttributionCellEditor({ label, initialValue, position, reference, suggestions, onCommit, onCancel, onNavigate }: {
  label: string;
  initialValue: string;
  position: boolean;
  reference?: ReferenceKind;
  suggestions?: ReferenceOption[];
  onCommit(value: string): void;
  onCancel(): void;
  onNavigate(direction: "next" | "previous" | "down" | "up"): void;
}) {
  const [value, setValue] = useState(initialValue);
  // Enter/Tab unmounts the input and may also blur it. A draft is committed only once.
  const finished = useRef(false);
  const invalid = position && parseMeters(value) == null;
  const commit = (next = value) => {
    if (finished.current || invalid) return false;
    finished.current = true;
    onCommit(next);
    return true;
  };
  if (reference) return <AttributionReferenceInput label={label} reference={reference} value={value} suggestions={suggestions ?? []} autoFocus onChange={setValue} onCommit={commit} onCancel={() => { finished.current = true; onCancel(); }} onNavigate={onNavigate} />;
  return <Input
    autoFocus
    aria-label={label}
    aria-invalid={invalid}
    title={invalid ? "Eine gültige Koordinate in Metern eingeben." : "Enter: nächste Zeile · Tab: nächstes Feld · Esc: verwerfen"}
    className="h-7 min-w-0 px-1 font-mono text-xs"
    value={value}
    onChange={(event) => setValue(event.target.value)}
    onBlur={() => commit()}
    onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        finished.current = true;
        onCancel();
      } else if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        if (commit()) onNavigate(event.key === "Tab" ? event.shiftKey ? "previous" : "next" : event.shiftKey ? "up" : "down");
      }
    }}
  />;
}
