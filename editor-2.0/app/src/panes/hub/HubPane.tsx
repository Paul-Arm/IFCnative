/**
 * IFC-Hub (Pane „hub"): Stände eines Modells sichern, öffnen und vergleichen.
 *
 * Die Pane spricht ausschließlich die REST-API aus `domain/hub/client.ts` an
 * und hält keinen Modellzustand: „Stand sichern" nimmt `session.exportStep()`
 * des aktiven Dokuments, „Stand öffnen" legt die geholten Bytes über
 * `useDocuments.openDocument` als neuen Tab ab. Jede Aktion läuft in try/catch;
 * die Meldung des Clients landet unverändert in der Statuszeile, damit ein
 * nicht laufender Dienst nie als leere Liste missverstanden wird.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { loadDiff } from "../../domain/hub/client";
import { hubErrorMessage } from "../../domain/hub/error";
import { useHubSettings } from "../../domain/hub/settings";
import type { HubDiff, HubDiffElement, HubVersion } from "../../domain/hub/types";
import { useDocuments, useActiveDocument } from "../../store/documents";
import { useSelection } from "../../store/selection";
import ConnectionBar from "./ConnectionBar";
import DiffView from "./DiffView";
import ProjectBrowser from "./ProjectBrowser";
import VersionList from "./VersionList";
import { expressIdForGlobalId, openVersionAsDocument, saveSessionAsVersion } from "./actions";
import { versionLabel } from "./format";
import { useHubBrowser } from "./useHubBrowser";
import { useHubStatus } from "./useHubStatus";

const NO_DOCUMENT_HINT =
  "Kein Dokument geöffnet — erst ein IFC öffnen, dann lässt sich der Stand sichern.";

export default function HubPane() {
  const { baseUrl, token, author, setBaseUrl, setToken, setAuthor } =
    useHubSettings();
  const config = useMemo(() => ({ baseUrl, token }), [baseUrl, token]);
  const status = useHubStatus(config);
  const online = status.state === "online";
  const browser = useHubBrowser(config, online);

  const doc = useActiveDocument();
  const openDocument = useDocuments((s) => s.openDocument);
  const select = useSelection((s) => s.select);
  const requestFocus = useSelection((s) => s.requestFocus);

  const [compare, setCompare] = useState<string[]>([]);
  const [diff, setDiff] = useState<HubDiff | null>(null);
  const [diffPair, setDiffPair] = useState<[string, string] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  /**
   * Modellwechsel setzt Vergleichsauswahl und Ergebnis zurück — sonst würden
   * die Ids eines fremden Modells an /diff geschickt.
   */
  useEffect(() => {
    setCompare([]);
    setDiff(null);
    setDiffPair(null);
  }, [browser.modelId]);

  const toggleCompare = useCallback((id: string) => {
    setCompare((current) =>
      current.includes(id)
        ? current.filter((entry) => entry !== id)
        : [...current, id].slice(-2),
    );
  }, []);

  /** Gemeinsamer Rahmen aller Aktionen: Meldungen zurücksetzen, Fehler fangen. */
  const runAction = useCallback(
    async (action: () => Promise<string | null>): Promise<void> => {
      setWorking(true);
      setActionError(null);
      setNotice(null);
      try {
        const message = await action();
        if (message) setNotice(message);
      } catch (cause) {
        setActionError(hubErrorMessage(cause));
      } finally {
        setWorking(false);
      }
    },
    [],
  );

  const canSave = online && doc !== null && browser.modelId !== null;

  function saveStand(): void {
    if (!doc || !browser.projectId || !browser.modelId) return;
    const suggestion = `Stand vom ${new Date().toLocaleString("de-DE")}`;
    const message = prompt("Nachricht für diesen Stand:", suggestion);
    if (message === null) return;
    const projectId = browser.projectId;
    const modelId = browser.modelId;
    void runAction(async () => {
      const version = await saveSessionAsVersion(
        config,
        projectId,
        modelId,
        doc.session,
        message.trim() || suggestion,
        author,
      );
      await browser.refreshVersions();
      return `Stand „${versionLabel(version)}" gesichert.`;
    });
  }

  function openStand(version: HubVersion): void {
    if (!browser.projectId || !browser.modelId) return;
    const projectId = browser.projectId;
    const modelId = browser.modelId;
    const modelName = browser.model?.name ?? "Hub-Modell";
    void runAction(async () => {
      const fileName = await openVersionAsDocument(
        config,
        projectId,
        modelId,
        modelName,
        version,
        openDocument,
      );
      return `„${fileName}" als neuer Tab geöffnet.`;
    });
  }

  function compareStands(): void {
    const [first, second] = compare;
    if (!browser.projectId || !browser.modelId || !first || !second) return;
    const projectId = browser.projectId;
    const modelId = browser.modelId;
    void runAction(async () => {
      const result = await loadDiff(config, projectId, modelId, first, second);
      setDiff(result);
      setDiffPair([first, second]);
      return null;
    });
  }

  /** Klick im Vergleich: Objekt über die GlobalId im aktiven Dokument suchen. */
  function selectFromDiff(element: HubDiffElement): void {
    setNotice(null);
    if (!doc) {
      setActionError(NO_DOCUMENT_HINT);
      return;
    }
    const expressId = expressIdForGlobalId(doc.session, element.globalId);
    if (expressId === null) {
      setActionError(
        `GlobalId ${element.globalId} kommt im aktiven Dokument „${doc.session.fileName}" nicht vor.`,
      );
      return;
    }
    setActionError(null);
    select(doc.id, expressId);
    requestFocus(doc.id, expressId);
    setNotice(`#${expressId} ${doc.session.labelOf(expressId)} ausgewählt.`);
  }

  const labelOfId = (id: string): string => {
    const version = browser.versions.find((entry) => entry.id === id);
    return version ? versionLabel(version) : id;
  };
  const message = actionError ?? browser.error ?? status.error ?? notice;
  const isError = Boolean(actionError ?? browser.error ?? status.error);

  return (
    <div className="pane">
      <ConnectionBar
        baseUrl={baseUrl}
        token={token}
        author={author}
        state={status.state}
        version={status.version}
        onBaseUrl={setBaseUrl}
        onToken={setToken}
        onAuthor={setAuthor}
        onCheck={status.check}
      />

      <div className="pane-toolbar">
        <button
          className="btn"
          disabled={!canSave || working}
          onClick={saveStand}
          title={
            doc === null
              ? NO_DOCUMENT_HINT
              : browser.modelId === null
                ? "Erst ein Modell wählen."
                : "Aktives Dokument als neuen Stand im Hub ablegen"
          }
          type="button"
        >
          Stand sichern
        </button>
        <button
          className="btn"
          disabled={compare.length !== 2 || working}
          onClick={compareStands}
          title="Zwei angekreuzte Stände vergleichen"
          type="button"
        >
          Vergleichen
        </button>
        {diff !== null && (
          <button
            className="btn"
            onClick={() => {
              setDiff(null);
              setDiffPair(null);
            }}
            type="button"
          >
            Zur Ständeliste
          </button>
        )}
        <span className="text-dim">
          {browser.project?.name ?? "kein Projekt"} ·{" "}
          {browser.model?.name ?? "kein Modell"}
        </span>
        {(working || browser.busy) && <span className="text-dim">arbeitet …</span>}
        {doc === null && <span className="text-dim">kein Dokument geöffnet</span>}
      </div>

      {message !== null && message !== "" && (
        <p className={isError ? "msg msg-error" : "list-note"}>{message}</p>
      )}

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <ProjectBrowser browser={browser} online={online} />
        <div className="pane-body" style={{ flex: 1, minWidth: 0 }}>
          {diff !== null && diffPair !== null ? (
            <DiffView
              diff={diff}
              labelA={labelOfId(diffPair[0])}
              labelB={labelOfId(diffPair[1])}
              canSelect={doc !== null}
              onSelect={selectFromDiff}
              onClose={() => {
                setDiff(null);
                setDiffPair(null);
              }}
            />
          ) : (
            <VersionList
              versions={browser.versions}
              compare={compare}
              emptyText={
                !online
                  ? "Keine Verbindung zum Hub."
                  : browser.modelId === null
                    ? "Projekt und Modell wählen — die Stände erscheinen hier."
                    : "Noch kein Stand gesichert."
              }
              onToggleCompare={toggleCompare}
              onOpen={openStand}
            />
          )}
        </div>
      </div>
    </div>
  );
}
