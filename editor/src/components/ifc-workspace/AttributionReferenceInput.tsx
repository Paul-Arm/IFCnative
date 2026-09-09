import { useRef, useState } from "react";
import { Autocomplete } from "@base-ui/react/autocomplete";
import { Check, ChevronDown, Link2 } from "lucide-react";
import type { ReferenceOption } from "@/ifc/attribution/editing";
import type { ReferenceKind } from "@/ifc/attribution/table";
import { cn } from "@/lib/utils";

/** Search text is a draft: only a chosen suggestion or an explicitly confirmed ID becomes a value. */
export function AttributionReferenceInput({ label, reference, value, suggestions, autoFocus = false, onChange, onCommit, onCancel, onNavigate }: {
  label: string;
  reference: ReferenceKind;
  value: string;
  suggestions: ReferenceOption[];
  autoFocus?: boolean;
  onChange(value: string): void;
  onCommit?(value: string): void;
  onCancel?(): void;
  onNavigate?(direction: "next" | "previous" | "down" | "up"): void;
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(autoFocus);
  const groupRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const confirmed = useRef(value);
  const multiple = reference === "Untersuchungsziel";
  // Completing the last token preserves earlier objective references.
  const separator = multiple ? Math.max(query.lastIndexOf(";"), query.lastIndexOf(","), query.lastIndexOf("|"), query.lastIndexOf("\n")) : -1;
  const prefix = query.slice(0, separator + 1);
  const search = query.slice(separator + 1).trim();
  const terms = search.toLocaleLowerCase("de-DE").split(/\s+/);
  const matches = suggestions.filter((item) => query === confirmed.current || terms.every((term) => `${item.value} ${item.label}`.toLocaleLowerCase("de-DE").includes(term))).slice(0, 100);
  const complete = (item: ReferenceOption) => `${prefix}${prefix ? " " : ""}${item.value}`;
  const choose = (next: string) => {
    confirmed.current = next;
    setQuery(next);
    onChange(next);
    setOpen(false);
    onCommit?.(next);
    onNavigate?.("down");
  };

  return (
    <Autocomplete.Root
      items={suggestions}
      filteredItems={matches}
      value={query}
      open={open}
      onOpenChange={setOpen}
      openOnInputClick
      autoHighlight
      itemToStringValue={complete}
      onValueChange={(next, details) => {
        if (details.reason === "item-press") choose(next);
        else if (details.reason === "input-change" || details.reason === "input-clear") { setQuery(next); setOpen(true); }
      }}
    >
      <Autocomplete.InputGroup ref={groupRef} className={cn("relative flex-1", autoFocus ? "min-w-0" : "min-w-36")}>
        <Autocomplete.Input
          autoFocus={autoFocus}
          aria-label={label}
          placeholder="ID oder Bezeichnung suchen …"
          className={cn("h-8 w-full rounded-md border border-input bg-background py-1 pl-2 pr-7 text-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/30", autoFocus && "h-7 font-mono")}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={(event) => {
            if (groupRef.current?.contains(event.relatedTarget) || popupRef.current?.contains(event.relatedTarget)) return;
            // Leaving a search must never write a partial name into an IFC ID property.
            setQuery(confirmed.current);
            onCommit?.(confirmed.current);
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Escape") {
              event.preventDefault();
              event.preventBaseUIHandler();
              setQuery(confirmed.current);
              setOpen(false);
              onCancel?.();
            } else if (event.key === "Enter" && (!open || !event.currentTarget.getAttribute("aria-activedescendant"))) {
              event.preventDefault();
              event.preventBaseUIHandler();
              choose(query !== confirmed.current && search && matches[0] ? complete(matches[0]) : query.trim());
            } else if (event.key === "Tab" && onNavigate) {
              event.preventDefault();
              event.preventBaseUIHandler();
              onCommit?.(confirmed.current);
              onNavigate(event.shiftKey ? "previous" : "next");
            }
          }}
        />
        <Autocomplete.Trigger aria-label={`${reference} auswählen`} tabIndex={-1} className="absolute inset-y-0 right-0 flex w-7 items-center justify-center rounded-r-md text-muted-foreground hover:bg-muted hover:text-foreground">
          <ChevronDown className="size-3.5" />
        </Autocomplete.Trigger>
      </Autocomplete.InputGroup>
      <Autocomplete.Portal>
        <Autocomplete.Positioner sideOffset={4} align="start" className="z-50">
          <Autocomplete.Popup ref={popupRef} finalFocus={false} className="flex max-h-(--available-height) w-[max(20rem,var(--anchor-width))] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-xl">
            <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-xs font-medium"><Link2 className="size-3.5 text-muted-foreground" />{reference} auswählen</div>
            <Autocomplete.Empty className="px-3 py-4 text-xs text-muted-foreground empty:hidden">
              {suggestions.length ? "Keine passenden Objekte gefunden." : reference === "Bauteil" ? "Keine Bauteile verfügbar. Bauwerksmodell unter Schema & Kontext auswählen." : `Keine Ziele vom Typ ${reference} vorhanden. Zuerst ein entsprechendes Objekt mit ID anlegen.`}
            </Autocomplete.Empty>
            <Autocomplete.List aria-label={`${reference}-Vorschläge`} className="min-h-0 max-h-72 overflow-y-auto p-1 empty:p-0">
              {(item: ReferenceOption) => (
                <Autocomplete.Item key={item.value} value={item} className="flex cursor-default items-center gap-2 rounded-md px-2 py-2 text-xs outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground">
                  <span className="min-w-0 flex-1"><span className="block truncate font-medium">{item.label || item.value}</span><span className="block break-all font-mono text-[11px] text-muted-foreground">{item.value}</span></span>
                  {search === item.value ? <Check className="size-3.5 shrink-0 text-primary" /> : null}
                </Autocomplete.Item>
              )}
            </Autocomplete.List>
            <div className="shrink-0 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">↑↓ wählen · Enter übernehmen · Esc abbrechen{multiple ? <span className="block">Mehrere Ziele: IDs mit ; trennen.</span> : null}<span className="block">Eine eigene ID mit Enter bestätigen.</span></div>
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
  );
}
