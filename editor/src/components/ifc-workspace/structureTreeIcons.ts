/**
 * Icon-Sprite für den Struktur-Baum: einfache 16x16-Liniensymbole je
 * IFC-Elementklasse. Wird als spriteSheet in das Shadow DOM der
 * @pierre/trees-Bibliothek injiziert; die Zeilen referenzieren die Symbole
 * per <use href="#id"> über die Decoration-Lane.
 */

const SYMBOL_ATTRS =
  'viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"';

export const IFC_TREE_SPRITE_SHEET = `
<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden">
  <symbol id="ifc-tree-project" ${SYMBOL_ATTRS}>
    <path d="M4 13.5V2.5m0 .9h7.2L9.4 5.6l1.8 2.2H4"/>
  </symbol>
  <symbol id="ifc-tree-site" ${SYMBOL_ATTRS}>
    <path d="M2 12.5h12M3 12.5 6.2 8l2.3 2.9 2.1-2.7 2.6 4.3"/>
  </symbol>
  <symbol id="ifc-tree-building" ${SYMBOL_ATTRS}>
    <path d="M4 13V3.5h8V13M2.5 13h11M6.3 6h.9M8.8 6h.9M6.3 8.5h.9M8.8 8.5h.9M6.3 11h.9M8.8 11h.9"/>
  </symbol>
  <symbol id="ifc-tree-storey" ${SYMBOL_ATTRS}>
    <path d="M8 2.8 13.4 5.5 8 8.2 2.6 5.5ZM3 8.6l5 2.5 5-2.5M3 11.2l5 2.5 5-2.5"/>
  </symbol>
  <symbol id="ifc-tree-space" ${SYMBOL_ATTRS}>
    <rect x="3" y="3" width="10" height="10" rx="1" stroke-dasharray="2.4 2"/>
  </symbol>
  <symbol id="ifc-tree-wall" ${SYMBOL_ATTRS}>
    <path d="M2.5 5h11v6h-11ZM2.5 8h11M8 5v3M5.25 8v3M10.75 8v3"/>
  </symbol>
  <symbol id="ifc-tree-slab" ${SYMBOL_ATTRS}>
    <path d="M2.5 9.5 6.2 5.7h7.3L9.8 9.5ZM2.5 9.5v1.8h7.3V9.5"/>
  </symbol>
  <symbol id="ifc-tree-beam" ${SYMBOL_ATTRS}>
    <path d="M4.5 3.5h7M4.5 12.5h7M8 3.5v9"/>
  </symbol>
  <symbol id="ifc-tree-column" ${SYMBOL_ATTRS}>
    <path d="M4.5 3.5h7M4.5 12.5h7M6.5 3.5v9M9.5 3.5v9"/>
  </symbol>
  <symbol id="ifc-tree-door" ${SYMBOL_ATTRS}>
    <path d="M4.5 13V3h7v10M3 13h10"/>
    <circle cx="9.6" cy="8.2" r="0.7" fill="currentColor" stroke="none"/>
  </symbol>
  <symbol id="ifc-tree-window" ${SYMBOL_ATTRS}>
    <path d="M3 3.5h10v9H3ZM8 3.5v9M3 8h10"/>
  </symbol>
  <symbol id="ifc-tree-sensor" ${SYMBOL_ATTRS}>
    <circle cx="8" cy="10.6" r="1.1" fill="currentColor" stroke="none"/>
    <path d="M5.4 8.6a3.7 3.7 0 0 1 5.2 0M3.4 6.4a6.6 6.6 0 0 1 9.2 0"/>
  </symbol>
  <symbol id="ifc-tree-actuator" ${SYMBOL_ATTRS}>
    <path d="M9.2 2.5 4.8 9h2.9l-1 4.5L11.2 7H8.3Z"/>
  </symbol>
  <symbol id="ifc-tree-group" ${SYMBOL_ATTRS}>
    <rect x="2.5" y="2.5" width="4.4" height="4.4" rx="0.8"/>
    <rect x="9.1" y="2.5" width="4.4" height="4.4" rx="0.8"/>
    <rect x="5.8" y="9.1" width="4.4" height="4.4" rx="0.8"/>
  </symbol>
  <symbol id="ifc-tree-element" ${SYMBOL_ATTRS}>
    <path d="M8 2.6 13.2 5.4v5.2L8 13.4 2.8 10.6V5.4ZM2.8 5.4 8 8.2l5.2-2.8M8 8.2v5.2"/>
  </symbol>
</svg>
`;

/**
 * Ordnet einer IFC-Klasse ihr Baum-Symbol zu. Prüfreihenfolge beachten:
 * spezifische Präfixe (BUILDINGSTOREY, BUILDINGELEMENT…) vor IFCBUILDING.
 */
export function ifcTreeIconFor(type: string): string {
  const t = type.trim().toUpperCase();
  if (t === "IFCPROJECT") return "ifc-tree-project";
  if (t.startsWith("IFCSITE")) return "ifc-tree-site";
  if (t.startsWith("IFCBUILDINGSTOREY")) return "ifc-tree-storey";
  if (t.startsWith("IFCBUILDINGELEMENT")) return "ifc-tree-element";
  if (t.startsWith("IFCBUILDINGSYSTEM")) return "ifc-tree-group";
  if (t.startsWith("IFCBUILDING")) return "ifc-tree-building";
  if (t.startsWith("IFCSPACE")) return "ifc-tree-space";
  if (t.startsWith("IFCWALL")) return "ifc-tree-wall";
  if (
    t.startsWith("IFCSLAB") ||
    t.startsWith("IFCROOF") ||
    t.startsWith("IFCCOVERING") ||
    t.startsWith("IFCPLATE")
  ) {
    return "ifc-tree-slab";
  }
  if (t.startsWith("IFCBEAM") || t.startsWith("IFCMEMBER")) {
    return "ifc-tree-beam";
  }
  if (t.startsWith("IFCCOLUMN") || t.startsWith("IFCPILE")) {
    return "ifc-tree-column";
  }
  if (t.startsWith("IFCDOOR")) return "ifc-tree-door";
  if (t.startsWith("IFCWINDOW") || t.startsWith("IFCCURTAINWALL")) {
    return "ifc-tree-window";
  }
  if (t.startsWith("IFCSENSOR")) return "ifc-tree-sensor";
  if (
    t.startsWith("IFCACTUATOR") ||
    t.startsWith("IFCCONTROLLER") ||
    t.startsWith("IFCFLOW") ||
    t.startsWith("IFCDISTRIBUTION")
  ) {
    return "ifc-tree-actuator";
  }
  if (
    t.startsWith("IFCGROUP") ||
    t.startsWith("IFCSYSTEM") ||
    t.startsWith("IFCZONE") ||
    t.startsWith("IFCASSET") ||
    t.startsWith("IFCINVENTORY")
  ) {
    return "ifc-tree-group";
  }
  return "ifc-tree-element";
}
