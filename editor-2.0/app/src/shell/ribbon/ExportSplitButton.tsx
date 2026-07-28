/**
 * Exportieren als Splitbutton: der linke Teil exportiert wie bisher IFC
 * (inkl. Speichern-Dialog bzw. Download), der Pfeil öffnet das Menü der
 * übrigen Formate. Optik im Stil der ersten React-App (Outline-Button mit
 * Teal-Badge für offene Änderungen); Logik und Formatliste unverändert.
 */
import { useCallback, useRef, useState } from "react";
import {
  CSV_MODE_LABELS,
  FORMAT_LABELS,
  deliverArtifact,
  runExport,
  type CsvMode,
  type ExportRequest,
} from "../../domain/export";
import type { ModelSession } from "../../core/session";
import { DropMenu } from "./DropMenu";
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
  const close = useCallback(() => setOpen(false), []);

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
    <div className="tb-menu-box tb-split" ref={box}>
      <button
        type="button"
        className="tb-btn tb-btn-outline tb-split-main"
        title={pendingTitle}
        aria-label={pendingTitle}
        disabled={disabled}
        onClick={(event) => {
          event.currentTarget.blur();
          void run({ format: "ifc" }, FORMAT_LABELS.ifc);
        }}
      >
        <IconExport className="tb-icon" />
        <span className="rb-btn-text">
          {busy ? `${busy} …` : "Exportieren"}
        </span>
        {!busy && pending > 0 ? (
          <span className="tb-badge">{pending}</span>
        ) : null}
      </button>
      <button
        type="button"
        className="tb-btn tb-btn-outline tb-split-arrow"
        title="Weitere Exportformate"
        aria-label="Weitere Exportformate"
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <IconChevronDown className="tb-icon-xs" />
      </button>
      <DropMenu anchorRef={box} open={open} onDismiss={close}>
        {MENU_ITEMS.map((item) => (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            className="tb-menu-item"
            onClick={() => void run(item.request, item.label)}
          >
            {item.label}
          </button>
        ))}
      </DropMenu>
    </div>
  );
}
