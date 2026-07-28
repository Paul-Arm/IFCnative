/**
 * Kopfzeile des Prüfzentrums: Quellen an-/abwählen, Lauf starten und den
 * Status je Quelle sehen. Angeboten werden nur Quellen, die sich in der
 * Registry eingetragen haben (`registeredCheckSources`).
 */
import {
  useChecks,
  type CheckSourceStatus,
  type DocChecks,
} from "../../domain/checks/store";
import { SOURCE_LABELS, type CheckSourceId } from "../../domain/checks/types";

const STATUS_TEXT: Record<CheckSourceStatus, string> = {
  idle: "",
  running: "läuft …",
  done: "",
  error: "fehlgeschlagen",
};

export interface SourcesBarProps {
  docId: string;
  state: DocChecks;
  sources: readonly CheckSourceId[];
  canRun: boolean;
  onRun(): void;
}

export default function SourcesBar({
  docId,
  state,
  sources,
  canRun,
  onRun,
}: SourcesBarProps) {
  const setSourceEnabled = useChecks((s) => s.setSourceEnabled);

  return (
    <div className="pane-toolbar">
      <button className="btn" disabled={!canRun} onClick={onRun} type="button">
        {state.running ? "Prüfe …" : "Prüfen"}
      </button>
      {sources.length === 0 ? (
        <span className="text-dim">Keine Prüfquelle verfügbar.</span>
      ) : (
        sources.map((source) => (
          <label
            key={source}
            className="text-dim"
            style={{ alignItems: "center", display: "inline-flex", gap: 4 }}
            title={statusTitle(state, source)}
          >
            <input
              type="checkbox"
              checked={state.enabled[source]}
              disabled={state.running}
              onChange={(event) =>
                setSourceEnabled(docId, source, event.target.checked)
              }
            />
            <span style={{ color: "var(--text)" }}>{SOURCE_LABELS[source]}</span>
            <SourceStatus state={state} source={source} />
          </label>
        ))
      )}
    </div>
  );
}

function statusTitle(state: DocChecks, source: CheckSourceId): string {
  const result = state.results[source];
  if (!result) return SOURCE_LABELS[source];
  return `${result.findings.length} Befund(e) · ${result.checkedCount} Objekte · ${Math.round(result.durationMs)} ms`;
}

function SourceStatus({
  state,
  source,
}: {
  state: DocChecks;
  source: CheckSourceId;
}) {
  const status = state.status[source];
  const result = state.results[source];
  if (status === "running") return <span>{STATUS_TEXT.running}</span>;
  if (status === "error")
    return <span style={{ color: "var(--error)" }}>{STATUS_TEXT.error}</span>;
  if (!result) return null;
  return <span>({result.findings.length})</span>;
}
