import { editorUpdates } from "@/updates/client";
import { notificationVisible } from "@/updates/controller";
import { useUpdates } from "@/updates/use-updates";
import { ArrowUpCircle, X } from "lucide-react";
import { Button } from "./ui";

export function UpdateNotification({
  onOpenSettings,
  hidden = false,
}: {
  onOpenSettings: () => void;
  hidden?: boolean;
}) {
  const state = useUpdates();
  if (hidden || !notificationVisible(state)) return null;
  return (
    <aside
      aria-label="Editor-Update verfügbar"
      className="fixed top-12 right-4 z-40 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-card p-4 text-card-foreground shadow-lg"
    >
      <button
        type="button"
        aria-label="Update-Hinweis für eine Woche ausblenden"
        title="Für eine Woche ausblenden"
        className="absolute top-2 right-2 rounded-md p-1.5 text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        onClick={editorUpdates.snooze}
      >
        <X aria-hidden className="size-4" />
      </button>
      <div
        className="flex items-start gap-3 pr-4"
        role="status"
        aria-live="polite"
      >
        <ArrowUpCircle
          aria-hidden
          className="mt-0.5 size-5 shrink-0 text-primary"
        />
        <div>
          <p className="text-sm font-semibold">
            IFCnative {state.update?.version} ist verfügbar
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Installiere das Update, wenn es gerade passt.
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="default" onClick={onOpenSettings}>
          Update ansehen
        </Button>
        <Button variant="ghost" onClick={editorUpdates.snooze}>
          In einer Woche
        </Button>
      </div>
    </aside>
  );
}
