/**
 * Projekt-Browser: zwei Spalten (Projekte, Modelle) mit Anlegen-Aktion.
 * Die Ständeliste hängt rechts daneben (siehe VersionList).
 */
import type { HubBrowser } from "./useHubBrowser";

interface ColumnProps {
  title: string;
  items: Array<{ id: string; name: string }>;
  selectedId: string | null;
  emptyText: string;
  createLabel: string;
  createTitle: string;
  canCreate: boolean;
  onSelect(id: string): void;
  onCreate(name: string): void;
}

function EntityColumn({
  title,
  items,
  selectedId,
  emptyText,
  createLabel,
  createTitle,
  canCreate,
  onSelect,
  onCreate,
}: ColumnProps) {
  return (
    <div
      style={{
        borderRight: "1px solid var(--border)",
        display: "flex",
        flex: "0 0 180px",
        flexDirection: "column",
        minWidth: 0,
      }}
    >
      <div className="pane-toolbar" style={{ gap: 4 }}>
        <span className="text-dim">{title}</span>
        <span style={{ marginLeft: "auto" }} />
        <button
          className="btn"
          disabled={!canCreate}
          onClick={() => {
            const name = prompt(createTitle);
            const trimmed = name?.trim();
            if (trimmed) onCreate(trimmed);
          }}
          title={createTitle}
          type="button"
        >
          {createLabel}
        </button>
      </div>
      <div className="pane-body">
        {items.length === 0 ? (
          <p className="pane-empty" style={{ padding: "8px" }}>
            {emptyText}
          </p>
        ) : (
          items.map((item) => (
            <button
              key={item.id}
              className="row-item"
              data-selected={item.id === selectedId}
              onClick={() => onSelect(item.id)}
              title={item.name}
              type="button"
            >
              {item.name}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

export interface ProjectBrowserProps {
  browser: HubBrowser;
  online: boolean;
}

export default function ProjectBrowser({
  browser,
  online,
}: ProjectBrowserProps) {
  return (
    <>
      <EntityColumn
        title="Projekte"
        items={browser.projects}
        selectedId={browser.projectId}
        emptyText={
          online ? "Noch kein Projekt im Hub." : "Keine Verbindung zum Hub."
        }
        createLabel="Neu"
        createTitle="Projekt anlegen — Name:"
        canCreate={online}
        onSelect={browser.selectProject}
        onCreate={(name) => void browser.addProject(name)}
      />
      <EntityColumn
        title="Modelle"
        items={browser.models}
        selectedId={browser.modelId}
        emptyText={
          browser.projectId === null
            ? "Erst ein Projekt wählen."
            : "Noch kein Modell in diesem Projekt."
        }
        createLabel="Neu"
        createTitle="Modell anlegen — Name:"
        canCreate={online && browser.projectId !== null}
        onSelect={browser.selectModel}
        onCreate={(name) => void browser.addModel(name)}
      />
    </>
  );
}
