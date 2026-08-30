/**
 * Footer-Anzeige der Hub-Herkunft ("Hub: projekt/modell (branch)") mit
 * Hover-Historie: beim Öffnen des Tooltips werden die letzten Commits des
 * Herkunfts-Branches nachgeladen (Nachricht, Bearbeiter, relative Zeit) und
 * der aktuell geladene Stand markiert. Gecacht bis sich Herkunft oder
 * geladener Commit ändern (z. B. nach eigenem Commit).
 */

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { Loader2 } from "lucide-react";
import { useRef, useState } from "react";

import {
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { VcsApiClient, VcsApiError } from "@/vcs/client";
import type {
  VcsAuth,
  VcsCommit,
  VcsDocumentOrigin,
  VcsSettings,
} from "@/vcs/types";

const COMMIT_LIMIT = 5;

function errorMessage(error: unknown): string {
  if (error instanceof VcsApiError) {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

/** Vollständiges Datum — als title-Attribut hinter der relativen Angabe. */
function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("de-DE", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** Relative Zeitangabe ("vor 3 Minuten", "gestern", "vor 2 Monaten"). */
function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) {
    return iso;
  }
  // Negativ = Vergangenheit; RelativeTimeFormat formuliert daraus "vor …".
  const diffSeconds = Math.round((then - Date.now()) / 1000);
  const elapsed = Math.abs(diffSeconds);
  const rtf = new Intl.RelativeTimeFormat("de", { numeric: "auto" });
  const steps: { limit: number; seconds: number; unit: Intl.RelativeTimeFormatUnit }[] = [
    { limit: 60, seconds: 1, unit: "second" },
    { limit: 3_600, seconds: 60, unit: "minute" },
    { limit: 86_400, seconds: 3_600, unit: "hour" },
    { limit: 604_800, seconds: 86_400, unit: "day" },
    { limit: 2_629_800, seconds: 604_800, unit: "week" },
    { limit: 31_557_600, seconds: 2_629_800, unit: "month" },
    { limit: Number.POSITIVE_INFINITY, seconds: 31_557_600, unit: "year" },
  ];
  const step = steps.find((candidate) => elapsed < candidate.limit) ?? steps[steps.length - 1];
  return rtf.format(Math.trunc(diffSeconds / step.seconds), step.unit);
}

export function VcsOriginStatus({
  origin,
  settings,
  auth,
}: {
  origin: VcsDocumentOrigin;
  settings: VcsSettings;
  auth: VcsAuth | null;
}) {
  const [commits, setCommits] = useState<VcsCommit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Stand, für den die Historie bereits geladen wurde. */
  const loadedKeyRef = useRef<string | null>(null);

  const cacheKey = [
    settings.baseUrl,
    origin.projectSlug,
    origin.modelSlug,
    origin.branch,
    origin.commitId ?? "",
  ].join("|");

  const loadCommits = () => {
    if (loading || loadedKeyRef.current === cacheKey) {
      return;
    }
    setLoading(true);
    setError(null);
    const client = new VcsApiClient(settings, auth);
    client
      .listCommits(origin.projectSlug, origin.modelSlug, origin.branch)
      .then((list) => {
        setCommits(list.slice(0, COMMIT_LIMIT));
        loadedKeyRef.current = cacheKey;
      })
      .catch((loadError: unknown) => {
        setError(errorMessage(loadError));
      })
      .finally(() => {
        setLoading(false);
      });
  };

  return (
    <TooltipProvider delay={200}>
      <Tooltip
        onOpenChange={(open) => {
          if (open) {
            loadCommits();
          }
        }}
      >
        <TooltipTrigger
          render={
            <span className="max-w-64 cursor-default truncate">
              Hub: {origin.projectSlug}/{origin.modelSlug} ({origin.branch})
            </span>
          }
        />
        {/* Eigener Popup statt TooltipContent: Popover-Theming (folgt dem
            App-Theme) statt des invertierten Tooltip-Stils, ohne Pfeil. */}
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Positioner
            align="end"
            className="isolate z-50"
            side="top"
            sideOffset={6}
          >
            <TooltipPrimitive.Popup className="w-80 max-w-[calc(100vw-2rem)] rounded-md border border-border bg-popover p-3 text-xs text-popover-foreground shadow-md data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95">
              <div className="grid gap-1.5">
                <div className="text-[11px] font-semibold text-foreground">
                  {origin.projectName} / {origin.modelName} · {origin.branch} —
                  letzte Commits
                </div>
                {loading && !commits ? (
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Loader2 aria-hidden className="size-3 animate-spin" />
                    Lädt Historie…
                  </div>
                ) : null}
                {error ? (
                  <div className="text-destructive">{error}</div>
                ) : null}
                {commits && commits.length === 0 ? (
                  <div className="text-muted-foreground">
                    Noch keine Commits auf diesem Branch.
                  </div>
                ) : null}
                {commits?.map((commit) => (
                  <div
                    key={commit.id}
                    className="grid gap-0.5 border-t border-border/60 pt-1.5 first:border-t-0 first:pt-0"
                  >
                    <div className="flex items-baseline gap-1.5">
                      <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                        {commit.message || "(ohne Nachricht)"}
                      </span>
                      {commit.id === origin.commitId ? (
                        <span className="shrink-0 rounded-sm bg-primary/15 px-1 text-[10px] text-primary">
                          geladen
                        </span>
                      ) : null}
                    </div>
                    <div
                      className="font-mono text-[10px] text-muted-foreground"
                      title={formatDate(commit.createdAt)}
                    >
                      {commit.id.slice(0, 8)} · {commit.author?.name ?? "?"} ·{" "}
                      {formatRelative(commit.createdAt)}
                    </div>
                  </div>
                ))}
              </div>
            </TooltipPrimitive.Popup>
          </TooltipPrimitive.Positioner>
        </TooltipPrimitive.Portal>
      </Tooltip>
    </TooltipProvider>
  );
}
