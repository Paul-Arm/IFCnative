/**
 * Pragmatische Klassenlisten der Modell-Diagnostik (M6).
 *
 * Bewusst nicht schema-vollständig: geprüft wird, was ein Modell üblicherweise
 * an physischen Bauteilen führt — dieselbe Auswahl wie `isPhysicalProduct` in
 * 1.x (`/src/ifc/nativeDocument.ts`). Alle Einträge sind STEP-Klassennamen in
 * Großschreibung, so wie sie `store.entityIndex.byType` führt.
 */

/** Klassen, für die Platzierung, Repräsentation und Verortung geprüft werden. */
export const PHYSICAL_PRODUCTS: ReadonlySet<string> = new Set([
  "IFCBUILTELEMENT",
  "IFCBUILDINGELEMENTPROXY",
  "IFCPROXY",
  "IFCWALL",
  "IFCWALLSTANDARDCASE",
  "IFCWALLELEMENTEDCASE",
  "IFCSLAB",
  "IFCSLABSTANDARDCASE",
  "IFCSLABELEMENTEDCASE",
  "IFCROOF",
  "IFCBEAM",
  "IFCBEAMSTANDARDCASE",
  "IFCCOLUMN",
  "IFCCOLUMNSTANDARDCASE",
  "IFCMEMBER",
  "IFCPLATE",
  "IFCDOOR",
  "IFCWINDOW",
  "IFCCURTAINWALL",
  "IFCSTAIR",
  "IFCSTAIRFLIGHT",
  "IFCRAMP",
  "IFCRAMPFLIGHT",
  "IFCRAILING",
  "IFCCOVERING",
  "IFCFOOTING",
  "IFCPILE",
  "IFCFURNISHINGELEMENT",
  "IFCFLOWTERMINAL",
  "IFCFLOWSEGMENT",
  "IFCFLOWFITTING",
  "IFCDISTRIBUTIONELEMENT",
  "IFCELEMENTASSEMBLY",
  "IFCTRANSPORTELEMENT",
  "IFCOPENINGELEMENT",
  "IFCVOIDINGFEATURE",
  "IFCPROJECTIONELEMENT",
]);

/**
 * Klassen, die bewusst KEINE eigene räumliche Zuordnung brauchen: Öffnungen
 * und Formmerkmale hängen über IfcRelVoidsElement am Bauteil.
 */
export const CONTAINMENT_EXEMPT: ReadonlySet<string> = new Set([
  "IFCOPENINGELEMENT",
  "IFCVOIDINGFEATURE",
  "IFCPROJECTIONELEMENT",
]);
