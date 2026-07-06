import {
  asRecord,
  modelNameForNode,
  portalExternalId,
  readString,
  type PortalNode,
  type PsetProp,
} from "./types";

export const LINK_PSET_NAME = "Pset_MarxKrontalBWD";
export const SOURCE_SYSTEM = "MarxKrontalBWD";
/** Quelle der Klassifikationsreferenzen (Location-Attribut, wie im Beispiel-IFC). */
export const CLASSIFICATION_SOURCE = "openSIM BIM Objektkatalog";

export interface PortalCatalogPset {
  psetName: string;
  properties: PsetProp[];
}

/**
 * Kontext für die Katalog-ID-Ableitung. Alle Felder optional; ohne Kontext
 * fällt die Ableitung auf sichererName-Regex bzw. Portal-Id zurück.
 */
/**
 * Bausteine des Dot-ID-Präfixes (Beispiel-IFC-Konvention
 * "Bauwerksnummer.Teilbauwerksnummer.Projekt.<Name>"). Der Hierarchie-Payload
 * liefert keine Nummern, deshalb werden ersatzweise die Namen der beim
 * Baum-Durchlauf passierten Knoten bzw. der Panel-Einstellungen verwendet.
 */
export interface CatalogIdPrefix {
  bauwerk?: string;
  teilbauwerk?: string;
  projekt?: string;
}

export interface CatalogIdContext {
  /** Fallback: laufende Nummer des Untersuchungsbereichs (1-basiert). */
  ubNumber?: number;
  /** Fallback: laufende Nummer der Untersuchungsstelle im UB (1-basiert). */
  usNumber?: number;
  /** Fallback: laufende Nummer der Probe (1-basiert). */
  probeNumber?: number;
  /** Eltern-Untersuchungsbereich einer Untersuchungsstelle. */
  parentUb?: PortalNode;
  /** Bauteil-Vorfahre (für die _BauteilID-Verlinkung der US). */
  parentBauteil?: PortalNode;
  /** Präfix-Bausteine für Dot-IDs. */
  idPrefix?: CatalogIdPrefix;
  /** 1-basierter Index für Mehrfach-Psets am Host (ePset_Kanal<N>, ePset_Maßnahme<N>). */
  psetIndex?: number;
  /**
   * true = der Knoten wird als Pset AM Host abgebildet (target "pset"),
   * nicht als eigenes Element. Untersuchungsbereiche erzeugen dann die
   * nummerierte Beispiel-IFC-Form ePset_Untersuchungsbereich<NN>.
   */
  asHostPset?: boolean;
  /** Sammelbecken für Warnungen (z. B. unbekannte Verfahren). */
  warnings?: string[];
}

// --- Property-Namen ------------------------------------------------------------

const UMLAUT_TRANSLITERATIONS: Record<string, string> = {
  ä: "ae",
  ö: "oe",
  ü: "ue",
  Ä: "Ae",
  Ö: "Oe",
  Ü: "Ue",
  ß: "ss",
};

/**
 * ASCII-Identifier [0-9A-Za-z_]: Umlaute transliterieren (ä→ae …), Rest wird
 * "_", führende Ziffer bekommt ein "Field_"-Präfix (FreeCAD-kompatibel).
 */
export function sanitizePropertyName(name: string): string {
  const transliterated = name.replace(
    /[äöüÄÖÜß]/g,
    (char) => UMLAUT_TRANSLITERATIONS[char] ?? char,
  );
  const ascii = transliterated.replace(/[^0-9A-Za-z_]/g, "_");
  if (!ascii) {
    return "Field";
  }
  return /^[0-9]/.test(ascii) ? `Field_${ascii}` : ascii;
}

// --- Link-Pset -------------------------------------------------------------------

/**
 * Properties für Pset_MarxKrontalBWD. LinkedAt wird bewusst NICHT geschrieben
 * (Determinismus für Tests und idempotente Re-Importe).
 */
export function buildLinkPsetProperties(
  node: PortalNode,
  extra?: Record<string, string>,
): PsetProp[] {
  const properties: PsetProp[] = [
    { name: "ExternalId", value: portalExternalId(node) },
    { name: "SourceSystem", value: SOURCE_SYSTEM },
    { name: "ApiType", value: node.nodeType },
    { name: "ApiId", value: String(node.id) },
  ];
  const apiName = node.rawName ?? node.name;
  if (apiName) {
    properties.push({ name: "ApiName", value: apiName });
  }
  if (node.sichererName) {
    properties.push({ name: "SichererName", value: node.sichererName });
  }
  if (extra) {
    for (const [name, value] of Object.entries(extra)) {
      properties.push({ name: sanitizePropertyName(name), value });
    }
  }
  return properties;
}

// --- Verfahrens-Registry ----------------------------------------------------------

export interface PortalVerfahrenSpec {
  /** Kanonischer (verboser) Modellname, z. B. "Kernbohrung". */
  model: string;
  /** Katalog-Pset (Master-Name), z. B. "ePset_Kernbohrung". */
  pset: string;
  /** Pset-Abkürzung aus dem Objektkatalog, z. B. "KB". */
  abbr: string;
  /** Marker-Basis inkl. führendem Unterstrich; Property `${marker}_${abbr}` = abbr. */
  marker?: string;
}

export const PORTAL_VERFAHREN_REGISTRY: readonly PortalVerfahrenSpec[] = [
  { abbr: "KB", marker: "_Kernbohrung", model: "Kernbohrung", pset: "ePset_Kernbohrung" },
  { abbr: "OE", marker: "_Oeffnung", model: "Oeffnung", pset: "ePset_Oeffnung" },
  { abbr: "SRB", marker: "_Spiralbohrung", model: "Spiralbohrung", pset: "ePset_Spiralbohrung" },
  { abbr: "EK", marker: "_Endoskopie", model: "Endoskopie", pset: "ePset_Endoskopie" },
  // Kein Marker: ePset_Abreißversuch hat keine selbstbenannte Marker-Property.
  { abbr: "HZ", model: "Haftzugmessung", pset: "ePset_Abreißversuch" },
  { abbr: "IE", marker: "_ImpaktEcho", model: "ImpactEcho", pset: "ePset_Impakt-Echo" },
  { abbr: "USM", marker: "_Ultraschallmessung", model: "Ultraschallmessung", pset: "ePset_Ultraschall" },
  { abbr: "RPH", marker: "_Rueckprallhammer", model: "Rueckprallhammer", pset: "ePset_Rueckprallhammer" },
  { abbr: "MF", marker: "_Messfeld", model: "Messfeld", pset: "ePset_Messfeld" },
  // Kein Marker im Katalog-Pset vorhanden.
  { abbr: "PFM", model: "Potentialfeldmessung", pset: "ePset_Potentialfeldmessung" },
  { abbr: "CA", marker: "_Chloridanalyse", model: "Chloridanalyse", pset: "ePset_Chloridgehalt" },
  { abbr: "FEU", marker: "_Feuchte", model: "Feuchte", pset: "ePset_Feuchtegehalt" },
  { abbr: "SA", marker: "_Salze", model: "Salze", pset: "ePset_Salze" },
  { abbr: "DFK", marker: "_Druckfestigkeitspruefung", model: "Druckfestigkeitsprüfung", pset: "ePset_Druckfestigkeit" },
  { abbr: "RD", marker: "_Rohdichteermittlung", model: "Rohdichteermittlung", pset: "ePset_Rohdichte" },
  { abbr: "EM", marker: "_E-Modul", model: "EModulErmittlung", pset: "ePset_E-Modul" },
  { abbr: "SG", marker: "_ErmittlungSulfatgehalt", model: "ErmittlungSulfatgehalt", pset: "ePset_Sulfatgehalt" },
  { abbr: "BG", marker: "_Betongefuege", model: "Betongefuege", pset: "ePset_Beton Gefuege" },
  { abbr: "MOE", marker: "_Moertel", model: "Moertel", pset: "ePset_Moertel Gefuege" },
  { abbr: "VB", marker: "_VisuelleBestandsaufnahme", model: "VisuelleBestandsaufnahme", pset: "ePset_Bestandsaufnahme visuell" },
  // Deckt per Präfix-Match auch BewehrungserkundungElektromagnetisch ab;
  // Georadar/Betondeckungsscan haben eigene Katalog-Klassen (GR/EBD) und
  // stehen deshalb als exakte Zeilen VOR dem Präfix-Fallback.
  { abbr: "EBS", marker: "_ElektromagnetischeBewehrungssondierung", model: "Bewehrungserkundung", pset: "ePset_Bewehrung elektromagnetisch" },
  { abbr: "GR", marker: "_Georadar", model: "BewehrungserkundungGeoradar", pset: "ePset_Georadar" },
  { abbr: "EBD", marker: "_ElektromagnetischeErkundungBetondeckung", model: "BewehrungserkundungBetondeckungsscan", pset: "ePset_Betondeckung elektromagnetisch" },
  { abbr: "ESB", marker: "_ElektromagnetischeSpanndrahtbruchortung", model: "ElektromagnetischeSpanndrahtbruchortung", pset: "ePset_Spanndrahtbruchortung elektromagnetisch" },
  { abbr: "SGS", marker: "_Spanngliedsondierung", model: "Spanngliedsondierung", pset: "ePset_Spannglied visuell" },
  { abbr: "MC", marker: "_MessungCarbonatisierungstiefe", model: "MessungCarbonatisierungstiefe", pset: "ePset_Carbonatisierungstiefe" },
  // Probe bekommt statt Marker die ID-Property _IDProbe (PB_X_Y_Z).
  { abbr: "PB", model: "Probe", pset: "ePset_Probe" },
  { abbr: "ALX", marker: "_Altlasten", model: "Altlasten", pset: "ePset_AltlastenX" },
  // Weitere Backend-Verfahren mit eigenem Katalog-Pset (Marker-Namen aus dem
  // BWD-Objektkatalog, Master-Pset-Namen; Katalog §2.4/2.6).
  { abbr: "GNS", marker: "_GefuegeNaturstein", model: "GefuegeNaturstein", pset: "ePset_Naturstein Gefuege" },
  { abbr: "GA", marker: "_GefuegeAbdichtung", model: "GefuegeAbdichtung", pset: "ePset_Abdichtung Gefuege" },
  { abbr: "MWA", marker: "_MauerwerkGefuegeAußen", model: "AeusseresMauerwerksgefuege", pset: "ePset_Mauerwerk Gefuege außen" },
  { abbr: "MWI", marker: "_InneresMauerwerksgefuege", model: "InneresMauerwerksgefuege", pset: "ePset_Mauerwerk Gefuege innen" },
  // SKB nutzt laut Katalog das Kernbohrungs-Schema inkl. _Kernbohrung_SKB-Marker.
  { abbr: "SKB", marker: "_Kernbohrung", model: "ZerstoerungsarmeSondierungskernbohrung", pset: "ePset_Sondierungskernbohrung" },
  // Labor-Variante des Moertel-Gefueges (gleiches Katalog-Pset wie vor Ort).
  { abbr: "MOE", marker: "_Moertel", model: "GefuegeMoertel", pset: "ePset_Moertel Gefuege" },
  // Backend-Schreibweise ohne "h" ("MechanischeStaleigenschaften").
  { abbr: "MSE", marker: "_MechanischeStahleigenschaften", model: "MechanischeStaleigenschaften", pset: "ePset_Stahl mechanische Eigenschaften" },
  { abbr: "RDM", marker: "_Rueckdehnungsmessung", model: "Rueckdehnungsmessung", pset: "ePset_Rueckdehnungsmessung" },
];

function transliterateLower(value: string): string {
  return value
    .replace(/[äöüÄÖÜß]/g, (char) => UMLAUT_TRANSLITERATIONS[char] ?? char)
    .toLowerCase();
}

const VERFAHREN_BY_KEY = (() => {
  const map = new Map<string, PortalVerfahrenSpec>();
  for (const spec of PORTAL_VERFAHREN_REGISTRY) {
    map.set(spec.model.toLowerCase(), spec);
    map.set(transliterateLower(spec.model), spec);
  }
  return map;
})();

/** Registry-Lookup per nodeType (case-insensitive, Umlaut-tolerant). */
export function verfahrenSpecForType(
  nodeType: string,
): PortalVerfahrenSpec | null {
  const key = nodeType.trim().toLowerCase();
  if (!key) {
    return null;
  }
  const exact = VERFAHREN_BY_KEY.get(key) ?? VERFAHREN_BY_KEY.get(transliterateLower(key));
  if (exact) {
    return exact;
  }
  if (key.startsWith("bewehrungserkundung")) {
    return VERFAHREN_BY_KEY.get("bewehrungserkundung") ?? null;
  }
  return null;
}

// --- Katalog-ID-Ableitung ----------------------------------------------------------

const UB_SICHERER_NAME_PATTERN = /^UB\.[^.]+\.(\d+)$/;
const US_SICHERER_NAME_PATTERN = /^US\.[^.]+\.(\d+)\.(\d+)$/;

export function ubNumberFromSichererName(
  node?: Pick<PortalNode, "sichererName">,
): number | null {
  const match = node?.sichererName?.match(UB_SICHERER_NAME_PATTERN);
  return match ? Number.parseInt(match[1], 10) : null;
}

/** `UB_<X>`: X aus sichererName ("UB.DB.01" -> 1), sonst Kontext-Nummer, sonst Portal-Id. */
export function deriveUntersuchungsbereichId(
  node: PortalNode,
  fallbackNumber?: number,
): string {
  const fromName = ubNumberFromSichererName(node);
  if (fromName !== null) {
    return `UB_${fromName}`;
  }
  if (fallbackNumber !== undefined) {
    return `UB_${fallbackNumber}`;
  }
  return `UB_${node.id}`;
}

/** `US_<X>_<Y>`: aus sichererName ("US.DB.01.02" -> US_1_2), sonst Kontext, sonst Portal-Id. */
export function deriveUntersuchungsstelleId(
  node: PortalNode,
  context: CatalogIdContext = {},
): string {
  const match = node.sichererName?.match(US_SICHERER_NAME_PATTERN);
  if (match) {
    return `US_${Number.parseInt(match[1], 10)}_${Number.parseInt(match[2], 10)}`;
  }
  const x = ubNumberFromSichererName(context.parentUb) ?? context.ubNumber;
  const y = context.usNumber;
  if (x !== undefined && x !== null && y !== undefined) {
    return `US_${x}_${y}`;
  }
  return `US_${node.id}`;
}

/**
 * Projekt-Baustein der Dot-ID: die Projekt-Bezeichnung mit "_" statt
 * Punkten/Leerzeichen — dieselbe Ersetzung nutzt der Server-IFC-Export
 * ("05388.02 FM DIA 2012" -> "05388_02_FM_DIA_2012").
 */
export function projektIdToken(bezeichnung: string): string {
  return bezeichnung.trim().replace(/[ .]/g, "_");
}

/**
 * Dot-ID im Stil der Beispiel-IFCs:
 * "<Bauwerksnummer>.<Teilbauwerksnummer>.<Projekt>.<Name>" (z. B.
 * "5692002.2.05388_02_FM_DIA_2012.US.01") — fehlende Präfix-Bausteine werden
 * ausgelassen, der Knoten-Name ist sichererName (bevorzugt) bzw. name.
 */
export function dotIdForNode(
  node: Pick<PortalNode, "sichererName" | "name">,
  context: CatalogIdContext,
): string {
  const prefix = context.idPrefix ?? {};
  return [
    prefix.bauwerk,
    prefix.teilbauwerk,
    prefix.projekt,
    node.sichererName || node.name,
  ]
    .filter((token): token is string => Boolean(token && token.trim()))
    .join(".");
}

/** Dot-ID des Bauteil-Vorfahren: "<Bauwerk>.<Teilbauwerk>.<Bauteilname>". */
function bauteilDotId(context: CatalogIdContext): string | null {
  if (!context.parentBauteil) {
    return null;
  }
  const prefix = context.idPrefix ?? {};
  return [prefix.bauwerk, prefix.teilbauwerk, context.parentBauteil.name]
    .filter((token): token is string => Boolean(token && token.trim()))
    .join(".");
}

function deriveProbeId(node: PortalNode, context: CatalogIdContext): string {
  const x = ubNumberFromSichererName(context.parentUb) ?? context.ubNumber;
  const y = context.usNumber;
  const z = context.probeNumber;
  if (x !== undefined && x !== null && y !== undefined && z !== undefined) {
    return `PB_${x}_${y}_${z}`;
  }
  return `PB_${node.id}`;
}

// --- Katalog-Pset-Builder ------------------------------------------------------------

function pushLabel(properties: PsetProp[], name: string, value: string) {
  if (value) {
    properties.push({ name, value });
  }
}

function pushReal(properties: PsetProp[], name: string, value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    properties.push({ name, value: String(value), valueType: "IFCREAL" });
    return;
  }
  const text = readString(value).trim();
  if (text && Number.isFinite(Number(text))) {
    properties.push({ name, value: text, valueType: "IFCREAL" });
  }
}

/** Verbose Verfahrensnamen der Nachfahren eines UB (distinct, Reihenfolge stabil). */
function collectVerfahrenNames(node: PortalNode): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const visit = (candidate: PortalNode) => {
    const spec = verfahrenSpecForType(candidate.nodeType);
    if (spec && !seen.has(spec.model)) {
      seen.add(spec.model);
      names.push(spec.model);
    }
    candidate.children.forEach(visit);
  };
  node.children.forEach(visit);
  return names;
}

function buildUntersuchungsbereichPsets(
  node: PortalNode,
  context: CatalogIdContext,
): PortalCatalogPset[] {
  // Beispiel-IFC-Form: _ID als Dot-ID, _Bezeichnung/_Bemerkung unsuffigiert,
  // _Untersuchungsverfahren1_UB als kommagetrennte Verfahrensliste. Als
  // Host-Pset (target "pset") wird der Name zweistellig nummeriert
  // (ePset_Untersuchungsbereich01 …), bei Element-Zuordnung bleibt er blank.
  const properties: PsetProp[] = [
    { name: "_ID", value: dotIdForNode(node, context) },
  ];
  pushLabel(properties, "_Bezeichnung", node.rawName ?? node.name);
  pushLabel(properties, "_Bemerkung", node.bemerkung ?? "");
  const verfahrenNames = collectVerfahrenNames(node);
  if (verfahrenNames.length > 0) {
    properties.push({
      name: "_Untersuchungsverfahren1_UB",
      value: verfahrenNames.join(", "),
    });
  }
  properties.push({ name: "_ExternalId", value: portalExternalId(node) });
  const psetName = context.asHostPset
    ? `ePset_Untersuchungsbereich${String(multiPsetIndex(context)).padStart(2, "0")}`
    : "ePset_Untersuchungsbereich";
  return [{ properties, psetName }];
}

function buildUntersuchungsstellePsets(
  node: PortalNode,
  context: CatalogIdContext,
): PortalCatalogPset[] {
  // Beispiel-IFC-Form: die Verlinkung läuft über ePset_Objektinformationen
  // (_ID/_BauteilID/_UntersuchungsbereichID als Dot-IDs), NICHT über eigene
  // Elemente für Bauteil/Untersuchungsbereich.
  const objektinformationen: PsetProp[] = [
    { name: "_ID", value: dotIdForNode(node, context) },
    { name: "_Bezeichnung", value: node.sichererName || node.name },
  ];
  pushLabel(objektinformationen, "_Bemerkung", node.bemerkung ?? "");
  const bauteilId = bauteilDotId(context);
  if (bauteilId) {
    objektinformationen.push({ name: "_BauteilID", value: bauteilId });
  }
  if (context.parentUb) {
    objektinformationen.push({
      name: "_UntersuchungsbereichID",
      value: dotIdForNode(context.parentUb, context),
    });
  }
  const psets: PortalCatalogPset[] = [
    { properties: objektinformationen, psetName: "ePset_Objektinformationen" },
  ];
  const untersuchungsstelle: PsetProp[] = [];
  pushLabel(untersuchungsstelle, "_Bemerkung", node.bemerkung ?? "");
  const firstVerfahren = node.children[0];
  if (firstVerfahren) {
    const spec = verfahrenSpecForType(firstVerfahren.nodeType);
    untersuchungsstelle.push({
      name: "_Untersuchungsverfahren",
      value: spec?.model ?? modelNameForNode(firstVerfahren),
    });
  }
  if (untersuchungsstelle.length > 0) {
    psets.push({
      properties: untersuchungsstelle,
      psetName: "ePset_Untersuchungsstelle",
    });
  }
  return psets;
}

function buildVerfahrenPsets(
  node: PortalNode,
  context: CatalogIdContext,
): PortalCatalogPset[] {
  const spec = verfahrenSpecForType(node.nodeType);
  if (!spec) {
    context.warnings?.push(
      `Unbekanntes Untersuchungsverfahren "${node.nodeType}" (${portalExternalId(node)}) – kein Katalog-Pset geschrieben.`,
    );
    return [];
  }
  const properties: PsetProp[] = [];
  if (spec.marker) {
    // Marker-Wert ist der verbose Verfahrensname (Beispiel-IFC:
    // _Kernbohrung_KB = 'Kernbohrung'), nicht das Kürzel.
    properties.push({ name: `${spec.marker}_${spec.abbr}`, value: spec.model });
  }
  if (node.nodeType === "probe") {
    properties.push({ name: "_IDProbe", value: deriveProbeId(node, context) });
  }
  pushLabel(properties, `_Datum_${spec.abbr}`, readString(node.raw.datum).trim());
  pushLabel(
    properties,
    `_Bemerkung_${spec.abbr}`,
    readString(node.raw.bemerkung).trim() || node.bemerkung || "",
  );
  pushLabel(properties, `_Foto_${spec.abbr}`, readString(node.raw.titelBild).trim());
  pushLabel(properties, `_Skizze_${spec.abbr}`, readString(node.raw.skizzeURL).trim());
  pushLabel(properties, `_Video_${spec.abbr}`, readString(node.raw.videoURL).trim());
  // Identität für idempotente Re-Importe und Mehrfach-Pset-Zuordnung (analog
  // zu den Querverweis-Properties _UntersuchungszielIDs/_MessfeldID im Beispiel-IFC).
  properties.push({ name: "_ExternalId", value: portalExternalId(node) });
  // Ab der zweiten Instanz desselben Verfahrens am Host wird nummeriert
  // (ePset_Kernbohrung, ePset_Kernbohrung2, …).
  const index = context.psetIndex ?? 1;
  const psetName = index > 1 ? `${spec.pset}${index}` : spec.pset;
  return [{ properties, psetName }];
}

/**
 * Position.koordinaten ist im Backend ein freies CharField (String), kein
 * {x,y,z}-Objekt. Konservativ bis zu drei Zahlen extrahieren: bei Semikolon-/
 * Whitespace-/Pipe-Trennung sind Dezimalkommas innerhalb der Tokens eindeutig
 * ("12,5; 3,2; 41,8"); bei reiner Komma-Trennung werden nur Punkt-Dezimalzahlen
 * akzeptiert, weil "12,5,3" doppeldeutig wäre. Genau drei Zahlen erforderlich.
 */
export function parseKoordinatenText(
  text: string,
): [number, number, number] | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  const hasSeparators = /[;|\s]/.test(trimmed);
  if (!hasSeparators && trimmed.includes(",") && !trimmed.includes(".")) {
    // Reine Komma-Ketten ohne Punkt ("12,5,3") sind doppeldeutig
    // (Dezimalkomma vs. Trennzeichen) — lieber nicht raten.
    return null;
  }
  const pattern = hasSeparators ? /-?\d+(?:[.,]\d+)?/g : /-?\d+(?:\.\d+)?/g;
  const tokens = trimmed.match(pattern);
  if (!tokens || tokens.length !== 3) {
    return null;
  }
  const numbers = tokens.map((token) => Number(token.replace(",", ".")));
  return numbers.every((value) => Number.isFinite(value))
    ? [numbers[0], numbers[1], numbers[2]]
    : null;
}

function pushKoordinaten(properties: PsetProp[], koordinaten: unknown) {
  const record = asRecord(koordinaten);
  if (record) {
    pushReal(properties, "_KoordinatenX", record.x);
    pushReal(properties, "_KoordinatenY", record.y);
    pushReal(properties, "_KoordinatenZ", record.z);
    return;
  }
  const text = readString(koordinaten).trim();
  const parsed = parseKoordinatenText(text);
  if (parsed) {
    pushReal(properties, "_KoordinatenX", parsed[0]);
    pushReal(properties, "_KoordinatenY", parsed[1]);
    pushReal(properties, "_KoordinatenZ", parsed[2]);
    return;
  }
  // Unparsbare Koordinaten nicht still verwerfen, sondern als Text ablegen.
  pushLabel(properties, "_Koordinaten", text);
}

function buildMessstellePsets(node: PortalNode): PortalCatalogPset[] {
  const psets: PortalCatalogPset[] = [];
  const objektinformation: PsetProp[] = [];
  const messstellenbezeichnung = readString(node.raw.messstellenbezeichnung).trim();
  const bezeichnung = readString(node.raw.bezeichnung).trim();
  pushLabel(objektinformation, "_ID", messstellenbezeichnung || bezeichnung);
  pushLabel(objektinformation, "_Bezeichnung", bezeichnung || messstellenbezeichnung);
  if (objektinformation.length > 0) {
    psets.push({ properties: objektinformation, psetName: "ePset_Objektinformation" });
  }
  const position = asRecord(node.raw.position);
  if (position) {
    const properties: PsetProp[] = [];
    pushLabel(properties, "_Bauteilbereich", readString(position.bauteilbereich).trim());
    pushLabel(properties, "_Ausrichtung", readString(position.ausrichtung).trim());
    pushLabel(properties, "_Messachse", readString(position.messachse).trim());
    if (
      position.koordinaten !== undefined &&
      position.koordinaten !== null &&
      position.koordinaten !== ""
    ) {
      pushKoordinaten(properties, position.koordinaten);
    } else {
      pushReal(properties, "_KoordinatenX", position.x);
      pushReal(properties, "_KoordinatenY", position.y);
      pushReal(properties, "_KoordinatenZ", position.z);
    }
    if (properties.length > 0) {
      psets.push({ properties, psetName: "ePset_Position" });
    }
  }
  const sensor = asRecord(node.raw.sensor);
  if (sensor) {
    const properties: PsetProp[] = [];
    pushLabel(
      properties,
      "_SensorSeriennummerLtHersteller",
      readString(sensor.inventarnummer).trim(),
    );
    pushLabel(
      properties,
      "_BezeichnungLtHersteller",
      readString(sensor.modellbezeichnung).trim(),
    );
    pushLabel(properties, "_Hersteller", readString(sensor.hersteller).trim());
    if (properties.length > 0) {
      psets.push({ properties, psetName: "ePset_Sensor" });
    }
  }
  return psets;
}

function multiPsetIndex(context: CatalogIdContext): number {
  return context.psetIndex !== undefined && context.psetIndex > 0
    ? context.psetIndex
    : 1;
}

function buildKanalPsets(
  node: PortalNode,
  context: CatalogIdContext,
): PortalCatalogPset[] {
  const properties: PsetProp[] = [];
  pushLabel(
    properties,
    "_ID",
    readString(node.raw.sicherer_name).trim() || readString(node.raw.name).trim(),
  );
  pushLabel(properties, "_Bezeichnung", readString(node.raw.name).trim());
  pushLabel(properties, "_Datentyp", readString(node.raw.datentyp).trim());
  pushLabel(properties, "_PhysikalischeGroeße", readString(node.raw.einheit).trim());
  if (properties.length === 0) {
    return [];
  }
  properties.push({ name: "_ExternalId", value: portalExternalId(node) });
  return [{ properties, psetName: `ePset_Kanal${multiPsetIndex(context)}` }];
}

function buildMassnahmePsets(
  node: PortalNode,
  context: CatalogIdContext,
): PortalCatalogPset[] {
  const properties: PsetProp[] = [
    // Die dotted MON-ID-Konvention (Bauwerksnummer.Teilbauwerksnummer.…) ist aus
    // dem API-Datensatz nicht ableitbar; wir schreiben den Portal-Primärschlüssel.
    { name: "_ID", value: String(node.id) },
  ];
  pushLabel(properties, "_Bezeichnung", readString(node.raw.bezeichnung).trim());
  pushLabel(properties, "_BezeichnungKurz", readString(node.raw.kurzbezeichnung).trim());
  properties.push({ name: "_ExternalId", value: portalExternalId(node) });
  return [{ properties, psetName: `ePset_Maßnahme${multiPsetIndex(context)}` }];
}

/**
 * Objektkatalog-Psets (BWD + MON) für einen Portal-Knoten. Felder werden nur
 * geschrieben, wenn ein Wert vorhanden ist; unbekannte Verfahren erzeugen kein
 * Katalog-Pset, sondern nur eine Warnung in context.warnings.
 */
export function buildCatalogPsetsForNode(
  node: PortalNode,
  context: CatalogIdContext = {},
): PortalCatalogPset[] {
  switch (node.nodeType) {
    case "untersuchungsbereich":
      return buildUntersuchungsbereichPsets(node, context);
    case "untersuchungsstelle":
      return buildUntersuchungsstellePsets(node, context);
    case "messstelle":
      return buildMessstellePsets(node);
    case "kanal":
      return buildKanalPsets(node, context);
    case "massnahme":
      return buildMassnahmePsets(node, context);
    case "bauwerk":
    case "teilbauwerk":
    case "bauteil":
    case "messkonzept":
      return [];
    default:
      return buildVerfahrenPsets(node, context);
  }
}

// --- Record-Pset (rohe DB-Felder) ------------------------------------------------------

function stringifyRecordValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : null;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Pset_MarxKrontalBWD_<Model> mit allen rohen DB-Feldern (FreeCAD-kompatibel):
 * bool -> "true"/"false", Objekt/Array -> JSON, null -> übersprungen, Namen
 * sanitized, Werte als IFCTEXT.
 */
export function buildRecordPset(
  modelName: string,
  record: Record<string, unknown>,
): PortalCatalogPset {
  const psetName = `${LINK_PSET_NAME}_${sanitizePropertyName(modelName)}`;
  const properties: PsetProp[] = [];
  const seen = new Set<string>();
  for (const [key, value] of Object.entries(record)) {
    const stringified = stringifyRecordValue(value);
    if (stringified === null) {
      continue;
    }
    const name = sanitizePropertyName(key);
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    properties.push({ name, value: stringified, valueType: "IFCTEXT" });
  }
  return { properties, psetName };
}

// --- Deterministische GlobalIds ----------------------------------------------------------

/** IFC-Base64-Alphabet (Reihenfolge relevant für die GUID-Kodierung). */
export const IFC_GUID_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";

function cyrb128(input: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    h1 = h2 ^ Math.imul(h1 ^ code, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ code, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ code, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ code, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [
    (h1 ^ h2 ^ h3 ^ h4) >>> 0,
    (h2 ^ h1) >>> 0,
    (h3 ^ h1) >>> 0,
    (h4 ^ h1) >>> 0,
  ];
}

/**
 * Deterministische 22-Zeichen-IFC-GlobalId aus einer ExternalId. 128-bit-Hash
 * (cyrb128 über "MKPPortal:" + externalId) auf das IFC-Base64-Alphabet
 * abgebildet; erstes Zeichen liegt in [0-3], weil 128 Bit in 22 Stellen à
 * 6 Bit nur die obersten 2 Bit der ersten Stelle belegen. Gleiche
 * Portal-Objekte erhalten damit in jedem Import dieselbe GlobalId.
 */
export function ifcGuidForExternalId(externalId: string): string {
  const [h1, h2, h3, h4] = cyrb128(`MKPPortal:${externalId}`);
  let value =
    (BigInt(h1) << 96n) | (BigInt(h2) << 64n) | (BigInt(h3) << 32n) | BigInt(h4);
  const chars = new Array<string>(22);
  for (let index = 21; index >= 0; index -= 1) {
    chars[index] = IFC_GUID_ALPHABET[Number(value & 63n)];
    value >>= 6n;
  }
  return chars.join("");
}
