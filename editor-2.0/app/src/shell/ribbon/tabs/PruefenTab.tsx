/**
 * Ribbon · Prüfen — Prüfzentrum und Regelprüfung.
 *
 * Der IDS-Eintrag hängt an `optionalPane("ids-validation")`: gibt es das
 * Pane in dieser Version nicht (es entsteht parallel), fällt die Gruppe
 * lautlos weg, statt auf eine unbekannte Id zu zeigen.
 */
import { BUILTIN_WORKSPACES } from "../../../panes/workspaces";
import { useUi } from "../../../store/ui";
import { IconCheck, IconIds, IconInspector, IconNotes } from "../icons";
import { optionalPane, paneTitle, togglePane, usePaneVisible } from "../panes";
import {
  RibbonGroup,
  RibbonGroupDivider,
  RibbonLargeButton,
  RibbonSmallButton,
  RibbonSmallStack,
} from "../primitives";

const IDS_PANE = optionalPane("ids-validation");
/** Ebenso defensiv: den IDS-Arbeitsbereich gibt es erst mit dem Pane. */
const IDS_WORKSPACE = "IDS" in BUILTIN_WORKSPACES ? "IDS" : null;

export function PruefenTab() {
  const workspaceName = useUi((s) => s.workspaceName);
  const switchWorkspace = useUi((s) => s.switchWorkspace);
  const checksVisible = usePaneVisible("checks");
  const inspectorVisible = usePaneVisible("inspector");
  const notesVisible = usePaneVisible("notes");
  const idsVisible = usePaneVisible(IDS_PANE);

  return (
    <>
      <RibbonGroup label="Prüfzentrum">
        <RibbonLargeButton
          icon={IconCheck}
          label="Prüfzentrum"
          tooltip="Arbeitsbereich „Prüfung“ (Prüfzentrum + Viewer + Inspector)"
          active={workspaceName === "Prüfung"}
          onClick={() => switchWorkspace("Prüfung")}
        />
        <RibbonSmallStack>
          <RibbonSmallButton
            icon={IconCheck}
            label="Prüf-Fenster"
            tooltip="Fenster „Prüfzentrum“ ein-/ausblenden"
            active={checksVisible}
            onClick={() => togglePane("checks")}
          />
          <RibbonSmallButton
            icon={IconInspector}
            label="Inspector"
            tooltip="Fenster „Inspector“ ein-/ausblenden"
            active={inspectorVisible}
            onClick={() => togglePane("inspector")}
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

      {IDS_PANE ? (
        <>
          <RibbonGroupDivider />
          <RibbonGroup label="Regelprüfung">
            <RibbonLargeButton
              icon={IconIds}
              label={paneTitle(IDS_PANE)}
              tooltip={`Fenster „${paneTitle(IDS_PANE)}“ ein-/ausblenden`}
              active={idsVisible}
              onClick={() => togglePane(IDS_PANE)}
            />
            {IDS_WORKSPACE ? (
              <RibbonLargeButton
                icon={IconCheck}
                label="IDS-Arbeitsbereich"
                tooltip="Arbeitsbereich „IDS“ (IDS-Validierung + Viewer)"
                active={workspaceName === IDS_WORKSPACE}
                onClick={() => switchWorkspace(IDS_WORKSPACE)}
              />
            ) : null}
          </RibbonGroup>
        </>
      ) : null}
    </>
  );
}
