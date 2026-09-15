export const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const UPDATE_STORAGE_KEY = "ifcnative:updates:v1";

export interface AvailableUpdate {
  version: string;
  notes: string;
}
export interface Patchnotes {
  version: string;
  title: string;
  publishedAt: string;
  changes: string[];
}
export interface Progress {
  downloaded: number;
  total: number | null;
}
export interface UpdateBackend {
  status(): Promise<{
    currentVersion: string;
    configured: boolean;
    desktop: boolean;
  }>;
  check(): Promise<AvailableUpdate | null>;
  download(version: string, progress: (value: Progress) => void): Promise<void>;
  install(version: string): Promise<void>;
  patchnotes(version: string): Promise<unknown>;
  patchnotesHistory?(): Promise<unknown>;
}

/** Error kinds reported by the desktop backend; texts stay in the UI layer so no URL/SAS can leak. */
export const CHECK_ERROR_MESSAGES = {
  offline:
    "Keine Verbindung zum Update-Dienst. Bitte Internetverbindung bzw. Proxy prüfen.",
  denied:
    "Der Update-Dienst hat den Zugriff abgelehnt. Die Update-Berechtigung dieser Version ist vermutlich abgelaufen – bitte die aktuelle Version manuell installieren.",
  missing: "Auf dem Update-Dienst liegt derzeit kein Update-Manifest.",
  invalid: "Die Antwort des Update-Dienstes ist ungültig.",
  unavailable:
    "Der Update-Dienst ist derzeit nicht erreichbar. Bitte später erneut versuchen.",
  busy: "Ein Update-Vorgang läuft bereits.",
  config: "Updates sind noch nicht eingerichtet.",
} as const;
export type CheckErrorKind = keyof typeof CHECK_ERROR_MESSAGES;
export function checkErrorMessage(error: unknown): string {
  const kind =
    typeof error === "object" && error !== null
      ? (error as { kind?: unknown }).kind
      : undefined;
  return typeof kind === "string" && kind in CHECK_ERROR_MESSAGES
    ? CHECK_ERROR_MESSAGES[kind as CheckErrorKind]
    : "Update-Suche fehlgeschlagen. Bitte die Verbindung prüfen und später erneut versuchen.";
}

export interface Preferences {
  automatic: boolean;
  snoozedUntil: number;
  lastCheckedAt: number | null;
}
export interface UpdateSnapshot extends Preferences {
  initialized: boolean;
  desktop: boolean;
  configured: boolean;
  currentVersion: string;
  phase:
    | "idle"
    | "checking"
    | "available"
    | "current"
    | "downloading"
    | "ready"
    | "installing"
    | "error";
  update: AvailableUpdate | null;
  progress: Progress | null;
  error: string | null;
  /** Failure of the last background check; shown as a hint, never as an error box. */
  lastCheckError: string | null;
  patchnotes: Patchnotes | null;
  patchnotesHistory: Patchnotes[];
  notesLoading: boolean;
  notesError: string | null;
  now: number;
}
type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

export function readPreferences(
  storage?: Storage,
  now = Date.now(),
): Preferences {
  const defaults: Preferences = {
    automatic: true,
    snoozedUntil: 0,
    lastCheckedAt: null,
  };
  try {
    const raw = JSON.parse(storage?.getItem(UPDATE_STORAGE_KEY) ?? "null");
    if (!raw || typeof raw !== "object") return defaults;
    return {
      automatic: typeof raw.automatic === "boolean" ? raw.automatic : true,
      snoozedUntil:
        typeof raw.snoozedUntil === "number" &&
        Number.isFinite(raw.snoozedUntil)
          ? Math.max(0, Math.min(raw.snoozedUntil, now + SNOOZE_MS))
          : 0,
      lastCheckedAt:
        typeof raw.lastCheckedAt === "number" &&
        Number.isFinite(raw.lastCheckedAt) &&
        raw.lastCheckedAt > 0 &&
        raw.lastCheckedAt <= now
          ? raw.lastCheckedAt
          : null,
    };
  } catch {
    return defaults;
  }
}

export function notificationVisible(s: UpdateSnapshot): boolean {
  return (
    s.automatic &&
    s.snoozedUntil <= s.now &&
    s.update !== null &&
    s.phase === "available"
  );
}

export function parsePatchnotes(raw: unknown, version: string): Patchnotes {
  if (!raw || typeof raw !== "object") throw new Error("Ungültige Patchnotes.");
  const value = raw as Record<string, unknown>;
  if (
    value.version !== version ||
    typeof value.title !== "string" ||
    value.title.length > 300 ||
    typeof value.publishedAt !== "string" ||
    !Number.isFinite(Date.parse(value.publishedAt)) ||
    !Array.isArray(value.changes) ||
    value.changes.length > 100 ||
    !value.changes.every(
      (item) => typeof item === "string" && item.length <= 4000,
    )
  ) {
    throw new Error("Ungültige Patchnotes.");
  }
  return value as unknown as Patchnotes;
}

export function parsePatchnotesHistory(raw: unknown): Patchnotes[] {
  const releases = (raw as { releases?: unknown } | null)?.releases;
  if (!Array.isArray(releases) || releases.length > 500) throw new Error("Ungültiger Patchnotes-Verlauf.");
  const versions = new Set<string>();
  return releases.map((release) => {
    if (!release || typeof release.version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(release.version)
      || versions.has(release.version)) throw new Error("Ungültige Patchnotes-Version.");
    versions.add(release.version);
    return parsePatchnotes(release, release.version);
  }).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)
    || b.version.localeCompare(a.version, undefined, { numeric: true }));
}

/** One controller per main window. UI mounts never duplicate checks/downloads. */
export class UpdateController {
  private listeners = new Set<() => void>();
  private snapshot: UpdateSnapshot;
  private busy = false;
  private lastAttempt = 0;
  private notesRequest = 0;
  private initializePromise: Promise<void> | null = null;
  private installGuard = () => true;
  private beforeInstall: () => void | Promise<void> = () => {};

  constructor(
    private backend: UpdateBackend,
    private storage?: Storage,
    private clock = () => Date.now(),
    currentVersion = "",
  ) {
    this.snapshot = {
      ...readPreferences(storage, clock()),
      initialized: false,
      desktop: false,
      configured: false,
      currentVersion,
      phase: "idle",
      update: null,
      progress: null,
      error: null,
      lastCheckError: null,
      patchnotes: null,
      patchnotesHistory: [],
      notesLoading: false,
      notesError: null,
      now: clock(),
    };
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private patch(value: Partial<UpdateSnapshot>) {
    this.snapshot = { ...this.snapshot, ...value, now: this.clock() };
    this.listeners.forEach((listener) => listener());
  }
  private persist() {
    const { automatic, snoozedUntil, lastCheckedAt } = this.snapshot;
    try {
      this.storage?.setItem(
        UPDATE_STORAGE_KEY,
        JSON.stringify({ automatic, snoozedUntil, lastCheckedAt }),
      );
    } catch {
      /* Preferences still apply for this session. */
    }
  }
  initialize() {
    return (this.initializePromise ??= this.backend
      .status()
      .then((status) => {
        this.patch({ ...status, initialized: true });
      })
      .catch(() => {
        this.patch({
          initialized: true,
          error: "Update-Einstellungen konnten nicht geladen werden.",
        });
      }));
  }
  setAutomatic = (automatic: boolean) => {
    this.patch({ automatic });
    this.persist();
  };
  snooze = () => {
    this.patch({ snoozedUntil: this.clock() + SNOOZE_MS });
    this.persist();
  };
  resumeNotifications = () => {
    this.patch({ snoozedUntil: 0 });
    this.persist();
  };
  setInstallGuard(guard: () => boolean) {
    this.installGuard = guard;
  }
  /** Runs after the final guard passes and before the installer exits the process. */
  setBeforeInstall(hook: () => void | Promise<void>) {
    this.beforeInstall = hook;
  }

  async tick() {
    // Refresh the notification at the snooze deadline, including after sleep.
    if (
      this.snapshot.snoozedUntil > this.snapshot.now &&
      this.snapshot.snoozedUntil <= this.clock()
    )
      this.patch({});
    if (
      this.snapshot.automatic &&
      this.clock() - this.lastAttempt >= CHECK_INTERVAL_MS
    )
      await this.check(false);
  }
  async check(manual = true) {
    await this.initialize();
    if (
      this.busy ||
      !this.snapshot.desktop ||
      !this.snapshot.configured ||
      this.snapshot.phase === "ready"
    )
      return;
    if (!manual && !this.snapshot.automatic) return;
    this.busy = true;
    this.lastAttempt = this.clock();
    const previousPhase = this.snapshot.phase;
    this.patch({ phase: "checking", error: null });
    try {
      const update = await this.backend.check();
      ++this.notesRequest;
      this.patch({
        update,
        phase: update ? "available" : "current",
        lastCheckedAt: this.clock(),
        lastCheckError: null,
        patchnotes: null,
        notesError: null,
        notesLoading: false,
      });
      this.persist();
    } catch (error) {
      const message = checkErrorMessage(error);
      if (manual)
        this.patch({ phase: "error", error: message, lastCheckError: null });
      // Background failures must not replace a known result or surface as an error box.
      else
        this.patch({
          phase:
            previousPhase === "checking" || previousPhase === "error"
              ? "idle"
              : previousPhase,
          lastCheckError: message,
        });
    } finally {
      this.busy = false;
    }
  }
  async loadPatchnotes() {
    const version =
      this.snapshot.update?.version ?? this.snapshot.currentVersion;
    if (!this.snapshot.configured || !this.snapshot.desktop || !version) return;
    if (
      (this.snapshot.patchnotes?.version === version && !this.snapshot.notesError) ||
      this.snapshot.notesLoading
    )
      return;
    const request = ++this.notesRequest;
    this.patch({ notesLoading: true, notesError: null });
    try {
      const [current, history] = await Promise.allSettled([
        this.backend.patchnotes(version).then((raw) => parsePatchnotes(raw, version)),
        this.backend.patchnotesHistory
          ? this.backend.patchnotesHistory().then(parsePatchnotesHistory)
          : Promise.resolve(this.snapshot.patchnotesHistory),
      ]);
      if (
        request === this.notesRequest &&
        version ===
          (this.snapshot.update?.version ?? this.snapshot.currentVersion)
      ) {
        const releases = history.status === "fulfilled" ? history.value : this.snapshot.patchnotesHistory;
        const notes = current.status === "fulfilled" ? current.value : releases.find((item) => item.version === version) ?? null;
        const merged = new Map(releases.map((item) => [item.version, item]));
        if (notes) merged.set(notes.version, notes);
        this.patch({
          patchnotes: notes,
          patchnotesHistory: parsePatchnotesHistory({ releases: [...merged.values()] }),
          notesError: !notes ? "Patchnotes sind momentan nicht verfügbar."
            : history.status === "rejected" ? "Der vollständige Verlauf ist momentan nicht verfügbar." : null,
        });
      }
    } catch {
      if (request === this.notesRequest)
        this.patch({ notesError: "Patchnotes sind momentan nicht verfügbar." });
    } finally {
      if (request === this.notesRequest) this.patch({ notesLoading: false });
    }
  }
  async install() {
    const update = this.snapshot.update;
    if (this.busy || !update || this.snapshot.phase === "installing") return;
    if (!this.installGuard()) {
      this.patch({
        error:
          "Bitte zuerst alle geänderten IFC-Dateien speichern. Danach kannst du das Update installieren.",
      });
      return;
    }
    this.busy = true;
    try {
      if (this.snapshot.phase !== "ready") {
        this.patch({ phase: "downloading", progress: null, error: null });
        await this.backend.download(update.version, (progress) =>
          this.patch({ progress }),
        );
        this.patch({ phase: "ready" });
      }
      // Documents can change while the installer downloads. Check again before exiting.
      if (!this.installGuard()) {
        this.patch({
          error:
            "Update ist heruntergeladen. Bitte zuerst alle geänderten IFC-Dateien speichern und die Installation erneut starten.",
        });
        return;
      }
      this.patch({ phase: "installing", error: null });
      // The installer ends the process without unload events; flush app state here.
      try {
        await this.beforeInstall();
      } catch {
        /* A failed flush must not block the update. */
      }
      // Recovery cleanup is asynchronous too: edits and file operations can
      // start while it is pending, including in a pop-out window.
      if (!this.installGuard()) {
        this.patch({
          phase: "ready",
          error:
            "Bitte zuerst alle geänderten IFC-Dateien speichern und laufende Lade- oder Speichervorgänge abschließen. Danach die Installation erneut starten.",
        });
        return;
      }
      await this.backend.install(update.version);
    } catch {
      this.patch({
        phase: "error",
        error:
          "Update konnte nicht installiert werden. Download oder Signaturprüfung fehlgeschlagen. Bitte erneut versuchen.",
      });
    } finally {
      this.busy = false;
    }
  }
}
