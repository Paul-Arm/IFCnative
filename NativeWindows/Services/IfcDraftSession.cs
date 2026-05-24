namespace IFCnative.NativeWindows.Services;

public sealed class IfcDraftSession
{
    private readonly Stack<DraftCheckpoint> undoStack = [];
    private readonly Stack<DraftCheckpoint> redoStack = [];

    private sealed record DraftCheckpoint(IfcDocument Document, string Name, IReadOnlyList<string> Summary);

    public IfcDocument? SavedDocument { get; private set; }
    public IfcDocument? PendingDocument { get; private set; }

    public bool HasDraft => SavedDocument is not null && PendingDocument is not null;
    public bool CanExport => !HasDraft;
    public bool CanUndo => !HasDraft && undoStack.Count > 0;
    public bool CanRedo => !HasDraft && redoStack.Count > 0;
    public string? NextUndoName => undoStack.TryPeek(out var checkpoint) ? checkpoint.Name : null;
    public string? NextRedoName => redoStack.TryPeek(out var checkpoint) ? checkpoint.Name : null;

    public void Reset(IfcDocument document)
    {
        SavedDocument = document;
        PendingDocument = null;
        undoStack.Clear();
        redoStack.Clear();
    }

    public IfcDocument Stage(IfcDocument currentDocument, IfcDocument draftDocument)
    {
        SavedDocument ??= currentDocument;
        PendingDocument = draftDocument;
        return draftDocument;
    }

    public IfcDocument? Apply(string? changesetName = null)
    {
        if (PendingDocument is null)
        {
            return null;
        }

        if (SavedDocument is not null)
        {
            undoStack.Push(new DraftCheckpoint(SavedDocument, NormalizeChangesetName(changesetName), IfcDiffService.Summarize(SavedDocument, PendingDocument)));
            redoStack.Clear();
        }

        SavedDocument = PendingDocument;
        PendingDocument = null;
        return SavedDocument;
    }

    public IfcDocument? Discard()
    {
        if (!HasDraft)
        {
            return null;
        }

        PendingDocument = null;
        return SavedDocument;
    }

    public IfcDocument? Undo()
    {
        if (!CanUndo || SavedDocument is null)
        {
            return null;
        }

        var checkpoint = undoStack.Pop();
        redoStack.Push(new DraftCheckpoint(SavedDocument, checkpoint.Name, checkpoint.Summary));
        SavedDocument = checkpoint.Document;
        PendingDocument = null;
        return SavedDocument;
    }

    public IfcDocument? Redo()
    {
        if (!CanRedo || SavedDocument is null)
        {
            return null;
        }

        var checkpoint = redoStack.Pop();
        undoStack.Push(new DraftCheckpoint(SavedDocument, checkpoint.Name, checkpoint.Summary));
        SavedDocument = checkpoint.Document;
        PendingDocument = null;
        return SavedDocument;
    }

    public IReadOnlyList<string> Summarize()
    {
        if (HasDraft && SavedDocument is not null && PendingDocument is not null)
        {
            return IfcDiffService.Summarize(SavedDocument, PendingDocument);
        }

        var historySummary = new List<string> { "No pending draft." };
        if (CanUndo || CanRedo)
        {
            historySummary.Add($"History: {undoStack.Count:N0} undo / {redoStack.Count:N0} redo checkpoint(s).");

            if (undoStack.TryPeek(out var undoCheckpoint))
            {
                historySummary.Add($"Undo next: {undoCheckpoint.Name}");
            }

            if (redoStack.TryPeek(out var redoCheckpoint))
            {
                historySummary.Add($"Redo next: {redoCheckpoint.Name}");
            }
        }

        return historySummary;
    }

    public IReadOnlyList<string> GetHistoryLines(int maxSummaryLines = 3)
    {
        var lines = new List<string>();
        if (undoStack.Count > 0)
        {
            lines.Add("Undo history:");
            foreach (var checkpoint in undoStack.Take(10))
            {
                lines.Add($"• {checkpoint.Name}");
                foreach (var summaryLine in checkpoint.Summary.Take(maxSummaryLines))
                {
                    lines.Add($"  {summaryLine}");
                }
            }
        }

        if (redoStack.Count > 0)
        {
            lines.Add("Redo history:");
            foreach (var checkpoint in redoStack.Take(10))
            {
                lines.Add($"• {checkpoint.Name}");
            }
        }

        return lines;
    }

    private static string NormalizeChangesetName(string? changesetName)
    {
        var trimmed = changesetName?.Trim();
        return string.IsNullOrWhiteSpace(trimmed) ? "Unnamed changeset" : trimmed;
    }
}
