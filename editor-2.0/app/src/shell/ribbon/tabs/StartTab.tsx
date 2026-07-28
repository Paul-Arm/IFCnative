/**
 * Ribbon · Start — der Alltagsweg: Datei herein, Änderungen zurücknehmen,
 * Modell wieder heraus. Alle Aktionen stammen aus den bestehenden Stores.
 */
import { useCommands, usePendingChangeCount, useUndoRedoLabels } from "../../../commands/pipeline";
import { useDocuments } from "../../../store/documents";
import { ExportSplitButton } from "../ExportSplitButton";
import {
  IconNotes,
  IconOpen,
  IconRecents,
  IconRedo,
  IconUndo,
} from "../icons";
import { togglePane, usePaneVisible } from "../panes";
import {
  RibbonGroup,
  RibbonGroupDivider,
  RibbonLargeButton,
  RibbonSmallButton,
  RibbonSmallStack,
} from "../primitives";
import type { FileCommands } from "../useFileOpen";

export function StartTab({ fileCommands }: { fileCommands: FileCommands }) {
  const active = useDocuments(
    (s) => s.documents.find((d) => d.id === s.activeId) ?? null,
  );
  const docId = active?.id ?? null;
  // Befund 15: Badge = offene (undo-bare) Änderungen, nicht die append-only
  // Mutationszahl — sonst blieb die Zahl nach einem Undo stehen.
  const pending = usePendingChangeCount(docId);
  const { undoLabel, redoLabel } = useUndoRedoLabels(docId);
  const undo = useCommands((s) => s.undo);
  const redo = useCommands((s) => s.redo);
  const recentsVisible = usePaneVisible("recents");
  const notesVisible = usePaneVisible("notes");

  return (
    <>
      <RibbonGroup label="Datei">
        <RibbonLargeButton
          icon={IconOpen}
          label="IFC öffnen"
          tooltip="IFC-, IFCZIP- oder IFCX-Datei öffnen"
          onClick={fileCommands.openFiles}
        />
        <RibbonSmallStack>
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
        </RibbonSmallStack>
      </RibbonGroup>

      <RibbonGroupDivider />

      <RibbonGroup label="Export">
        <ExportSplitButton session={active?.session ?? null} pending={pending} />
      </RibbonGroup>

      <RibbonGroupDivider />

      <RibbonGroup label="Bearbeiten">
        <RibbonLargeButton
          icon={IconUndo}
          label="Rückgängig"
          tooltip={undoLabel ? `Rückgängig: ${undoLabel}` : "Rückgängig"}
          shortcut="Strg+Z"
          disabled={!docId || !undoLabel}
          onClick={() => docId && undo(docId)}
        />
        <RibbonLargeButton
          icon={IconRedo}
          label="Wiederholen"
          tooltip={redoLabel ? `Wiederholen: ${redoLabel}` : "Wiederholen"}
          shortcut="Strg+Y"
          disabled={!docId || !redoLabel}
          onClick={() => docId && redo(docId)}
        />
      </RibbonGroup>
    </>
  );
}
