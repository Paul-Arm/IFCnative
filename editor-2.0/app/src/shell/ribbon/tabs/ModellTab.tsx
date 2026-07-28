/**
 * Ribbon · Modell — Schnellzugriff auf den IFC-Hub (Austausch mit dem
 * Versions-Server). Alle übrigen Modell-Fenster (Baukasten, Pset Batch,
 * Objektkatalog, Listen, 2D-Ansicht) erreicht man zentral über das
 * Fenster-Dropdown im Register „Ansicht" — hier stehen nur noch explizit
 * zugeordnete Schnellzugriffe.
 */
import { IconHub } from "../icons";
import { togglePane, usePaneVisible } from "../panes";
import { RibbonGroup, RibbonSmallButton } from "../primitives";

export function ModellTab() {
  const hubVisible = usePaneVisible("hub");

  return (
    <RibbonGroup label="Austausch">
      <RibbonSmallButton
        icon={IconHub}
        label="IFC-Hub"
        tooltip="Fenster „IFC-Hub“ ein-/ausblenden"
        active={hubVisible}
        onClick={() => togglePane("hub")}
      />
    </RibbonGroup>
  );
}
