import { useUi } from "../../store/ui";

export default function RecentsPane() {
  const { recents, clearRecents } = useUi();
  return (
    <div className="pane">
      <div className="pane-toolbar">
        <span className="text-dim">{recents.length} Einträge</span>
        <span style={{ marginLeft: "auto" }} />
        <button className="btn" onClick={clearRecents} disabled={!recents.length}>
          Leeren
        </button>
      </div>
      <div className="pane-body">
        {recents.length === 0 ? (
          <p className="empty-state">Noch keine Dateien geöffnet.</p>
        ) : (
          <table className="kv-table table-hover">
            <tbody>
              {recents.map((r) => (
                <tr key={r.fileName + r.openedAt}>
                  <td>{r.fileName}</td>
                  <td className="dim">{r.schema}</td>
                  <td className="dim mono">
                    {r.entityCount.toLocaleString("de-DE")} Entities
                  </td>
                  <td className="dim mono">
                    {new Date(r.openedAt).toLocaleString("de-DE")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
