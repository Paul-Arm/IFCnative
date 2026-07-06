import {
  MOCK_BAUWERKE,
  MOCK_PROJEKTE,
  createMockHierarchy,
  createMockMonitoringTree,
  createMockVerfahrenRecords,
} from "./mock";
import {
  asRecord,
  normalizeHierarchyPayload,
  normalizeMonitoringPayload,
  readForeignKey,
  readString,
  type PortalBauwerk,
  type PortalNode,
  type PortalProjekt,
  type PortalSettings,
  type PortalTokens,
} from "./types";

const MAX_ERROR_DETAIL_LENGTH = 300;

export class PortalApiError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(message: string, status: number, detail = "") {
    super(message);
    this.name = "PortalApiError";
    this.status = status;
    this.detail = detail;
  }
}

export type PortalTokensListener = (tokens: PortalTokens | null) => void;

function joinUrl(base: string, path: string): string {
  const trimmedBase = base.replace(/\/+$/, "");
  const trimmedPath = path.startsWith("/") ? path : `/${path}`;
  return `${trimmedBase}${trimmedPath}`;
}

function parseJsonSafe(text: string): unknown {
  if (!text.trim()) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readErrorDetail(bodyText: string): string {
  const parsed = asRecord(parseJsonSafe(bodyText));
  const detail =
    readString(parsed?.detail) || readString(parsed?.error) || bodyText;
  return detail.trim().slice(0, MAX_ERROR_DETAIL_LENGTH);
}

function shouldAttemptRefresh(status: number, bodyText: string): boolean {
  if (status === 401) {
    return true;
  }
  return status === 403 && /expired|invalid token/i.test(bodyText);
}

function normalizeList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  const record = asRecord(payload);
  for (const key of ["results", "data", "items"]) {
    const value = record?.[key];
    if (Array.isArray(value)) {
      return value;
    }
  }
  return [];
}

function toBauwerk(value: unknown): PortalBauwerk | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const id = readForeignKey(record.id) ?? readForeignKey(record.pk);
  if (id === null) {
    return null;
  }
  const bezeichnung =
    readString(record.bezeichnung).trim() ||
    readString(record.name).trim() ||
    `Bauwerk ${id}`;
  const bauwerksnummer = readString(record.bauwerksnummer).trim();
  return { bauwerksnummer: bauwerksnummer || undefined, bezeichnung, id };
}

function toProjekt(value: unknown): PortalProjekt | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const id = readForeignKey(record.id) ?? readForeignKey(record.pk);
  if (id === null) {
    return null;
  }
  const bezeichnung =
    readString(record.bezeichnung).trim() ||
    readString(record.name).trim() ||
    `Projekt ${id}`;
  const typ = readString(record.typ).trim();
  return { bezeichnung, id, typ: typ || undefined };
}

/**
 * fetch-basierter Client für das MKP-Portal (Keycloak password grant, BWD-,
 * Assetverwaltung- und Monitoring-API). Bei useMockData liefern alle
 * fetch*-Methoden die Mock-Daten aus mock.ts (kein Netz, kein Token nötig).
 */
export class PortalApiClient {
  private readonly settings: PortalSettings;
  private tokens: PortalTokens | null;
  private readonly onTokensChanged?: PortalTokensListener;
  private refreshPromise: Promise<boolean> | null = null;

  constructor(
    settings: PortalSettings,
    tokens: PortalTokens | null,
    onTokensChanged?: PortalTokensListener,
  ) {
    this.settings = settings;
    this.tokens = tokens;
    this.onTokensChanged = onTokensChanged;
  }

  async login(username: string, password: string): Promise<PortalTokens> {
    if (this.settings.useMockData) {
      const tokens: PortalTokens = {
        accessToken: "mock-access-token",
        obtainedAt: Date.now(),
        refreshToken: "mock-refresh-token",
      };
      this.tokens = tokens;
      this.onTokensChanged?.(tokens);
      return tokens;
    }
    return this.requestTokens({
      client_id: this.settings.clientId,
      grant_type: "password",
      password,
      scope: "openid email profile",
      username,
    });
  }

  async fetchBauwerke(): Promise<PortalBauwerk[]> {
    if (this.settings.useMockData) {
      return MOCK_BAUWERKE.map((bauwerk) => ({ ...bauwerk }));
    }
    const payload = await this.requestJson(
      joinUrl(this.settings.assetBaseUrl, "/bauwerk/"),
    );
    return normalizeList(payload)
      .map(toBauwerk)
      .filter((bauwerk): bauwerk is PortalBauwerk => bauwerk !== null);
  }

  async fetchProjekte(bauwerkId: number): Promise<PortalProjekt[]> {
    if (this.settings.useMockData) {
      return MOCK_PROJEKTE.map((projekt) => ({ ...projekt }));
    }
    const payload = await this.requestJson(
      joinUrl(this.settings.bwdBaseUrl, `/ProjektByBauwerk/${bauwerkId}/`),
    );
    return normalizeList(payload)
      .map(toProjekt)
      .filter((projekt): projekt is PortalProjekt => projekt !== null);
  }

  async fetchHierarchy(
    bauwerkId: number,
    projektId: number,
  ): Promise<PortalNode> {
    if (this.settings.useMockData) {
      return createMockHierarchy();
    }
    const payload = await this.requestJson(
      joinUrl(
        this.settings.bwdBaseUrl,
        `/HierarchicalUBStructure/?projekt_id=${projektId}&bauwerk_id=${bauwerkId}&format=json&use_cache=false`,
      ),
    );
    const root = normalizeHierarchyPayload(payload);
    await this.enrichTeilbauwerkNumbers(root, bauwerkId, projektId);
    return root;
  }

  /**
   * Der Hierarchie-Payload liefert für Teilbauwerke nur {id, name} — die
   * Teilbauwerksnummer (Dot-ID-Konvention "Bauwerksnr.Teilbauwerksnr.…")
   * steht im number-Feld des Teilbauwerk-Endpoints. Fehler werden toleriert;
   * die Dot-IDs fallen dann auf die Teilbauwerk-Namen zurück.
   */
  private async enrichTeilbauwerkNumbers(
    root: PortalNode,
    bauwerkId: number,
    projektId: number,
  ): Promise<void> {
    try {
      const payload = await this.requestJson(
        joinUrl(
          this.settings.bwdBaseUrl,
          `/Teilbauwerk/?bauwerk_id=${bauwerkId}&projekt_id=${projektId}`,
        ),
      );
      const numberById = new Map<number, string>();
      for (const entry of normalizeList(payload)) {
        const record = asRecord(entry);
        if (!record) {
          continue;
        }
        const id = readForeignKey(record.id) ?? readForeignKey(record.pk);
        const number =
          typeof record.number === "number"
            ? String(record.number)
            : readString(record.number).trim();
        if (id !== null && number) {
          numberById.set(id, number);
        }
      }
      for (const child of root.children) {
        if (child.nodeType !== "teilbauwerk") {
          continue;
        }
        const number = numberById.get(child.id);
        if (number !== undefined && child.raw.number === undefined) {
          child.raw = { ...child.raw, number };
        }
      }
    } catch {
      // Tolerant: ohne Nummern greifen die Namens-Fallbacks der Dot-IDs.
    }
  }

  async fetchMonitoringTree(bauwerkId: number): Promise<PortalNode[]> {
    if (this.settings.useMockData) {
      return createMockMonitoringTree();
    }
    const base = this.settings.monitoringBaseUrl;
    const query = `?bauwerk_id=${bauwerkId}`;
    const [messkonzepte, massnahmen, messstellen, kanaele] = await Promise.all([
      this.requestJson(joinUrl(base, `/messkonzepte/${query}`)),
      this.requestJson(joinUrl(base, `/massnahmen/${query}`)),
      this.requestJson(joinUrl(base, `/messstellen/${query}`)),
      this.requestJson(joinUrl(base, `/kanaele/${query}`)),
    ]);
    return normalizeMonitoringPayload(
      normalizeList(messkonzepte),
      normalizeList(massnahmen),
      normalizeList(messstellen),
      normalizeList(kanaele),
    );
  }

  /**
   * Alle Verfahrens-Records eines Projekts als Map ExternalId -> Record.
   * Antwortform: { Kategorie: { methodname: [records] } }; ExternalId =
   * `${methodname}:${record.id}` (methodname lowercase, wie im Hierarchie-Baum).
   */
  async fetchVerfahrenRecords(
    bauwerkId: number,
    projektId: number,
  ): Promise<Map<string, Record<string, unknown>>> {
    if (this.settings.useMockData) {
      return createMockVerfahrenRecords();
    }
    const payload = await this.requestJson(
      joinUrl(
        this.settings.bwdBaseUrl,
        `/Untersuchungsverfahren/?projekt=${projektId}&bauwerk=${bauwerkId}&art=all`,
      ),
    );
    const records = new Map<string, Record<string, unknown>>();
    const categories = asRecord(payload) ?? {};
    for (const methods of Object.values(categories)) {
      const methodsRecord = asRecord(methods);
      if (!methodsRecord) {
        continue;
      }
      for (const [methodName, entries] of Object.entries(methodsRecord)) {
        if (!Array.isArray(entries)) {
          continue;
        }
        for (const entryValue of entries) {
          const record = asRecord(entryValue);
          if (!record) {
            continue;
          }
          const id = readForeignKey(record.id);
          if (id === null) {
            continue;
          }
          records.set(`${methodName.toLowerCase()}:${id}`, record);
        }
      }
    }
    return records;
  }

  private async requestTokens(
    form: Record<string, string>,
  ): Promise<PortalTokens> {
    const response = await fetch(this.settings.tokenUrl, {
      body: new URLSearchParams(form).toString(),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      method: "POST",
    });
    const text = await response.text();
    if (!response.ok) {
      throw new PortalApiError(
        `Anmeldung fehlgeschlagen (HTTP ${response.status}).`,
        response.status,
        readErrorDetail(text),
      );
    }
    const record = asRecord(parseJsonSafe(text));
    const accessToken = readString(record?.access_token);
    const refreshToken = readString(record?.refresh_token);
    if (!accessToken) {
      throw new PortalApiError(
        "Token-Antwort enthält kein access_token.",
        response.status,
      );
    }
    const tokens: PortalTokens = {
      accessToken,
      obtainedAt: Date.now(),
      refreshToken,
    };
    this.tokens = tokens;
    this.onTokensChanged?.(tokens);
    return tokens;
  }

  /** Refresh-Grant, single-flight bei parallelen Requests. */
  private refreshOnce(): Promise<boolean> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.refreshTokens().finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  private async refreshTokens(): Promise<boolean> {
    const refreshToken = this.tokens?.refreshToken;
    if (!refreshToken) {
      return false;
    }
    try {
      await this.requestTokens({
        client_id: this.settings.clientId,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      });
      return true;
    } catch {
      return false;
    }
  }

  private fetchWithAuth(url: string): Promise<Response> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.tokens?.accessToken) {
      headers.Authorization = `Bearer ${this.tokens.accessToken}`;
    }
    return fetch(url, { headers });
  }

  private async requestJson(url: string): Promise<unknown> {
    let response = await this.fetchWithAuth(url);
    let text = await response.text();
    if (!response.ok && shouldAttemptRefresh(response.status, text)) {
      const refreshed = await this.refreshOnce();
      if (refreshed) {
        response = await this.fetchWithAuth(url);
        text = await response.text();
      }
    }
    if (!response.ok) {
      throw new PortalApiError(
        `Portal-Anfrage fehlgeschlagen (HTTP ${response.status}).`,
        response.status,
        readErrorDetail(text),
      );
    }
    return parseJsonSafe(text);
  }
}
