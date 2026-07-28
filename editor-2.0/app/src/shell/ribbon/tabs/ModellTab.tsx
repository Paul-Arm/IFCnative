/**
 * Ribbon · Modell — Verweise auf die fachlichen Panes und die zugehörigen
 * Arbeitsbereiche. Die Schalter wechseln nur Workspace bzw. Layout; die
 * Fachlogik bleibt vollständig in den Panes.
 */
import { useUi } from "../../../store/ui";
import {
  IconBuilder,
  IconCatalog,
  IconDrawing,
  IconHub,
  IconTable,
} from "../icons";
import { showPane, togglePane, usePaneVisible } from "../panes";
import {
  RibbonGroup,
  RibbonGroupDivider,
  RibbonLargeButton,
  RibbonSmallButton,
  RibbonSmallStack,
} from "../primitives";

export function ModellTab() {
  const workspaceName = useUi((s) => s.workspaceName);
  const switchWorkspace = useUi((s) => s.switchWorkspace);
  const builderVisible = usePaneVisible("builder");
  const batchVisible = usePaneVisible("pset-batch");
  const catalogVisible = usePaneVisible("catalog");
  const listsVisible = usePaneVisible("lists");
  const drawingVisible = usePaneVisible("drawing");
  const hubVisible = usePaneVisible("hub");

  return (
    <>
      <RibbonGroup label="Bearbeiten">
        <RibbonLargeButton
          icon={IconBuilder}
          label="Baukasten"
          tooltip="Arbeitsbereich „Bauen“ (Struktur + Viewer + Baukasten)"
          active={workspaceName === "Bauen"}
          onClick={() => switchWorkspace("Bauen")}
        />
        <RibbonSmallStack>
          <RibbonSmallButton
            icon={IconBuilder}
            label="Baukasten-Fenster"
            tooltip="Fenster „Baukasten“ ein-/ausblenden"
            active={builderVisible}
            onClick={() => togglePane("builder")}
          />
          <RibbonSmallButton
            icon={IconTable}
            label="Pset Batch"
            tooltip="Fenster „Pset Batch“ ein-/ausblenden"
            active={batchVisible}
            onClick={() => togglePane("pset-batch")}
          />
          <RibbonSmallButton
            icon={IconCatalog}
            label="Objektkatalog"
            tooltip="Fenster „Objektkatalog“ ein-/ausblenden"
            active={catalogVisible}
            onClick={() => togglePane("catalog")}
          />
        </RibbonSmallStack>
      </RibbonGroup>

      <RibbonGroupDivider />

      <RibbonGroup label="Daten">
        <RibbonLargeButton
          icon={IconTable}
          label="Daten-Arbeitsbereich"
          tooltip="Arbeitsbereich „Daten“ (Pset Batch + Objektkatalog)"
          active={workspaceName === "Daten"}
          onClick={() => switchWorkspace("Daten")}
        />
        <RibbonLargeButton
          icon={IconTable}
          label="Listen"
          tooltip="Arbeitsbereich „Auswertung“ (Listen + Viewer)"
          active={workspaceName === "Auswertung"}
          onClick={() => switchWorkspace("Auswertung")}
        />
        <RibbonSmallStack>
          <RibbonSmallButton
            icon={IconTable}
            label="Listen-Fenster"
            tooltip="Fenster „Listen“ ein-/ausblenden"
            active={listsVisible}
            onClick={() => togglePane("lists")}
          />
          <RibbonSmallButton
            icon={IconCatalog}
            label="Katalog öffnen"
            tooltip="Fenster „Objektkatalog“ anzeigen"
            onClick={() => showPane("catalog")}
          />
        </RibbonSmallStack>
      </RibbonGroup>

      <RibbonGroupDivider />

      <RibbonGroup label="Pläne & Hub">
        <RibbonLargeButton
          icon={IconDrawing}
          label="2D-Ansicht"
          tooltip="Arbeitsbereich „Pläne“ (2D-Ansicht + Struktur)"
          active={workspaceName === "Pläne"}
          onClick={() => switchWorkspace("Pläne")}
        />
        <RibbonLargeButton
          icon={IconHub}
          label="IFC-Hub"
          tooltip="Arbeitsbereich „Hub“ (IFC-Hub + Viewer)"
          active={workspaceName === "Hub"}
          onClick={() => switchWorkspace("Hub")}
        />
        <RibbonSmallStack>
          <RibbonSmallButton
            icon={IconDrawing}
            label="Plan-Fenster"
            tooltip="Fenster „2D-Ansicht“ ein-/ausblenden"
            active={drawingVisible}
            onClick={() => togglePane("drawing")}
          />
          <RibbonSmallButton
            icon={IconHub}
            label="Hub-Fenster"
            tooltip="Fenster „IFC-Hub“ ein-/ausblenden"
            active={hubVisible}
            onClick={() => togglePane("hub")}
          />
        </RibbonSmallStack>
      </RibbonGroup>
    </>
  );
}
