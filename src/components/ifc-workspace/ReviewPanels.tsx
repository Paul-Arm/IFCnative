import type { NativeIfcDocument } from "@/ifc";
import { cn } from "@/lib/utils";
import { AlertTriangle, Info, Terminal, XCircle } from "lucide-react";

import { Badge, Button, PanelHeader, PanelShell } from "./ui";

const DIAGNOSTIC_PATTERNS: Array<{
  test: RegExp;
  tone: "danger" | "warning" | "info";
}> = [
  { test: /error|fail|exception/i, tone: "danger" },
  { test: /warn|missing|invalid/i, tone: "warning" },
  { test: /info|note|hint/i, tone: "info" },
];

function classifyDiagnostic(text: string) {
  for (const entry of DIAGNOSTIC_PATTERNS) {
    if (entry.test.test(text)) {
      return entry.tone;
    }
  }
  return "info" as const;
}

export function ConsolePanel({
  lines,
  onClear,
}: {
  lines: string[];
  onClear(): void;
}) {
  return (
    <PanelShell>
      <PanelHeader
        title="Console"
        eyebrow="Log"
        description={`${lines.length.toLocaleString()} Zeile${lines.length === 1 ? "" : "n"}`}
        meta={
          <Badge tone="neutral">
            <Terminal aria-hidden className="mr-1 inline size-3" />
            live
          </Badge>
        }
        actions={
          <Button disabled={!lines.length} label="Leeren" onPress={onClear} />
        }
      />
      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-zinc-800/60 bg-zinc-950 px-3 py-2 font-mono text-[11px] leading-5 text-zinc-100 shadow-inner">
        {lines.length ? (
          lines.map((line, index) => (
            <div
              key={`${line}-${index}`}
              className="flex gap-2 py-0.5 hover:bg-white/[0.03]"
            >
              <span className="w-8 shrink-0 select-none text-right tabular-nums text-zinc-600">
                {index + 1}
              </span>
              <span className="min-w-0 whitespace-pre-wrap break-words text-zinc-200">
                {line}
              </span>
            </div>
          ))
        ) : (
          <div className="flex h-full items-center justify-center text-zinc-500">
            Noch keine Log-Eintr&auml;ge.
          </div>
        )}
      </div>
    </PanelShell>
  );
}

export function DiagnosticsPanel({
  document,
}: {
  document: NativeIfcDocument;
}) {
  const diagnostics = document.diagnostics;
  return (
    <PanelShell scroll>
      <PanelHeader
        eyebrow="Parser"
        title="Diagnostics"
        description="Parser- und Importhinweise f&uuml;r das aktive IFC"
        meta={
          <Badge tone={diagnostics.length ? "warning" : "success"}>
            {diagnostics.length}
          </Badge>
        }
      />
      {diagnostics.length ? (
        <ul className="grid gap-1.5">
          {diagnostics.map((diagnostic, index) => {
            const tone = classifyDiagnostic(diagnostic);
            const Icon =
              tone === "danger"
                ? XCircle
                : tone === "warning"
                  ? AlertTriangle
                  : Info;
            return (
              <li
                key={`${diagnostic}-${index}`}
                className={cn(
                  "flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs",
                  tone === "danger" &&
                    "border-red-200/70 bg-red-50/60 text-red-900",
                  tone === "warning" &&
                    "border-amber-200/70 bg-amber-50/70 text-amber-900",
                  tone === "info" &&
                    "border-sky-200/70 bg-sky-50/60 text-sky-900",
                )}
              >
                <Icon
                  aria-hidden
                  className={cn(
                    "mt-0.5 size-3.5 shrink-0",
                    tone === "danger" && "text-red-500",
                    tone === "warning" && "text-amber-500",
                    tone === "info" && "text-sky-500",
                  )}
                />
                <code className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono leading-snug">
                  {diagnostic}
                </code>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="rounded-md border border-dashed border-emerald-200/70 bg-emerald-50/60 px-3 py-4 text-center text-xs text-emerald-700">
          Keine Diagnose-Meldungen.
        </div>
      )}
    </PanelShell>
  );
}
