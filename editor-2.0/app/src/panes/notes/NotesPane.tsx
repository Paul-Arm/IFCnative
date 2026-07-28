import { useUi } from "../../store/ui";

export default function NotesPane() {
  const { notes, setNotes } = useUi();
  return (
    <div className="pane">
      <textarea
        className="pane-body"
        style={{
          border: "none",
          resize: "none",
          padding: 10,
          background: "var(--bg-panel)",
          color: "var(--text)",
          font: "inherit",
          outline: "none",
        }}
        placeholder="Notizen zu diesem Projekt …"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
    </div>
  );
}
