/**
 * Ribbon · Ansicht — Layout und Darstellung an einem Ort:
 * links „Ansichten" (Workspace-Dropdown + Sichern/Löschen), daneben das
 * zentrale Fenster-Dropdown (alle Panes gruppiert, Haken = sichtbar),
 * rechts der UI-Zoom. Einzelne Fenster-Toggles gibt es sonst nur noch als
 * Schnellzugriffe in Start (Zuletzt/Notizen), Modell (IFC-Hub) und Prüfen
 * (Prüfzentrum/IDS); Theme und Undo/Redo sind ständige Aktionen in der
 * Registerzeile, die Schnitt-Werkzeuge liegen in der Toolbar des 3D-Viewers.
 */
import { useUi } from "../../../store/ui";
import { IconSave, IconZoom } from "../icons";
import {
  RibbonGroup,
  RibbonGroupDivider,
  RibbonSmallButton,
} from "../primitives";
import { WindowsMenu } from "../WindowsMenu";
import { WorkspaceGallery } from "../WorkspaceGallery";

export function AnsichtTab() {
  const uiScale = useUi((s) => s.uiScale);
  const setUiScale = useUi((s) => s.setUiScale);
  const workspaceName = useUi((s) => s.workspaceName);
  const customWorkspaces = useUi((s) => s.customWorkspaces);
  const saveCurrentAsWorkspace = useUi((s) => s.saveCurrentAsWorkspace);
  const deleteWorkspace = useUi((s) => s.deleteWorkspace);
  const isCustom = customWorkspaces.some((w) => w.name === workspaceName);

  return (
    <>
      <RibbonGroup label="Ansichten">
        <WorkspaceGallery />
        <RibbonSmallButton
          icon={IconSave}
          label="Sichern"
          tooltip="Aktuelles Layout als Workspace speichern"
          onClick={() => {
            const name = prompt("Name des Workspace:");
            if (name) saveCurrentAsWorkspace(name.trim());
          }}
        />
        <RibbonSmallButton
          icon={IconSave}
          label="Löschen"
          tooltip={
            isCustom
              ? `Eigenen Workspace „${workspaceName}“ löschen`
              : "Nur eigene Workspaces lassen sich löschen"
          }
          disabled={!isCustom}
          onClick={() => deleteWorkspace(workspaceName)}
        />
      </RibbonGroup>

      <RibbonGroupDivider />

      <RibbonGroup label="Fenster">
        <WindowsMenu />
      </RibbonGroup>

      <RibbonGroupDivider />

      <RibbonGroup label="Darstellung">
        <div className="rb-field">
          <label className="rb-field-label" htmlFor="ribbon-ui-scale">
            <IconZoom className="tb-icon" />
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
          <span className="rb-field-value">{uiScale} %</span>
        </div>
      </RibbonGroup>
    </>
  );
}
