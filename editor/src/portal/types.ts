import { createProxyPresetMapping, type PortalMappingConfig } from "./mapping";

export type {
  PortalMappingConfig,
  PortalMappingTarget,
  PortalModelMapping,
} from "./mapping";

export interface PortalPsetOptions {
  /** Pset_MarxKrontalBWD (Link-Metadaten) schreiben. */
  writeLinkPset: boolean;
  /** ePset_* nach Objektkatalog schreiben. */
  writeCatalogPsets: boolean;
  /** Pset_MarxKrontalBWD_<Model> mit rohen DB-Feldern schreiben. */
  writeRecordPsets: boolean;
}

export interface PortalSettings {
  bwdBaseUrl: string;
  assetBaseUrl: string;
  monitoringBaseUrl: string;
  tokenUrl: string;
  clientId: string;
  bauwerkId: number | null;
  bauwerkName: string;
  /** Bauwerksnummer des gewählten Bauwerks (Dot-ID-Präfix, z. B. "5692002"). */
  bauwerkNummer: string;
  projektId: number | null;
  projektName: string;
  useMockData: boolean;
  mapping: PortalMappingConfig;
  psetOptions: PortalPsetOptions;
}

export interface PortalTokens {
  accessToken: string;
  refreshToken: string;
  obtainedAt: number;
}

export interface PortalBauwerk {
  id: number;
  bezeichnung: string;
  /** Bauwerksnummer (z. B. "5692002") — Basis der Dot-ID-Konvention. */
  bauwerksnummer?: string;
}

export interface PortalProjekt {
  id: number;
  bezeichnung: string;
  typ?: string;
}

/** Eine Property für addNativePropertySetValues (valueType default IFCLABEL). */
export interface PsetProp {
  name: string;
  value: string;
  valueType?: string;
}

/** Normalisierter Baum-Knoten (Diagnostik UND Monitoring). */
export interface PortalNode {
  /**
   * "bauwerk" | "teilbauwerk" | "bauteil" | "untersuchungsbereich"
   * | "untersuchungsstelle" | Verfahrens-Typ lowercase (z. B. "kernbohrung")
   * | "messkonzept" | "massnahme" | "messstelle" | "kanal"
   */
  nodeType: string;
  id: number;
  /** Anzeigename: sichererName bevorzugt, sonst name. */
  name: string;
  /** Originales name-Feld der API. */
  rawName?: string;
  sichererName?: string;
  bemerkung?: string;
  /**
   * Verfahren: "VorOrtUntersuchung" | "Laboruntersuchung";
   * Monitoring-Knoten: "Monitoring".
   */
  category?: string;
  /** Verfahren: abgeschlossen-Flag. */
  abgeschlossen?: boolean;
  children: PortalNode[];
  /** Ganzes API-Objekt (für Record-Psets). */
  raw: Record<string, unknown>;
}

/** FreeCAD-kompatible ExternalId: `${nodeType}:${id}`. */
export function portalExternalId(
  node: Pick<PortalNode, "nodeType" | "id">,
): string {
  return `${node.nodeType}:${node.id}`;
}

/**
 * API-Modellname eines Knotens: Typ kapitalisiert ("untersuchungsbereich" ->
 * "Untersuchungsbereich", "kernbohrung" -> "Kernbohrung"). Der Fallback auf
 * "Untersuchungsverfahren" für unbekannte Verfahren passiert erst im
 * Mapping-Lookup (mappingForModel), nicht hier.
 */
export function modelNameForNode(node: Pick<PortalNode, "nodeType">): string {
  const type = node.nodeType.trim();
  if (!type) {
    return "";
  }
  return `${type.charAt(0).toUpperCase()}${type.slice(1)}`;
}

// --- Defensive JSON-Helfer (auch von client.ts/mock.ts genutzt) -------------

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Liest Zahl, numerischen String oder verschachteltes {id}-Objekt. */
export function readForeignKey(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const record = asRecord(value);
  if (record && "id" in record) {
    return readForeignKey(record.id);
  }
  return null;
}

function readId(value: unknown): number {
  return readForeignKey(value) ?? 0;
}

// --- Diagnostik-Hierarchie ---------------------------------------------------

const STRUCTURE_LEVELS: Record<string, { childKey: string; childType: string }> = {
  bauteil: { childKey: "untersuchungsbereiche", childType: "untersuchungsbereich" },
  bauwerk: { childKey: "teilbauwerke", childType: "teilbauwerk" },
  teilbauwerk: { childKey: "bauteile", childType: "bauteil" },
  untersuchungsbereich: {
    childKey: "untersuchungsstellen",
    childType: "untersuchungsstelle",
  },
};

function createPortalNode(
  raw: Record<string, unknown>,
  fallbackType: string,
): PortalNode {
  const nodeType =
    (readString(raw.type).trim() || fallbackType).toLowerCase();
  const id = readId(raw.id);
  const rawName = readString(raw.name).trim();
  const sichererName =
    readString(raw.sichererName).trim() || readString(raw.sicherer_name).trim();
  const bemerkung = readString(raw.bemerkung).trim();
  return {
    abgeschlossen:
      typeof raw.abgeschlossen === "boolean" ? raw.abgeschlossen : undefined,
    bemerkung: bemerkung || undefined,
    children: [],
    id,
    name: sichererName || rawName || `${modelNameForNode({ nodeType })} ${id}`,
    nodeType,
    raw,
    rawName: rawName || undefined,
    sichererName: sichererName || undefined,
  };
}

function normalizeVerfahrenEntries(value: unknown): PortalNode[] {
  const categories = asRecord(value);
  if (!categories) {
    return [];
  }
  const nodes: PortalNode[] = [];
  for (const [category, methods] of Object.entries(categories)) {
    const methodsRecord = asRecord(methods);
    if (!methodsRecord) {
      continue;
    }
    for (const [method, entries] of Object.entries(methodsRecord)) {
      for (const entryValue of asArray(entries)) {
        const entry = asRecord(entryValue);
        if (!entry) {
          continue;
        }
        const node = createPortalNode(entry, method.toLowerCase());
        node.category = category;
        nodes.push(node);
      }
    }
  }
  return nodes;
}

function normalizeStructureNode(
  raw: Record<string, unknown>,
  levelType: string,
): PortalNode {
  const node = createPortalNode(raw, levelType);
  if (levelType === "untersuchungsstelle") {
    node.children = normalizeVerfahrenEntries(raw.untersuchungsverfahren);
    return node;
  }
  const level = STRUCTURE_LEVELS[levelType];
  if (level) {
    node.children = asArray(raw[level.childKey])
      .map(asRecord)
      .filter((child): child is Record<string, unknown> => child !== null)
      .map((child) => normalizeStructureNode(child, level.childType));
  }
  return node;
}

/**
 * Normalisiert den HierarchicalUBStructure-Payload (bauwerk -> teilbauwerke ->
 * bauteile -> untersuchungsbereiche -> untersuchungsstellen ->
 * untersuchungsverfahren-Dict Kategorie -> Methode -> Einträge) in einen
 * PortalNode-Baum. Fehlende Arrays gelten als leer, fehlende type-Felder
 * fallen auf den Ebenen-Typ bzw. Methoden-Namen zurück.
 */
export function normalizeHierarchyPayload(payload: unknown): PortalNode {
  const record = asRecord(payload) ?? {};
  return normalizeStructureNode(record, "bauwerk");
}

// --- Monitoring-Baum ---------------------------------------------------------

function createMonitoringNode(
  raw: Record<string, unknown>,
  nodeType: string,
): PortalNode {
  const id = readId(raw.id);
  const bezeichnung = readString(raw.bezeichnung).trim();
  let rawName = readString(raw.name).trim() || bezeichnung;
  let sichererName = readString(raw.sicherer_name).trim();
  if (nodeType === "messstelle") {
    sichererName = readString(raw.messstellenbezeichnung).trim();
    rawName = bezeichnung;
  }
  const bemerkung =
    readString(raw.bemerkung).trim() || readString(raw.kommentar).trim();
  return {
    bemerkung: bemerkung || undefined,
    category: "Monitoring",
    children: [],
    id,
    name: sichererName || rawName || `${modelNameForNode({ nodeType })} ${id}`,
    nodeType,
    raw,
    rawName: rawName || undefined,
    sichererName: sichererName || undefined,
  };
}

function toMonitoringNodes(value: unknown, nodeType: string): PortalNode[] {
  return asArray(value)
    .map(asRecord)
    .filter((record): record is Record<string, unknown> => record !== null)
    .map((record) => createMonitoringNode(record, nodeType));
}

/**
 * Hängt children per FK-Feld an ihre Eltern; Waisen landen als zusätzliche
 * Wurzeln in roots (nichts wird verworfen).
 */
function attachByForeignKey(
  children: PortalNode[],
  parents: PortalNode[],
  foreignKeyField: string,
  roots: PortalNode[],
) {
  const parentById = new Map(parents.map((parent) => [parent.id, parent]));
  for (const child of children) {
    const parentId = readForeignKey(child.raw[foreignKeyField]);
    const parent = parentId === null ? undefined : parentById.get(parentId);
    if (parent) {
      parent.children.push(child);
    } else {
      roots.push(child);
    }
  }
}

/**
 * Verknüpft die vier Monitoring-Listen über ihre FK-Felder (`messkonzept`,
 * `massnahme`, `messstelle`) zu einem Baum Messkonzept -> Massnahme ->
 * Messstelle -> Kanal. Messstelle.raw enthält die nested Objekte `status`,
 * `position`, `kabel`, `sensor` unverändert.
 */
export function normalizeMonitoringPayload(
  messkonzepte: unknown,
  massnahmen: unknown,
  messstellen: unknown,
  kanaele: unknown,
): PortalNode[] {
  const messkonzeptNodes = toMonitoringNodes(messkonzepte, "messkonzept");
  const massnahmeNodes = toMonitoringNodes(massnahmen, "massnahme");
  const messstelleNodes = toMonitoringNodes(messstellen, "messstelle");
  const kanalNodes = toMonitoringNodes(kanaele, "kanal");
  const roots: PortalNode[] = [...messkonzeptNodes];
  attachByForeignKey(massnahmeNodes, messkonzeptNodes, "messkonzept", roots);
  attachByForeignKey(messstelleNodes, massnahmeNodes, "massnahme", roots);
  attachByForeignKey(kanalNodes, messstelleNodes, "messstelle", roots);
  return roots;
}

// --- Default-Settings ---------------------------------------------------------

/** Dev-Proxy-Pfade (siehe vite.config.mts, server.proxy "/mkp/*"). */
export const PORTAL_DEV_DEFAULT_URLS = {
  assetBaseUrl: "/mkp/portal/api/assetverwaltung",
  bwdBaseUrl: "/mkp/portal/api/bwd",
  monitoringBaseUrl: "/mkp/portal/api/monitoring",
  tokenUrl: "/mkp/auth/realms/Assetverwaltung/protocol/openid-connect/token",
} as const;

export function createDefaultPortalSettings(): PortalSettings {
  return {
    assetBaseUrl: PORTAL_DEV_DEFAULT_URLS.assetBaseUrl,
    bauwerkId: null,
    bauwerkName: "",
    bauwerkNummer: "",
    bwdBaseUrl: PORTAL_DEV_DEFAULT_URLS.bwdBaseUrl,
    clientId: "frontend-dev",
    mapping: createProxyPresetMapping(),
    monitoringBaseUrl: PORTAL_DEV_DEFAULT_URLS.monitoringBaseUrl,
    projektId: null,
    projektName: "",
    psetOptions: {
      writeCatalogPsets: true,
      writeLinkPset: true,
      writeRecordPsets: false,
    },
    tokenUrl: PORTAL_DEV_DEFAULT_URLS.tokenUrl,
    useMockData: false,
  };
}
