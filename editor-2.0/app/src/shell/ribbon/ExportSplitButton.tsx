/**
 * Exportieren als Office-Splitbutton: der große Teil exportiert wie bisher
 * IFC (inkl. Speichern-Dialog bzw. Download), der Pfeil öffnet das Menü der
 * übrigen Formate. Logik, Formatliste und Badge (offene Änderungen) sind
 * unverändert aus `shell/HeaderBar.tsx` übernommen.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CSV_MODE_LABELS,
  FORMAT_LABELS,
  deliverArtifact,
  runExport,
  type CsvMode,
  type ExportRequest,
} from "../../domain/export";
import type { ModelSession } from "../../core/session";
import { IconChevronDown, IconExport } from "./icons";

const CSV_MODES: readonly CsvMode[] = [
  "entities",
  "properties",
  "quantities",
  "spatial",
];

/** Menüeinträge neben dem Standardklick (IFC); CSV mit seinen vier Modi. */
const MENU_ITEMS: ReadonlyArray<{ label: string; request: ExportRequest }> = [
  { label: FORMAT_LABELS.ifczip, request: { format: "ifczip" } },
  { label: FORMAT_LABELS.glb, request: { format: "glb" } },
  { label: FORMAT_LABELS.jsonld, request: { format: "jsonld" } },
  { label: FORMAT_LABELS.bos, request: { format: "bos" } },
  ...CSV_MODES.map((mode) => ({
    label: `${FORMAT_LABELS.csv}: ${CSV_MODE_LABELS[mode]}`,
    request: { format: "csv", mode } as ExportRequest,
  })),
];

export function ExportSplitButton({
  session,
  pending,
}: {
  session: ModelSession | null;
  pending: number;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const run = useCallback(
    async (request: ExportRequest, label: string) => {
      if (!session) return;
      setOpen(false);
      setBusy(label);
      try {
        await deliverArtifact(await runExport(session, request));
      } catch (error) {
        // Die Exportfunktionen werfen bereits deutsche Meldungen.
        alert(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(null);
      }
    },
    [session],
  );

  const disabled = !session || busy !== null;
  const pendingTitle =
    pending > 0
      ? `${pending} ${pending === 1 ? "Änderung" : "Änderungen"} noch nicht exportiert`
      : "Modell als IFC exportieren";

  return (
    <div className="ribbon-split" ref={box}>
      <button
        type="button"
        className="ribbon-btn ribbon-btn-large ribbon-split-main"
        title={pendingTitle}
        aria-label={pendingTitle}
        disabled={disabled}
        onClick={(event) => {
          event.currentTarget.blur();
          void run({ format: "ifc" }, FORMAT_LABELS.ifc);
        }}
      >
        <IconExport className="ribbon-icon-lg" />
        <span className="ribbon-btn-label">
          <span className="ribbon-btn-text">
            {busy ? `${busy} …` : "Exportieren"}
          </span>
        </span>
        {!busy && pending > 0 ? (
          <span className="ribbon-badge">{pending}</span>
        ) : null}
      </button>
      <button
        type="button"
        className="ribbon-split-arrow"
        title="Weitere Exportformate"
        aria-label="Weitere Exportformate"
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <IconChevronDown className="ribbon-icon-xs" />
      </button>
      {open ? (
        <div role="menu" className="ribbon-menu">
          {MENU_ITEMS.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className="ribbon-menu-item"
              onClick={() => void run(item.request, item.label)}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
