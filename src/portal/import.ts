import {
  addNativeClassification,
  addNativeElement,
  addNativeEmptyPropertySet,
  addNativePropertySetValues,
  getNextNativeEntityId,
  quote,
  removeNativePropertySet,
  updateNativeEntity,
  type NativeIfcDocument,
} from "../ifc/nativeDocument";
import {
  buildCatalogPsetsForNode,
  buildLinkPsetProperties,
  buildRecordPset,
  CLASSIFICATION_SOURCE,
  ifcGuidForExternalId,
  LINK_PSET_NAME,
  projektIdToken,
  ubNumberFromSichererName,
  verfahrenSpecForType,
  type CatalogIdContext,
  type PortalCatalogPset,
} from "./catalogPsets";
import { mappingForModel, type PortalModelMapping } from "./mapping";
import {
  modelNameForNode,
  portalExternalId,
  readString,
  type PortalMappingConfig,
  type PortalNode,
  type PortalPsetOptions,
} from "./types";

export interface PortalImportContext {
  mapping: PortalMappingConfig;
  psetOptions: PortalPsetOptions;
  /** Rohe Verfahrens-Records (Key = ExternalId) für Record-Psets. */
  verfahrenRecords?: Map<string, Record<string, unknown>>;
  /**
   * Dot-ID-Präfix-Bausteine, falls der Import nicht an der Bauwerks-Wurzel
   * startet: Bauwerksnummer (aus dem Bauwerk-Datensatz), Teilbauwerksnummer
   * und Projekt-Bezeichnung (Panel löst sie über die Vorfahren-Kette auf).
   * Beim Baum-Durchlauf passierte Teilbauwerk-Knoten haben Vorrang.
   */
  idPrefix?: { bauwerk?: string; teilbauwerk?: string; projekt?: string };
}

export interface PortalImportResult {
  document: NativeIfcDocument;
  createdIds: number[];
  /** Vorhandene Elemente (per ExternalId gefunden), fehlende Psets ergänzt. */
  updatedIds: number[];
  warnings: string[];
  /** z. B. "7 Elemente erstellt, 2 aktualisiert, 21 Psets". */
  summary: string;
}

/**
 * Argument-Positionen bei IfcProduct-Subtypen (siehe addNativeElement):
 * GlobalId(0), OwnerHistory(1), Name(2), Description(3), ObjectType(4).
 */
const GLOBAL_ID_ARG_INDEX = 0;
const OBJECT_TYPE_ARG_INDEX = 4;

const US_SICHERER_NAME_PATTERN = /^US\.[^.]+\.(\d+)\.(\d+)$/;

// --- ExternalId-Suche ---------------------------------------------------------

/** Entpackt "IFCLABEL('x')"-artige Property-Werte auf den inneren String. */
function unwrapPropertyValue(value: string): string {
  const match = value.trim().match(/^[A-Z0-9_]+\('([\s\S]*)'\)$/);
  return match ? match[1] : value.trim();
}

/** ExternalId aus dem Link-Pset eines Elements (null = nicht verknüpft). */
function readLinkExternalId(
  document: NativeIfcDocument,
  entityId: number,
): string | null {
  for (const set of document.propertySetsByEntity.get(entityId) ?? []) {
    if (set.name !== LINK_PSET_NAME) {
      continue;
    }
    const property = set.values.find((value) => value.name === "ExternalId");
    if (property) {
      return unwrapPropertyValue(property.value);
    }
  }
  return null;
}

/**
 * Scannt document.propertySetsByEntity nach dem Link-Pset Pset_MarxKrontalBWD
 * mit Property ExternalId == externalId. Liefert die erste Fundstelle.
 * Fallback ohne Link-Pset (Option "Link-Pset schreiben" deaktiviert):
 * createElementForNode stempelt immer die deterministische GlobalId — darüber
 * bleiben Re-Importe unabhängig von den Pset-Optionen idempotent.
 */
export function findEntityIdByExternalId(
  document: NativeIfcDocument,
  externalId: string,
): number | null {
  for (const [entityId, sets] of document.propertySetsByEntity) {
    for (const set of sets) {
      if (set.name !== LINK_PSET_NAME) {
        continue;
      }
      for (const value of set.values) {
        if (
          value.name === "ExternalId" &&
          unwrapPropertyValue(value.value) === externalId
        ) {
          return entityId;
        }
      }
    }
  }
  const guid = ifcGuidForExternalId(externalId);
  for (const entity of document.entities) {
    if (entity.globalId === guid) {
      return entity.id;
    }
  }
  return null;
}

// --- Interner Import-Zustand -----------------------------------------------------

interface ImportState {
  document: NativeIfcDocument;
  createdIds: number[];
  updatedIds: Set<number>;
  warnings: string[];
  psetCount: number;
  classificationCount: number;
  /** In diesem Lauf vergebene Mehrfach-Pset-Indizes pro Host+Präfix. */
  psetIndexByHost: Map<number, Map<string, Set<number>>>;
}

/** Kontext für die Katalog-ID-Ableitung während des Baum-Durchlaufs. */
interface WalkNumbers {
  parentUb?: PortalNode;
  parentBauteil?: PortalNode;
  ubNumber?: number;
  usNumber?: number;
  probeNumber?: number;
  /** Namen der passierten Bauwerk-/Teilbauwerk-Knoten (Dot-ID-Präfix). */
  bauwerkToken?: string;
  teilbauwerkToken?: string;
  projektToken?: string;
}

function createImportState(document: NativeIfcDocument): ImportState {
  return {
    classificationCount: 0,
    createdIds: [],
    document,
    psetCount: 0,
    psetIndexByHost: new Map(),
    updatedIds: new Set(),
    warnings: [],
  };
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function finishImport(state: ImportState): PortalImportResult {
  const created = state.createdIds.length;
  const updated = state.updatedIds.size;
  const classifications =
    state.classificationCount > 0
      ? `, ${countLabel(state.classificationCount, "Klassifikation", "Klassifikationen")}`
      : "";
  return {
    createdIds: state.createdIds,
    document: state.document,
    summary: `${countLabel(created, "Element erstellt", "Elemente erstellt")}, ${updated} aktualisiert, ${countLabel(state.psetCount, "Pset", "Psets")}${classifications}`,
    updatedIds: [...state.updatedIds],
    warnings: state.warnings,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// --- Pset-Schreiben ----------------------------------------------------------------

function hasPset(
  document: NativeIfcDocument,
  entityId: number,
  psetName: string,
): boolean {
  return (
    document.propertySetsByEntity
      .get(entityId)
      ?.some((set) => set.name === psetName) ?? false
  );
}

/**
 * Schreibt Psets via addNativePropertySetValues. addNativePropertySetValues
 * fügt immer ein NEUES Pset hinzu — deshalb wird bei onlyMissing (vorhandene
 * Elemente / Host-Psets) jedes Pset übersprungen, dessen Name bereits am
 * Element existiert (idempotente Re-Importe statt Duplikate).
 */
function writePsets(
  state: ImportState,
  entityId: number,
  psets: PortalCatalogPset[],
  onlyMissing: boolean,
) {
  for (const pset of psets) {
    if (pset.properties.length === 0) {
      continue;
    }
    if (onlyMissing && hasPset(state.document, entityId, pset.psetName)) {
      continue;
    }
    state.document = addNativePropertySetValues(
      state.document,
      entityId,
      pset.psetName,
      pset.properties,
    );
    state.psetCount += 1;
  }
}

/**
 * Leere Pset-Hüllen (Name ohne Properties) — Mapping-Option
 * writeProperties=false. Vorhandene Namen werden übersprungen (idempotent).
 */
function writeEmptyPsets(
  state: ImportState,
  entityId: number,
  psetNames: string[],
) {
  for (const psetName of psetNames) {
    if (!psetName || hasPset(state.document, entityId, psetName)) {
      continue;
    }
    state.document = addNativeEmptyPropertySet(
      state.document,
      entityId,
      psetName,
    );
    state.psetCount += 1;
  }
}

/** Entfernt vorhandene Psets der genannten Namen vom Element (Neuzuordnung). */
function removePsetsByName(
  state: ImportState,
  entityId: number,
  psetNames: Iterable<string>,
) {
  const names = new Set(psetNames);
  const sets = (state.document.propertySetsByEntity.get(entityId) ?? []).filter(
    (set) => names.has(set.name),
  );
  for (const set of sets) {
    state.document = removeNativePropertySet(state.document, entityId, set.id);
  }
}

/**
 * Record für das Rohdaten-Pset: bevorzugt den Verfahrens-Record aus dem
 * Kontext; sonst node.raw, wobei Kind-Arrays (FreeCAD-kompatibel) zu
 * `<name>Count` kollabiert werden statt den ganzen Teilbaum zu serialisieren.
 */
function recordForNode(
  node: PortalNode,
  context: PortalImportContext,
): Record<string, unknown> {
  const record = context.verfahrenRecords?.get(portalExternalId(node));
  if (record) {
    return record;
  }
  const collapsed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node.raw)) {
    if (Array.isArray(value)) {
      collapsed[`${key}Count`] = value.length;
    } else {
      collapsed[key] = value;
    }
  }
  return collapsed;
}

/**
 * Knoten für die Katalog-Psets um den vollen Verfahrens-Record anreichern:
 * der Hierarchie-Payload liefert für Verfahren nur {id, abgeschlossen, type,
 * titelBild}; datum/bemerkung stehen nur in den separat geladenen Records.
 * Hierarchie-Felder gewinnen bei Namenskonflikten.
 */
function nodeWithRecordData(
  node: PortalNode,
  context: PortalImportContext,
): PortalNode {
  const record = context.verfahrenRecords?.get(portalExternalId(node));
  if (!record) {
    return node;
  }
  return { ...node, raw: { ...record, ...node.raw } };
}

/**
 * Record-Pset eines Knotens; bei Mehrfach-Pset-Knoten wird der Host-Index
 * angehängt (Pset_MarxKrontalBWD_Kanal2), damit Geschwister am selben Host
 * sich nicht gegenseitig per Namenskollision verdrängen. Bei bare-first-
 * Knoten (Verfahren) bleibt die erste Instanz ohne Suffix.
 */
function recordPsetForNode(
  node: PortalNode,
  context: PortalImportContext,
  catalogContext: CatalogIdContext,
): PortalCatalogPset {
  const pset = buildRecordPset(
    modelNameForNode(node),
    recordForNode(node, context),
  );
  const spec = multiPsetSpecForNode(node);
  const index = catalogContext.psetIndex;
  if (spec && index !== undefined && !(spec.bareFirst && index === 1)) {
    pset.psetName = `${pset.psetName}${index}`;
  }
  return pset;
}

/** Link-, Katalog- und Record-Pset eines Knotens gemäß psetOptions. */
function collectNodePsets(
  node: PortalNode,
  context: PortalImportContext,
  catalogContext: CatalogIdContext,
): PortalCatalogPset[] {
  const psets: PortalCatalogPset[] = [];
  if (context.psetOptions.writeLinkPset) {
    psets.push({
      properties: buildLinkPsetProperties(node),
      psetName: LINK_PSET_NAME,
    });
  }
  if (context.psetOptions.writeCatalogPsets) {
    psets.push(
      ...buildCatalogPsetsForNode(
        nodeWithRecordData(node, context),
        catalogContext,
      ),
    );
  }
  if (context.psetOptions.writeRecordPsets) {
    psets.push(recordPsetForNode(node, context, catalogContext));
  }
  return psets;
}

// --- Mehrfach-Psets (ePset_Kanal<N>, ePset_Maßnahme<N>, ePset_Untersuchungsbereich<NN>,
// --- Verfahrens-Psets ePset_<Verfahren>[<N>]) -----------------------------------------

interface MultiPsetSpec {
  /** Pset-Namenspräfix, z. B. "ePset_Kanal" oder "ePset_Kernbohrung". */
  prefix: string;
  /** true = erste Instanz ohne Index-Suffix (Verfahrens-Psets im Beispiel-IFC). */
  bareFirst: boolean;
}

/** Mehrfach-Pset-Verhalten pro Knotentyp (null = kein Mehrfach-Pset-Knoten). */
function multiPsetSpecForNode(node: PortalNode): MultiPsetSpec | null {
  switch (node.nodeType) {
    case "kanal":
      return { bareFirst: false, prefix: "ePset_Kanal" };
    case "massnahme":
      return { bareFirst: false, prefix: "ePset_Maßnahme" };
    case "untersuchungsbereich":
      // Nur relevant, wenn der UB als Host-Pset abgebildet wird
      // (ePset_Untersuchungsbereich01 …, zweistellig nummeriert).
      return { bareFirst: false, prefix: "ePset_Untersuchungsbereich" };
    default: {
      const spec = verfahrenSpecForType(node.nodeType);
      return spec ? { bareFirst: true, prefix: spec.pset } : null;
    }
  }
}

/** Legacy-Identität über die _ID-Property (Kanal/Maßnahme-Psets älterer Stände). */
function multiPsetIdentity(node: PortalNode): string {
  if (node.nodeType === "kanal") {
    return (
      readString(node.raw.sicherer_name).trim() ||
      readString(node.raw.name).trim()
    );
  }
  if (node.nodeType === "massnahme") {
    return String(node.id);
  }
  return "";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Mehrfach-Pset-Index am Host: identitäts- statt positionsbasiert. Existiert
 * am Host bereits ein `<Präfix>[<N>]`-Pset mit derselben _ExternalId (bzw.
 * legacy _ID), wird dessen Index wiederverwendet — die Namenskollision
 * überspringt dann idempotent. Sonst wird hinter dem höchsten vorhandenen
 * bzw. in diesem Lauf vergebenen Index angehängt. So verdrängt eine geänderte
 * Portal-Reihenfolge nie die Daten eines anderen Objekts, und neue Objekte
 * werden ergänzt statt verworfen. Der suffixlose Name zählt als Index 1
 * (bare-first-Verfahrens-Psets).
 */
/** Wunsch-Index eines Knotens (UB.DB.02 -> ePset_Untersuchungsbereich02). */
function preferredMultiPsetIndex(node: PortalNode): number | null {
  if (node.nodeType === "untersuchungsbereich") {
    return ubNumberFromSichererName(node);
  }
  return null;
}

function resolveMultiPsetIndex(
  state: ImportState,
  hostId: number,
  node: PortalNode,
): number | undefined {
  const spec = multiPsetSpecForNode(node);
  if (!spec) {
    return undefined;
  }
  const pattern = new RegExp(`^${escapeRegExp(spec.prefix)}(\\d*)$`);
  const externalId = portalExternalId(node);
  const legacyIdentity = multiPsetIdentity(node);
  const usedIndexes = new Set<number>();
  let highest = 0;
  for (const set of state.document.propertySetsByEntity.get(hostId) ?? []) {
    const match = set.name.match(pattern);
    if (!match) {
      continue;
    }
    const index = match[1] === "" ? 1 : Number.parseInt(match[1], 10);
    usedIndexes.add(index);
    highest = Math.max(highest, index);
    const externalValue = set.values.find((value) => value.name === "_ExternalId");
    if (externalValue && unwrapPropertyValue(externalValue.value) === externalId) {
      return index;
    }
    const idValue = set.values.find((value) => value.name === "_ID");
    if (
      legacyIdentity &&
      idValue &&
      unwrapPropertyValue(idValue.value) === legacyIdentity
    ) {
      return index;
    }
  }
  let byPrefix = state.psetIndexByHost.get(hostId);
  if (!byPrefix) {
    byPrefix = new Map();
    state.psetIndexByHost.set(hostId, byPrefix);
  }
  let reserved = byPrefix.get(spec.prefix);
  if (!reserved) {
    reserved = new Set();
    byPrefix.set(spec.prefix, reserved);
  }
  // Wunsch-Index (z. B. UB-Nummer aus dem sichererName) verwenden, wenn er
  // weder im Dokument noch in diesem Lauf belegt ist.
  const preferred = preferredMultiPsetIndex(node);
  if (
    preferred !== null &&
    preferred > 0 &&
    !usedIndexes.has(preferred) &&
    !reserved.has(preferred)
  ) {
    reserved.add(preferred);
    return preferred;
  }
  let next = Math.max(highest, ...reserved, 0) + 1;
  while (usedIndexes.has(next) || reserved.has(next)) {
    next += 1;
  }
  reserved.add(next);
  return next;
}

/**
 * Reihenfolge-basierter Mehrfach-Pset-Index für leere Pset-Hüllen
 * (writeProperties=false): Hüllen tragen keine _ExternalId-Identität, deshalb
 * zählt jeder Lauf pro Host+Präfix ab 1 — vorhandene Namen überspringt
 * writeEmptyPsets, Re-Importe bleiben so idempotent (bei stabiler
 * Portal-Reihenfolge).
 */
function sequentialMultiPsetIndex(
  state: ImportState,
  hostId: number,
  node: PortalNode,
): number | undefined {
  const spec = multiPsetSpecForNode(node);
  if (!spec) {
    return undefined;
  }
  let byPrefix = state.psetIndexByHost.get(hostId);
  if (!byPrefix) {
    byPrefix = new Map();
    state.psetIndexByHost.set(hostId, byPrefix);
  }
  let reserved = byPrefix.get(spec.prefix);
  if (!reserved) {
    reserved = new Set();
    byPrefix.set(spec.prefix, reserved);
  }
  const next = Math.max(0, ...reserved) + 1;
  reserved.add(next);
  return next;
}

// --- Klassifikationsreferenzen (Beispiel-IFC: "openSIM BIM Objektkatalog") -------------

/** Entpackt einen STEP-String ('x') auf den inneren Wert. */
function unquoteStep(value: string): string {
  const match = value.trim().match(/^'([\s\S]*)'$/);
  return match ? match[1] : value.trim();
}

function hasClassificationReference(
  document: NativeIfcDocument,
  entityId: number,
  identification: string,
): boolean {
  for (const relationship of document.relationshipsByEntity.get(entityId) ?? []) {
    if (relationship.type !== "IFCRELASSOCIATESCLASSIFICATION") {
      continue;
    }
    for (const otherId of [
      ...relationship.sourceIds,
      ...relationship.targetIds,
    ]) {
      const entity = document.entityById.get(otherId);
      if (
        entity?.type === "IFCCLASSIFICATIONREFERENCE" &&
        unquoteStep(entity.args[1] ?? "") === identification
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Klassifikationsreferenz für ein Verfahren am Ziel-Element sicherstellen
 * (Beispiel-IFC: IFCCLASSIFICATIONREFERENCE('openSIM BIM Objektkatalog',
 * 'BWD - KB','BWD - KB Kernbohrung')). Idempotent per Identification-Code.
 */
function ensureVerfahrenClassification(
  state: ImportState,
  entityId: number,
  node: PortalNode,
) {
  const spec = verfahrenSpecForType(node.nodeType);
  if (!spec) {
    return;
  }
  const identification = `BWD - ${spec.abbr}`;
  if (hasClassificationReference(state.document, entityId, identification)) {
    return;
  }
  state.document = addNativeClassification(
    state.document,
    entityId,
    identification,
    `${identification} ${spec.model}`,
    CLASSIFICATION_SOURCE,
  );
  state.classificationCount += 1;
}

// --- Baum-Durchlauf ----------------------------------------------------------------

/** UB-/US-Nummern aus dem sichererName einer Untersuchungsstelle. */
function usNumbersFromName(node: PortalNode): Partial<WalkNumbers> {
  const match = node.sichererName?.match(US_SICHERER_NAME_PATTERN);
  if (!match) {
    return {};
  }
  return {
    ubNumber: Number.parseInt(match[1], 10),
    usNumber: Number.parseInt(match[2], 10),
  };
}

/**
 * Dot-ID-Präfix: Bauwerksnummer aus den Panel-Einstellungen (Vorrang, der
 * Payload liefert sie nicht), Teilbauwerksnummer aus dem Baum-Durchlauf,
 * Projekt-Bezeichnung mit "_"-Ersetzung (wie der Server-IFC-Export).
 */
function idPrefixFor(
  context: PortalImportContext,
  numbers: WalkNumbers,
): CatalogIdContext["idPrefix"] {
  const projekt = numbers.projektToken ?? context.idPrefix?.projekt;
  return {
    bauwerk: context.idPrefix?.bauwerk ?? numbers.bauwerkToken,
    projekt: projekt ? projektIdToken(projekt) : undefined,
    teilbauwerk: numbers.teilbauwerkToken ?? context.idPrefix?.teilbauwerk,
  };
}

function catalogContextForChild(
  state: ImportState,
  context: PortalImportContext,
  child: PortalNode,
  numbers: WalkNumbers,
  siblingNumber: number,
): CatalogIdContext {
  return {
    idPrefix: idPrefixFor(context, numbers),
    parentBauteil: numbers.parentBauteil,
    parentUb: numbers.parentUb,
    probeNumber:
      child.nodeType === "probe" ? siblingNumber : numbers.probeNumber,
    ubNumber:
      child.nodeType === "untersuchungsbereich"
        ? siblingNumber
        : numbers.ubNumber,
    usNumber:
      child.nodeType === "untersuchungsstelle"
        ? siblingNumber
        : numbers.usNumber,
    warnings: state.warnings,
  };
}

/** Projektname aus dem raw-Feld eines Bauwerk-Knotens ({projekt:{id,name}}). */
function projektNameFromRaw(node: PortalNode): string | undefined {
  const projekt = node.raw.projekt;
  if (typeof projekt === "object" && projekt !== null && !Array.isArray(projekt)) {
    const name = (projekt as Record<string, unknown>).name;
    if (typeof name === "string" && name.trim()) {
      return name;
    }
  }
  return undefined;
}

/** WalkNumbers für den Abstieg in die Kinder eines Knotens. */
function numbersForDescent(
  node: PortalNode,
  numbers: WalkNumbers,
  siblingNumber?: number,
): WalkNumbers {
  if (node.nodeType === "bauwerk") {
    return {
      ...numbers,
      bauwerkToken: node.name,
      projektToken: projektNameFromRaw(node) ?? numbers.projektToken,
    };
  }
  if (node.nodeType === "teilbauwerk") {
    // Teilbauwerksnummer (raw.number, vom Client angereichert) bevorzugt.
    const number =
      typeof node.raw.number === "number"
        ? String(node.raw.number)
        : readString(node.raw.number).trim();
    return { ...numbers, teilbauwerkToken: number || node.name };
  }
  if (node.nodeType === "bauteil") {
    return { ...numbers, parentBauteil: node };
  }
  if (node.nodeType === "untersuchungsbereich") {
    return { ...numbers, parentUb: node, ubNumber: siblingNumber };
  }
  if (node.nodeType === "untersuchungsstelle") {
    return { ...numbers, usNumber: siblingNumber, ...usNumbersFromName(node) };
  }
  if (node.nodeType === "probe") {
    return { ...numbers, probeNumber: siblingNumber };
  }
  return numbers;
}

/**
 * Erstellt ein Element für den Knoten und setzt danach per updateNativeEntity
 * die deterministische GlobalId (args[0]) und das ObjectType-Attribut
 * (args[4], siehe Kommentar an den Index-Konstanten).
 */
function createElementForNode(
  state: ImportState,
  hostId: number,
  node: PortalNode,
  mapping: PortalModelMapping,
): number | null {
  const externalId = portalExternalId(node);
  const newId = getNextNativeEntityId(state.document);
  const withElement = addNativeElement(
    state.document,
    hostId,
    mapping.ifcClass,
    node.name,
  );
  const created = withElement.entityById.get(newId);
  if (!created) {
    state.warnings.push(
      `Element für ${externalId} konnte nicht erstellt werden.`,
    );
    return null;
  }
  const args = [...created.args];
  args[GLOBAL_ID_ARG_INDEX] = quote(ifcGuidForExternalId(externalId));
  const objectType = mapping.objectType.trim();
  if (objectType) {
    args[OBJECT_TYPE_ARG_INDEX] = quote(objectType);
  }
  state.document = updateNativeEntity(withElement, newId, { args });
  return newId;
}

function importChild(
  state: ImportState,
  context: PortalImportContext,
  hostId: number,
  child: PortalNode,
  numbers: WalkNumbers,
  siblingNumber: number,
) {
  const model = modelNameForNode(child);
  const mapping = mappingForModel(context.mapping, model);
  const descent = numbersForDescent(child, numbers, siblingNumber);

  if (mapping.target === "ignore") {
    // Knoten SAMT Unterbaum bewusst nicht importieren
    // (z. B. Diagnostik "vor den Verfahren aufhören").
    return;
  }

  if (mapping.target === "skip") {
    // Nur Gliederung: Kinder direkt am selben Host weiterverarbeiten.
    walkChildren(state, context, hostId, child, descent);
    return;
  }

  const catalogContext = catalogContextForChild(
    state,
    context,
    child,
    numbers,
    siblingNumber,
  );

  if (mapping.target === "pset") {
    // Katalog-Psets landen am HOST-Element (z. B. Verfahren/Massnahme/Kanal).
    // Sie werden unabhängig von writeCatalogPsets geschrieben — das Ziel
    // "pset" IST der Import-Modus dieses Modells. Verfahren bekommen
    // zusätzlich die Klassifikationsreferenz am Host (Beispiel-IFC).
    catalogContext.asHostPset = true;
    if (mapping.writeProperties) {
      catalogContext.psetIndex = resolveMultiPsetIndex(state, hostId, child);
      const psets = buildCatalogPsetsForNode(
        nodeWithRecordData(child, context),
        catalogContext,
      );
      if (context.psetOptions.writeRecordPsets) {
        psets.push(recordPsetForNode(child, context, catalogContext));
      }
      writePsets(state, hostId, psets, true);
    } else {
      // Leere Pset-Hüllen (nur Namen) — Index reihenfolge-basiert.
      catalogContext.psetIndex = sequentialMultiPsetIndex(state, hostId, child);
      const shellNames = buildCatalogPsetsForNode(
        nodeWithRecordData(child, context),
        catalogContext,
      ).map((pset) => pset.psetName);
      writeEmptyPsets(state, hostId, shellNames);
    }
    ensureVerfahrenClassification(state, hostId, child);
    walkChildren(state, context, hostId, child, descent);
    return;
  }

  // target "element": Upsert per ExternalId.
  const externalId = portalExternalId(child);
  const existingId = findEntityIdByExternalId(state.document, externalId);
  const targetId =
    existingId ?? createElementForNode(state, hostId, child, mapping);
  if (targetId === null) {
    return;
  }
  if (existingId !== null) {
    state.updatedIds.add(existingId);
  } else {
    state.createdIds.push(targetId);
  }
  if (mapping.writeProperties) {
    writePsets(
      state,
      targetId,
      collectNodePsets(child, context, catalogContext),
      existingId !== null,
    );
  } else {
    // Link-Pset (Identität) bleibt der globalen Option überlassen; die
    // Katalog-Psets entstehen als leere Hüllen, Rohdaten-Psets entfallen.
    if (context.psetOptions.writeLinkPset) {
      writePsets(
        state,
        targetId,
        [
          {
            properties: buildLinkPsetProperties(child),
            psetName: LINK_PSET_NAME,
          },
        ],
        true,
      );
    }
    const shellNames = buildCatalogPsetsForNode(
      nodeWithRecordData(child, context),
      catalogContext,
    ).map((pset) => pset.psetName);
    writeEmptyPsets(state, targetId, shellNames);
  }
  ensureVerfahrenClassification(state, targetId, child);
  walkChildren(state, context, targetId, child, descent);
}

/** Kaputte Einzelknoten brechen den Import nicht ab (Warnung sammeln). */
function walkChildren(
  state: ImportState,
  context: PortalImportContext,
  hostId: number,
  node: PortalNode,
  numbers: WalkNumbers,
) {
  const siblingCounters = new Map<string, number>();
  for (const child of node.children) {
    const siblingNumber = (siblingCounters.get(child.nodeType) ?? 0) + 1;
    siblingCounters.set(child.nodeType, siblingNumber);
    try {
      importChild(state, context, hostId, child, numbers, siblingNumber);
    } catch (error) {
      state.warnings.push(
        `Import von ${portalExternalId(child)} fehlgeschlagen: ${errorMessage(error)}`,
      );
    }
  }
}

// --- Öffentliche Import-Funktionen ---------------------------------------------------

/**
 * Schreibt Link-Pset (+ Katalog-/Record-Pset gemäß Optionen) auf ein
 * EXISTIERENDES Element — die "dieses Element IST mein UB.test"-Aktion.
 * Bereits vorhandene Psets bleiben unverändert (idempotent). Ist das Element
 * bereits mit einem ANDEREN Portal-Knoten verknüpft, wird die Verknüpfung
 * ersetzt: Link-Pset und namensgleiche knotenbezogene Psets werden entfernt
 * und neu geschrieben (sonst wäre eine Fehlzuordnung nicht korrigierbar).
 */
export function assignPortalLink(
  document: NativeIfcDocument,
  entityId: number,
  node: PortalNode,
  context: PortalImportContext,
): PortalImportResult {
  const state = createImportState(document);
  if (!document.entityById.has(entityId)) {
    state.warnings.push(
      `Element #${entityId} wurde im Dokument nicht gefunden.`,
    );
    return finishImport(state);
  }
  const externalId = portalExternalId(node);
  const existingLink = readLinkExternalId(state.document, entityId);
  const catalogContext: CatalogIdContext = {
    idPrefix: idPrefixFor(context, numbersForDescent(node, {})),
    warnings: state.warnings,
  };
  catalogContext.psetIndex = resolveMultiPsetIndex(state, entityId, node);
  const psets = collectNodePsets(node, context, catalogContext);
  if (existingLink !== null && existingLink !== externalId) {
    removePsetsByName(state, entityId, [
      LINK_PSET_NAME,
      ...psets.map((pset) => pset.psetName),
    ]);
    writePsets(state, entityId, psets, false);
    state.warnings.push(
      `Element #${entityId} war mit ${existingLink} verknüpft – Verknüpfung durch ${externalId} ersetzt.`,
    );
  } else {
    writePsets(state, entityId, psets, true);
  }
  ensureVerfahrenClassification(state, entityId, node);
  state.updatedIds.add(entityId);
  return finishImport(state);
}

/**
 * Importiert die Kinder eines Portal-Knotens rekursiv unter hostEntityId.
 * Pro Kind entscheidet mappingForModel(modelNameForNode(kind)) über skip
 * (durchreichen), pset (Psets am Host) oder element (Upsert per ExternalId).
 */
export function importPortalChildren(
  document: NativeIfcDocument,
  hostEntityId: number,
  node: PortalNode,
  context: PortalImportContext,
): PortalImportResult {
  const state = createImportState(document);
  if (!document.entityById.has(hostEntityId)) {
    state.warnings.push(
      `Host-Element #${hostEntityId} wurde im Dokument nicht gefunden.`,
    );
    return finishImport(state);
  }
  walkChildren(
    state,
    context,
    hostEntityId,
    node,
    numbersForDescent(node, {}),
  );
  return finishImport(state);
}

/**
 * Kompletter Baum ab root unter hostEntityId (z. B. IfcBuilding oder IfcSite):
 * assignPortalLink(host, root) + importPortalChildren in einem Ergebnis.
 */
export function importPortalStructure(
  document: NativeIfcDocument,
  root: PortalNode,
  hostEntityId: number,
  context: PortalImportContext,
): PortalImportResult {
  const state = createImportState(document);
  if (!document.entityById.has(hostEntityId)) {
    state.warnings.push(
      `Host-Element #${hostEntityId} wurde im Dokument nicht gefunden.`,
    );
    return finishImport(state);
  }
  // Mehrere Wurzeln (Monitoring) teilen sich denselben Host; nur die erste
  // bekommt das Link-Pset. Das wird nicht still übersprungen, sondern gewarnt.
  const rootExternalId = portalExternalId(root);
  const existingLink = readLinkExternalId(state.document, hostEntityId);
  if (
    context.psetOptions.writeLinkPset &&
    existingLink !== null &&
    existingLink !== rootExternalId
  ) {
    state.warnings.push(
      `Host #${hostEntityId} ist bereits mit ${existingLink} verknüpft – Link-Pset für ${rootExternalId} übersprungen.`,
    );
  }
  const rootNumbers = numbersForDescent(root, {});
  const catalogContext: CatalogIdContext = {
    idPrefix: idPrefixFor(context, rootNumbers),
    warnings: state.warnings,
  };
  catalogContext.psetIndex = resolveMultiPsetIndex(state, hostEntityId, root);
  writePsets(
    state,
    hostEntityId,
    collectNodePsets(root, context, catalogContext),
    true,
  );
  ensureVerfahrenClassification(state, hostEntityId, root);
  state.updatedIds.add(hostEntityId);
  walkChildren(state, context, hostEntityId, root, rootNumbers);
  return finishImport(state);
}
