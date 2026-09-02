import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { IdsValidationSummary } from "../ifc";
import type { ObjectStore } from "../storage/objectStore";
import type {
  Action,
  ActionRun,
  ActionRunStatus,
  Commit,
  Repository,
} from "../repository/types";
import { IfcWorkerPool, defaultIfcWorkerPool } from "./ifcWorkerPool";

export interface ActionRunnerOptions {
  /** Python-Interpreter für "python"-Actions (Standard: PYTHON_BIN bzw. python/python3). */
  pythonBin?: string;
  /** Zeitlimit je Skriptlauf in Millisekunden (Standard: 5 Minuten). */
  timeoutMs?: number;
  /** Worker-Pool für IDS-Validierung (Standard: prozessweiter Pool). */
  workers?: IfcWorkerPool;
}

const LOG_LIMIT = 200_000;
const FAILURE_LOG_LIMIT = 200;
const GUID_LIMIT = 500;

export type RunEvent =
  | { type: "status"; run: ActionRun }
  | { type: "log"; runId: string; chunk: string };

const LOG_FLUSH_MS = 1000;
const TERMINAL: ReadonlySet<ActionRunStatus> = new Set([
  "success",
  "failed",
  "error",
  "cancelled",
]);

export function isTerminalRunStatus(status: ActionRunStatus): boolean {
  return TERMINAL.has(status);
}

function appendLog(log: string, line: string): string {
  return log ? `${log.replace(/\s+$/, "")}\n${line}` : line;
}

function clampLog(log: string): string {
  return log.length > LOG_LIMIT ? `${log.slice(0, LOG_LIMIT)}\n… (gekürzt)` : log;
}

/**
 * Führt Action-Runs sequenziell im Serverprozess aus (eine kleine In-Process-
 * Queue statt externer Worker — passt zum Ein-Prozess-Deployment des Hubs).
 *
 * - "ids": IDS-Validierung über den geteilten Editor-Validator, komplett in
 *   TypeScript — läuft im IfcWorkerPool, damit das Parsen großer Modelle den
 *   Server nicht anhält.
 * - "python": das hinterlegte Skript läuft als Kindprozess und bekommt den
 *   IFC-Pfad als Argument 1 sowie als Umgebungsvariable IFC_PATH.
 *   Exit-Code 0 = bestanden, alles andere = fehlgeschlagen.
 *
 * Zuverlässigkeit: Die Datenbank ist die Wahrheit über den Run-Zustand.
 * `recover()` (beim Serverstart) schließt Läufe ab, die ein Neustart mitten
 * in der Ausführung erwischt hat, und reiht wartende erneut ein — sonst
 * bliebe ein Run für immer auf "running". `cancel()` bricht wartende und
 * laufende Runs ab (Python: Kindprozess wird beendet). Während ein Skript
 * läuft, wandert seine Ausgabe sekündlich in die DB und sofort als
 * `run`-Event an Abonnenten (SSE-Route → Live-Log in der UI).
 */
export class ActionRunner extends EventEmitter {
  private readonly queue: string[] = [];
  private active = false;
  private activeRunId: string | null = null;
  private activeChild: ChildProcess | null = null;
  private readonly cancelRequested = new Set<string>();
  /** Bisherige Ausgabe des laufenden Runs (noch nicht komplett in der DB). */
  private liveLog: { runId: string; text: string } | null = null;
  private readonly pythonBin: string;
  private readonly timeoutMs: number;
  private readonly workers: IfcWorkerPool;

  constructor(
    private readonly repo: Repository,
    private readonly store: ObjectStore,
    options: ActionRunnerOptions = {},
  ) {
    super();
    this.pythonBin =
      options.pythonBin ??
      process.env.PYTHON_BIN ??
      (process.platform === "win32" ? "python" : "python3");
    this.timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;
    this.workers = options.workers ?? defaultIfcWorkerPool();
  }

  /** Run einreihen; die Verarbeitung läuft asynchron im Hintergrund. */
  enqueue(runId: string): void {
    this.queue.push(runId);
    if (!this.active) {
      this.active = true;
      void this.drain();
    }
  }

  /** Für Tests: wartet, bis alle eingereihten Runs abgearbeitet sind. */
  async idle(): Promise<void> {
    while (this.active) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  /**
   * Beim Serverstart: Runs, die der letzte Prozess nicht zu Ende gebracht
   * hat. "running" kann nicht fortgesetzt werden (Kindprozess/Worker sind
   * weg) → als Fehler abschließen; "queued" hat nie begonnen → neu einreihen.
   */
  async recover(): Promise<{ interrupted: number; requeued: number }> {
    let interrupted = 0;
    let requeued = 0;
    for (const run of await this.repo.listUnfinishedActionRuns()) {
      if (run.id === this.activeRunId || this.queue.includes(run.id)) {
        continue;
      }
      if (run.status === "running") {
        await this.finish(
          run,
          "error",
          "Vom Server-Neustart unterbrochen — Lauf nicht abgeschlossen.",
          appendLog(
            run.log,
            "… Der Server wurde neu gestartet, bevor dieser Lauf fertig war. Mit „Erneut ausführen“ neu starten.",
          ),
        );
        interrupted += 1;
      } else {
        this.enqueue(run.id);
        requeued += 1;
      }
    }
    return { interrupted, requeued };
  }

  /**
   * Abbrechen. Wartend: sofort abgeschlossen. Laufend: Kindprozess wird
   * beendet bzw. das Worker-Ergebnis verworfen; der Status wechselt auf
   * "cancelled", sobald der Lauf tatsächlich endet.
   */
  async cancel(runId: string): Promise<ActionRun | null> {
    const run = await this.repo.getActionRun(runId);
    if (!run) {
      return null;
    }
    if (run.status === "queued") {
      const index = this.queue.indexOf(runId);
      if (index >= 0) {
        this.queue.splice(index, 1);
      }
      this.cancelRequested.add(runId);
      return this.finish(run, "cancelled", "Abgebrochen, bevor der Lauf gestartet wurde.", run.log);
    }
    if (run.status === "running") {
      this.cancelRequested.add(runId);
      if (this.activeRunId === runId) {
        this.activeChild?.kill();
      }
      return run;
    }
    return run;
  }

  /**
   * Ausgabe des gerade laufenden Runs, Stand jetzt — genauer als die DB,
   * die nur sekündlich nachgeführt wird (für den Erst-Snapshot des Streams).
   */
  getLiveLog(runId: string): string | undefined {
    return this.liveLog?.runId === runId ? this.liveLog.text : undefined;
  }

  private emitStatus(run: ActionRun): void {
    this.emit("run", { type: "status", run } satisfies RunEvent);
  }

  private emitLog(runId: string, chunk: string): void {
    this.emit("run", { type: "log", runId, chunk } satisfies RunEvent);
  }

  private async drain(): Promise<void> {
    try {
      for (let runId = this.queue.shift(); runId; runId = this.queue.shift()) {
        await this.process(runId).catch(() => undefined);
      }
    } finally {
      this.active = false;
      // Zwischen leerem Queue-Check und active=false kann ein neuer Run
      // eingereiht worden sein — dann direkt weitermachen.
      if (this.queue.length) {
        this.active = true;
        void this.drain();
      }
    }
  }

  private async process(runId: string): Promise<void> {
    const run = await this.repo.getActionRun(runId);
    if (!run || run.status !== "queued") {
      // Gelöscht oder inzwischen abgebrochen.
      this.cancelRequested.delete(runId);
      return;
    }
    const action = await this.repo.getAction(run.actionId);
    const commit = await this.repo.getCommit(run.commitId);
    if (!action || !commit) {
      await this.finish(run, "error", "Action oder Commit nicht mehr vorhanden.", "");
      return;
    }
    this.activeRunId = run.id;
    const started =
      (await this.repo.updateActionRun(run.id, {
        status: "running",
        startedAt: new Date().toISOString(),
      })) ?? run;
    this.emitStatus(started);
    try {
      if (action.kind === "ids") {
        await this.runIds(started, action, commit);
      } else {
        await this.runPython(started, action, commit);
      }
    } catch (error) {
      await this.finish(
        started,
        "error",
        "Ausführung fehlgeschlagen.",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      this.activeRunId = null;
      this.activeChild = null;
    }
  }

  private async finish(
    run: ActionRun,
    status: "success" | "failed" | "error" | "cancelled",
    summary: string,
    log: string,
    failedGuids: string[] = [],
  ): Promise<ActionRun> {
    let finalStatus: ActionRunStatus = status;
    let finalSummary = summary;
    if (this.cancelRequested.delete(run.id) && status !== "cancelled") {
      finalStatus = "cancelled";
      finalSummary = "Vom Benutzer abgebrochen.";
    }
    const updated =
      (await this.repo.updateActionRun(run.id, {
        status: finalStatus,
        summary: finalSummary,
        log: clampLog(log),
        failedGuids: [...new Set(failedGuids)].slice(0, GUID_LIMIT),
        finishedAt: new Date().toISOString(),
      })) ?? { ...run, status: finalStatus, summary: finalSummary, log: clampLog(log) };
    this.emitStatus(updated);
    return updated;
  }

  // ---- IDS -------------------------------------------------------------

  private async runIds(
    run: ActionRun,
    action: Action,
    commit: Commit,
  ): Promise<void> {
    this.emitLog(run.id, "Lade IDS-Datei und IFC-Stand …\n");
    const [idsBuffer, ifcBuffer] = await Promise.all([
      this.store.get(action.fileKey),
      this.store.get(commit.blobKey),
    ]);
    this.emitLog(
      run.id,
      `Validiere ${action.fileName} gegen ${Math.round(ifcBuffer.length / 1e6)} MB IFC (Worker) …\n`,
    );
    const { summary, idsWarnings, failedGuids } = await this.workers.validateIds(
      idsBuffer.toString("utf8"),
      action.fileName,
      new Uint8Array(ifcBuffer),
    );
    const passed = summary.failCount === 0;
    await this.finish(
      run,
      passed ? "success" : "failed",
      `${summary.passCount} bestanden, ${summary.failCount} fehlgeschlagen, ` +
        `${summary.notApplicableCount} nicht anwendbar — ` +
        `${summary.totalFailures} Verstöße bei ${summary.totalChecked} geprüften Objekten.`,
      renderIdsReport(idsWarnings, summary),
      failedGuids,
    );
  }

  // ---- Python ----------------------------------------------------------

  private async runPython(
    run: ActionRun,
    action: Action,
    commit: Commit,
  ): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), "ifc-hub-action-"));
    try {
      const scriptPath = join(dir, action.fileName || "check.py");
      const ifcPath = join(dir, "model.ifc");
      const [script, ifc] = await Promise.all([
        this.store.get(action.fileKey),
        this.store.get(commit.blobKey),
      ]);
      await Promise.all([
        writeFile(scriptPath, script),
        writeFile(ifcPath, ifc),
      ]);

      // Live-Protokoll: Ausgabe sofort an Abonnenten, sekündlich in die DB,
      // damit auch Polling-Clients den Fortschritt sehen.
      const live = { runId: run.id, text: "" };
      this.liveLog = live;
      let flushTimer: ReturnType<typeof setTimeout> | undefined;
      const flush = () => {
        flushTimer = undefined;
        void this.repo
          .updateActionRun(run.id, { log: clampLog(live.text) })
          .catch(() => undefined);
      };
      const onOutput = (text: string) => {
        if (live.text.length < LOG_LIMIT) {
          live.text += text;
        }
        this.emitLog(run.id, text);
        if (!flushTimer) {
          flushTimer = setTimeout(flush, LOG_FLUSH_MS);
        }
      };

      const result = await this.spawnScript(run.id, scriptPath, ifcPath, dir, onOutput);
      if (flushTimer) {
        clearTimeout(flushTimer);
      }
      this.liveLog = null;
      const log = [
        result.stdout.trim(),
        result.stderr.trim() ? `--- stderr ---\n${result.stderr.trim()}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      if (result.timedOut) {
        await this.finish(
          run,
          "error",
          `Zeitlimit überschritten (${Math.round(this.timeoutMs / 1000)} s).`,
          log,
        );
      } else if (result.spawnError) {
        await this.finish(
          run,
          "error",
          `Python-Interpreter "${this.pythonBin}" konnte nicht gestartet werden.`,
          result.spawnError,
        );
      } else {
        const firstLine = result.stdout.trim().split(/\r?\n/).find(Boolean);
        // Konvention: Zeilen "GUID: <GlobalId>" auf stdout markieren die
        // beanstandeten Objekte (für Issues + 3D-Verortung).
        const failedGuids = [...result.stdout.matchAll(/^GUID:\s*(\S+)\s*$/gim)]
          .map((match) => match[1])
          .filter((guid): guid is string => Boolean(guid));
        await this.finish(
          run,
          result.exitCode === 0 ? "success" : "failed",
          result.exitCode === 0
            ? firstLine ?? "Skript erfolgreich (Exit-Code 0)."
            : `Skript meldet Exit-Code ${result.exitCode}.${firstLine ? ` ${firstLine}` : ""}`,
          log,
          failedGuids,
        );
      }
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private spawnScript(
    runId: string,
    scriptPath: string,
    ifcPath: string,
    cwd: string,
    onOutput: (text: string) => void,
  ): Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    spawnError?: string;
  }> {
    return new Promise((resolve) => {
      const child = spawn(this.pythonBin, [scriptPath, ifcPath], {
        cwd,
        env: { ...process.env, IFC_PATH: ifcPath, PYTHONUNBUFFERED: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.activeChild = child;
      // Abbruch kam, bevor der Prozess stand (Dateien wurden noch geschrieben).
      if (this.cancelRequested.has(runId)) {
        child.kill();
      }
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, this.timeoutMs);
      child.stdout.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        if (stdout.length < LOG_LIMIT) stdout += text;
        onOutput(text);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        if (stderr.length < LOG_LIMIT) stderr += text;
        onOutput(text);
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        resolve({
          exitCode: null,
          stdout,
          stderr,
          timedOut,
          spawnError: error.message,
        });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ exitCode: code, stdout, stderr, timedOut });
      });
    });
  }
}

/** Menschenlesbarer IDS-Bericht fürs Run-Protokoll. */
function renderIdsReport(
  warnings: string[],
  summary: IdsValidationSummary,
): string {
  const lines: string[] = [];
  for (const warning of warnings) {
    lines.push(`Hinweis: ${warning}`);
  }
  for (const result of summary.results) {
    const status =
      result.status === "pass"
        ? "BESTANDEN"
        : result.status === "fail"
          ? "FEHLGESCHLAGEN"
          : "NICHT ANWENDBAR";
    lines.push("");
    lines.push(
      `[${status}] ${result.specification.name} — ` +
        `${result.passedCount}/${result.applicableCount} Objekte ok`,
    );
    for (const message of result.messages) {
      lines.push(`  ${message}`);
    }
    for (const failure of result.failures.slice(0, FAILURE_LOG_LIMIT)) {
      lines.push(
        `  ✗ ${failure.entityType} „${failure.entityName || "(ohne Name)"}“ (#${failure.entityId})`,
      );
      for (const message of failure.messages) {
        lines.push(`      ${message.text}`);
      }
    }
    if (result.failures.length > FAILURE_LOG_LIMIT) {
      lines.push(
        `  … ${result.failures.length - FAILURE_LOG_LIMIT} weitere Verstöße nicht aufgeführt.`,
      );
    }
  }
  return lines.join("\n").trim();
}
