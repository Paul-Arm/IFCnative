import type { ActionRun, ActionRunStatus } from "~/types/api";

/** Deutsche Bezeichnung je Run-Status. */
export const RUN_STATUS_LABEL: Record<ActionRunStatus, string> = {
  queued: "Wartet",
  running: "Läuft",
  success: "Bestanden",
  failed: "Fehlgeschlagen",
  error: "Fehler",
  cancelled: "Abgebrochen",
};

export interface CommitCheck {
  status: ActionRunStatus;
  total: number;
  passed: number;
  runs: ActionRun[];
}

/**
 * Prüfstatus eines Commits wie GitHubs Commit-Checks: je Action zählt nur
 * der jüngste Run; das Gesamtergebnis ist der „schlechteste“ Zustand
 * (läuft > fehlgeschlagen > Fehler > bestanden > abgebrochen).
 */
export function aggregateChecks(runs: ActionRun[]): CommitCheck | null {
  if (!runs.length) return null;
  const latest = new Map<string, ActionRun>();
  for (const run of runs) {
    const known = latest.get(run.actionId);
    if (!known || known.number < run.number) latest.set(run.actionId, run);
  }
  const list = [...latest.values()];
  const states = list.map((run) => run.status);
  let status: ActionRunStatus = "cancelled";
  if (states.some((s) => s === "running")) status = "running";
  else if (states.some((s) => s === "queued")) status = "queued";
  else if (states.some((s) => s === "failed")) status = "failed";
  else if (states.some((s) => s === "error")) status = "error";
  else if (states.some((s) => s === "success")) status = "success";
  return {
    status,
    total: list.length,
    passed: list.filter((run) => run.status === "success").length,
    runs: list,
  };
}

/** Runs nach Commit gruppieren und je Commit aggregieren. */
export function checksByCommit(runs: ActionRun[]): Map<string, CommitCheck> {
  const grouped = new Map<string, ActionRun[]>();
  for (const run of runs) {
    grouped.set(run.commitId, [...(grouped.get(run.commitId) ?? []), run]);
  }
  const result = new Map<string, CommitCheck>();
  for (const [commitId, list] of grouped) {
    const check = aggregateChecks(list);
    if (check) result.set(commitId, check);
  }
  return result;
}

export function runDuration(run: Pick<ActionRun, "startedAt" | "finishedAt">, now = Date.now()): number | null {
  if (!run.startedAt) return null;
  const end = run.finishedAt ? new Date(run.finishedAt).getTime() : now;
  return end - new Date(run.startedAt).getTime();
}

export function isRunPending(status: ActionRunStatus): boolean {
  return status === "queued" || status === "running";
}
