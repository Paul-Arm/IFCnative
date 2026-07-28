/**
 * Ribbon · Start — der Alltagsweg: Datei herein, Modell wieder heraus.
 * Rückgängig/Wiederholen liegen als ständige Aktionen in der Registerzeile
 * (QuickActions im Ribbon), nicht mehr im Band. Alle Aktionen stammen aus
 * den bestehenden Stores.
 */
import { usePendingChangeCount } from "../../../commands/pipeline";
import { useDocuments } from "../../../store/documents";
import { ExportSplitButton } from "../ExportSplitButton";
import { IconNotes, IconOpen, IconRecents } from "../icons";
import { togglePane, usePaneVisible } from "../panes";
import {
  RibbonGroup,
  RibbonGroupDivider,
  RibbonLargeButton,
  RibbonSmallButton,
} from "../primitives";
import type { FileCommands } from "../useFileOpen";

export function StartTab({ fileCommands }: { fileCommands: FileCommands }) {
  const active = useDocuments(
    (s) => s.documents.find((d) => d.id === s.activeId) ?? null,
  );
  // Befund 15: Badge = offene (undo-bare) Änderungen, nicht die append-only
  // Mutationszahl — sonst blieb die Zahl nach einem Undo stehen.
  const pending = usePendingChangeCount(active?.id ?? null);
  const recentsVisible = usePaneVisible("recents");
  const notesVisible = usePaneVisible("notes");

  return (
    <>
      <RibbonGroup label="Datei">
        <RibbonLargeButton
          icon={IconOpen}
          label="IFC öffnen"
          tooltip="IFC-, IFCZIP- oder IFCX-Datei öffnen"
          variant="primary"
          onClick={fileCommands.openFiles}
        />
        <ExportSplitButton session={active?.session ?? null} pending={pending} />
      </RibbonGroup>

      <RibbonGroupDivider />

      <RibbonGroup label="Fenster">
        <RibbonSmallButton
          icon={IconRecents}
          label="Zuletzt verwendet"
          tooltip="Fenster „Kürzlich verwendet“ ein-/ausblenden"
          active={recentsVisible}
          onClick={() => togglePane("recents")}
        />
        <RibbonSmallButton
          icon={IconNotes}
          label="Notizen"
          tooltip="Fenster „Notizen“ ein-/ausblenden"
          active={notesVisible}
          onClick={() => togglePane("notes")}
        />
      </RibbonGroup>
    </>
  );
}
