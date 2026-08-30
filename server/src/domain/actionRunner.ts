import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DOMParser } from "linkedom";

import {
  parseIdsXml,
  parseNativeIfcText,
  validateIds,
  type IdsValidationSummary,
} from "../ifc";
import type { ObjectStore } from "../storage/objectStore";
import type {
  Action,
  ActionRun,
  Commit,
  Repository,
} from "../repository/types";

// Der Editor-IDS-Parser erwartet einen DOM-Parser wie im Browser; Node bringt
// keinen mit, linkedom liefert die kompatible Implementierung.
if (typeof globalThis.DOMParser === "undefined") {
  (globalThis as unknown as Record<string, unknown>).DOMParser = DOMParser;
}

export interface ActionRunnerOptions {
  /** Python-Interpreter für "python"-Actions (Standard: PYTHON_BIN bzw. python/python3). */
  pythonBin?: string;
  /** Zeitlimit je Skriptlauf in Millisekunden (Standard: 5 Minuten). */
  timeoutMs?: number;
}

const LOG_LIMIT = 200_000;
const FAILURE_LOG_LIMIT = 200;
const GUID_LIMIT = 500;

/**
 * Führt Action-Runs sequenziell im Serverprozess aus (eine kleine In-Process-
 * Queue statt externer Worker — passt zum Ein-Prozess-Deployment des Hubs).
 *
 * - "ids": IDS-Validierung über den geteilten Editor-Validator, komplett in
 *   TypeScript — kein externer Prozess nötig.
 * - "python": das hinterlegte Skript läuft als Kindprozess und bekommt den
 *   IFC-Pfad als Argument 1 sowie als Umgebungsvariable IFC_PATH.
 *   Exit-Code 0 = bestanden, alles andere = fehlgeschlagen.
 */
export class ActionRunner {
  private readonly queue: string[] = [];
  private active = false;
  private readonly pythonBin: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly repo: Repository,
    private readonly store: ObjectStore,
    options: ActionRunnerOptions = {},
  ) {
    this.pythonBin =
      options.pythonBin ??
      process.env.PYTHON_BIN ??
      (process.platform === "win32" ? "python" : "python3");
    this.timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;
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
      return;
    }
    const action = await this.repo.getAction(run.actionId);
    const commit = await this.repo.getCommit(run.commitId);
    if (!action || !commit) {
      await this.finish(run, "error", "Action oder Commit nicht mehr vorhanden.", "");
      return;
    }
    await this.repo.updateActionRun(run.id, {
      status: "running",
      startedAt: new Date().toISOString(),
    });
    try {
      if (action.kind === "ids") {
        await this.runIds(run, action, commit);
      } else {
        await this.runPython(run, action, commit);
      }
    } catch (error) {
      await this.finish(
        run,
        "error",
        "Ausführung fehlgeschlagen.",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async finish(
    run: ActionRun,
    status: "success" | "failed" | "error",
    summary: string,
    log: string,
    failedGuids: string[] = [],
  ): Promise<void> {
    await this.repo.updateActionRun(run.id, {
      status,
      summary,
      log: log.length > LOG_LIMIT ? `${log.slice(0, LOG_LIMIT)}\n… (gekürzt)` : log,
      failedGuids: [...new Set(failedGuids)].slice(0, GUID_LIMIT),
      finishedAt: new Date().toISOString(),
    });
  }

  // ---- IDS -------------------------------------------------------------

  private async runIds(
    run: ActionRun,
    action: Action,
    commit: Commit,
  ): Promise<void> {
    const [idsBuffer, ifcBuffer] = await Promise.all([
      this.store.get(action.fileKey),
      this.store.get(commit.blobKey),
    ]);
    const ids = parseIdsXml(idsBuffer.toString("utf8"), action.fileName);
    const document = parseNativeIfcText(ifcBuffer.toString("utf8"));
    const summary = validateIds(document, ids);
    const passed = summary.failCount === 0;
    // GlobalIds der Verstöße — für "Issue erstellen" + 3D-Verortung.
    const failedGuids: string[] = [];
    for (const result of summary.results) {
      for (const failure of result.failures) {
        const guid = document.entityById.get(failure.entityId)?.globalId;
        if (guid) {
          failedGuids.push(guid);
        }
      }
    }
    await this.finish(
      run,
      passed ? "success" : "failed",
      `${summary.passCount} bestanden, ${summary.failCount} fehlgeschlagen, ` +
        `${summary.notApplicableCount} nicht anwendbar — ` +
        `${summary.totalFailures} Verstöße bei ${summary.totalChecked} geprüften Objekten.`,
      renderIdsReport(ids.warnings, summary),
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
      const scriptPath = join(dir, action.fileName.endsWith(".py") ? action.fileName : "script.py");
      const ifcPath = join(dir, "model.ifc");
      const [script, ifc] = await Promise.all([
        this.store.get(action.fileKey),
        this.store.get(commit.blobKey),
      ]);
      await Promise.all([
        writeFile(scriptPath, script),
        writeFile(ifcPath, ifc),
      ]);
      const result = await this.spawnScript(scriptPath, ifcPath, dir);
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
    scriptPath: string,
    ifcPath: string,
    cwd: string,
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
        env: { ...process.env, IFC_PATH: ifcPath },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, this.timeoutMs);
      child.stdout.on("data", (chunk: Buffer) => {
        if (stdout.length < LOG_LIMIT) stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        if (stderr.length < LOG_LIMIT) stderr += chunk.toString("utf8");
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
