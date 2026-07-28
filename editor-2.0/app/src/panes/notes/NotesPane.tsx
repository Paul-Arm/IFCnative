import { useUi } from "../../store/ui";

export default function NotesPane() {
  const { notes, setNotes } = useUi();
  return (
    <div className="pane">
      <textarea
        className="pane-body notes-editor"
        placeholder="Notizen zu diesem Projekt …"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
    </div>
  );
}
