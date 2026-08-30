/**
 * Footer-Anzeige der Hub-Herkunft ("Hub: projekt/modell (branch)") mit
 * Hover-Historie: beim Öffnen des Tooltips werden die letzten Commits des
 * Herkunfts-Branches nachgeladen (Nachricht, Bearbeiter, Datum, Diff) und
 * der aktuell geladene Stand markiert. Gecacht bis sich Herkunft oder
 * geladener Commit ändern (z. B. nach eigenem Commit).
 */

import { Loader2 } from "lucide-react";
import { useRef, useState } from "react";

import {
  Tooltip,
  TooltipContent,
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
        <TooltipContent
          align="end"
          className="block max-w-sm px-3 py-2 text-left"
          side="top"
        >
          <div className="grid gap-1.5">
            <div className="text-[11px] font-semibold">
              {origin.projectName} / {origin.modelName} · {origin.branch} —
              letzte Commits
            </div>
            {loading && !commits ? (
              <div className="flex items-center gap-1.5 opacity-80">
                <Loader2 aria-hidden className="size-3 animate-spin" />
                Lädt Historie…
              </div>
            ) : null}
            {error ? <div className="opacity-80">{error}</div> : null}
            {commits && commits.length === 0 ? (
              <div className="opacity-80">
                Noch keine Commits auf diesem Branch.
              </div>
            ) : null}
            {commits?.map((commit) => (
              <div
                key={commit.id}
                className="grid gap-0.5 border-t border-background/20 pt-1.5 first:border-t-0 first:pt-0"
              >
                <div className="flex items-baseline gap-1.5">
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {commit.message || "(ohne Nachricht)"}
                  </span>
                  {commit.id === origin.commitId ? (
                    <span className="shrink-0 rounded-sm bg-background/20 px-1 text-[10px]">
                      geladen
                    </span>
                  ) : null}
                </div>
                <div className="font-mono text-[10px] opacity-70">
                  {commit.id.slice(0, 8)} · {commit.author?.name ?? "?"} ·{" "}
                  {formatDate(commit.createdAt)} ·{" "}
                  <span className="whitespace-nowrap">
                    +{commit.added} ~{commit.modified} −{commit.removed}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
