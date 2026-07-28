/**
 * Ribbon · Ansicht — Arbeitsbereiche als Galerie, die Fenster des aktuellen
 * Layouts als Schalter, dazu Theme und UI-Zoom. Alles über `useUi`.
 */
import type { PaneId } from "../../../panes/ids";
import { useUi } from "../../../store/ui";
import type { IconComponent } from "../icons";
import {
  IconCube,
  IconGraph,
  IconInspector,
  IconLens,
  IconMoon,
  IconNotes,
  IconSave,
  IconStructure,
  IconSun,
  IconZoom,
} from "../icons";
import { togglePane, usePaneVisible } from "../panes";
import {
  RibbonGroup,
  RibbonGroupDivider,
  RibbonLargeButton,
  RibbonSmallButton,
  RibbonSmallStack,
} from "../primitives";
import { WorkspaceGallery } from "../WorkspaceGallery";

export function AnsichtTab() {
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const uiScale = useUi((s) => s.uiScale);
  const setUiScale = useUi((s) => s.setUiScale);
  const workspaceName = useUi((s) => s.workspaceName);
  const customWorkspaces = useUi((s) => s.customWorkspaces);
  const saveCurrentAsWorkspace = useUi((s) => s.saveCurrentAsWorkspace);
  const deleteWorkspace = useUi((s) => s.deleteWorkspace);
  const isCustom = customWorkspaces.some((w) => w.name === workspaceName);

  const panes: readonly PaneEntry[] = [
    { id: "structure", label: "Struktur", icon: IconStructure },
    { id: "viewer", label: "3D-Viewer", icon: IconCube },
    { id: "inspector", label: "Inspector", icon: IconInspector },
    { id: "graph", label: "Graph", icon: IconGraph },
    { id: "lens", label: "Lens", icon: IconLens },
    { id: "notes", label: "Notizen", icon: IconNotes },
  ];

  return (
    <>
      <RibbonGroup label="Arbeitsbereiche">
        <WorkspaceGallery />
        <RibbonSmallStack>
          <RibbonSmallButton
            icon={IconSave}
            label="Layout sichern"
            tooltip="Aktuelles Layout als Workspace speichern"
            onClick={() => {
              const name = prompt("Name des Workspace:");
              if (name) saveCurrentAsWorkspace(name.trim());
            }}
          />
          <RibbonSmallButton
            icon={IconSave}
            label="Workspace löschen"
            tooltip={
              isCustom
                ? `Eigenen Workspace „${workspaceName}“ löschen`
                : "Nur eigene Workspaces lassen sich löschen"
            }
            disabled={!isCustom}
            onClick={() => deleteWorkspace(workspaceName)}
          />
        </RibbonSmallStack>
      </RibbonGroup>

      <RibbonGroupDivider />

      <RibbonGroup label="Fenster">
        <PaneToggles entries={panes.slice(0, 3)} />
        <PaneToggles entries={panes.slice(3)} />
      </RibbonGroup>

      <RibbonGroupDivider />

      <RibbonGroup label="Darstellung">
        <RibbonLargeButton
          icon={theme === "light" ? IconMoon : IconSun}
          label={theme === "light" ? "Dunkel" : "Hell"}
          tooltip="Theme umschalten"
          onClick={() => setTheme(theme === "light" ? "dark" : "light")}
        />
        <div className="ribbon-field">
          <label className="ribbon-field-label" htmlFor="ribbon-ui-scale">
            <IconZoom className="ribbon-icon-sm" />
            UI-Zoom
          </label>
          <input
            id="ribbon-ui-scale"
            type="range"
            min={70}
            max={125}
            step={5}
            value={uiScale}
            title={`Oberfläche auf ${uiScale} % skalieren`}
            onChange={(event) => setUiScale(Number(event.target.value))}
          />
          <span className="ribbon-field-value">{uiScale} %</span>
        </div>
      </RibbonGroup>
    </>
  );
}

interface PaneEntry {
  id: PaneId;
  label: string;
  icon: IconComponent;
}

function PaneToggles({ entries }: { entries: readonly PaneEntry[] }) {
  return (
    <RibbonSmallStack>
      {entries.map((entry) => (
        <PaneToggle key={entry.id} {...entry} />
      ))}
    </RibbonSmallStack>
  );
}

function PaneToggle({ id, label, icon }: PaneEntry) {
  const visible = usePaneVisible(id);
  return (
    <RibbonSmallButton
      icon={icon}
      label={label}
      tooltip={`Fenster „${label}“ ein-/ausblenden`}
      active={visible}
      onClick={() => togglePane(id)}
    />
  );
}
