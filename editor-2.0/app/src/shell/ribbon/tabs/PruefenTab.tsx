/**
 * Ribbon · Prüfen — die Prüf-Fenster als Toggles, jede Funktion genau
 * einmal. Arbeitsbereiche wechselt man zentral über das Workspace-Dropdown
 * im Register „Ansicht".
 *
 * Der IDS-Eintrag hängt an `optionalPane("ids-validation")`: gibt es das
 * Pane in dieser Version nicht (es entsteht parallel), fällt der Eintrag
 * lautlos weg, statt auf eine unbekannte Id zu zeigen.
 */
import { IconCheck, IconIds } from "../icons";
import { optionalPane, paneTitle, togglePane, usePaneVisible } from "../panes";
import { RibbonGroup, RibbonSmallButton } from "../primitives";

const IDS_PANE = optionalPane("ids-validation");

export function PruefenTab() {
  const checksVisible = usePaneVisible("checks");
  const idsVisible = usePaneVisible(IDS_PANE);

  return (
    <RibbonGroup label="Prüfen">
      <RibbonSmallButton
        icon={IconCheck}
        label="Prüfzentrum"
        tooltip="Fenster „Prüfzentrum“ ein-/ausblenden"
        active={checksVisible}
        onClick={() => togglePane("checks")}
      />
      {IDS_PANE ? (
        <RibbonSmallButton
          icon={IconIds}
          label={paneTitle(IDS_PANE)}
          tooltip={`Fenster „${paneTitle(IDS_PANE)}“ ein-/ausblenden`}
          active={idsVisible}
          onClick={() => togglePane(IDS_PANE)}
        />
      ) : null}
    </RibbonGroup>
  );
}
