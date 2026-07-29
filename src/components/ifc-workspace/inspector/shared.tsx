import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Check, Copy } from "lucide-react";
import { useState, type ReactNode } from "react";

import { type NativeIfcDocument } from "@/ifc";
import { cn } from "@/lib/utils";

import { shortType } from "../ui";

/* ------------------------------------------------------------------ */
/* Kleine Layout-Primitive                                             */
/* ------------------------------------------------------------------ */

export function EmptyBlock({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-md border border-dashed border-border/60 bg-muted/20 p-4">
      {title ? (
        <div className="mb-1 text-sm font-medium text-foreground">{title}</div>
      ) : null}
      <div className="text-xs leading-relaxed text-muted-foreground">
        {children}
      </div>
    </div>
  );
}

export function TextLine({ children }: { children: ReactNode }) {
  return (
    <div className="text-sm leading-6 text-muted-foreground">{children}</div>
  );
}

export function CodeBlock({ children }: { children: ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-border/60 bg-muted/30 p-2.5 text-[11px] leading-5 text-foreground">
      <code>{children}</code>
    </pre>
  );
}

export function EditBlock({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-3 rounded-md border border-border/60 bg-card p-3">
      {title ? (
        <h3 className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
      ) : null}
      {children}
    </section>
  );
}

export function ResponsiveRow({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
  );
}

export function ResponsiveField({ children }: { children: ReactNode }) {
  return <div className="min-w-0">{children}</div>;
}

export function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <div className="mt-1 flex shrink-0 items-center gap-2">
      <h3 className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
        {children}
      </h3>
      <div className="h-px flex-1 bg-border/60" />
    </div>
  );
}

export function SubHeading({ children }: { children: ReactNode }) {
  return (
    <div className="mt-1 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground first:mt-0">
      {children}
    </div>
  );
}

export function IconButton({
  disabled,
  icon,
  label,
  tone = "neutral",
  onClick,
}: {
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  tone?: "neutral" | "danger" | "primary";
  onClick(): void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40",
        tone === "danger" && "hover:bg-destructive/10 hover:text-destructive",
        tone === "primary" &&
          "text-primary hover:bg-primary/10 hover:text-primary",
      )}
    >
      {icon}
    </button>
  );
}

export function CopyIconButton({ text, title }: { text: string; title: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      label={copied ? "Kopiert" : title}
      icon={
        copied ? (
          <Check aria-hidden className="size-3.5 text-success" />
        ) : (
          <Copy aria-hidden className="size-3.5" />
        )
      }
      onClick={() => {
        const clipboard = globalThis.navigator?.clipboard;
        if (!clipboard) {
          return;
        }
        void clipboard
          .writeText(text)
          .then(() => {
            setCopied(true);
            globalThis.setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => undefined);
      }}
    />
  );
}

/** Klickbarer Entity-Verweis (#id + Kurzklasse) mit Auswahl per Klick. */
export function EntityChip({
  document,
  id,
  showType = true,
  onSelect,
}: {
  document: NativeIfcDocument;
  id: number;
  showType?: boolean;
  onSelect(entityId: number): void;
}) {
  const target = document.entityById.get(id);
  const title = target
    ? `#${id} ${shortType(target.type)}${target.name ? ` – ${target.name}` : ""} auswählen`
    : `#${id} auswählen`;
  return (
    <button
      type="button"
      title={title}
      onClick={() => onSelect(id)}
      className="inline-flex min-w-0 max-w-full items-center gap-1 rounded border border-border/60 bg-background px-1.5 py-0.5 text-[11px] leading-4 text-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
    >
      <span className="shrink-0 font-mono">#{id}</span>
      {showType && target ? (
        <span className="truncate text-muted-foreground">
          {shortType(target.type)}
        </span>
      ) : null}
    </button>
  );
}

/**
 * Rendert maximal `limit` Einträge; abgeschnittene Listen zeigen den
 * "… N weitere ausgeblendet"-Hinweis und lassen sich per Klick expandieren.
 */
export function CappedItems<T>({
  items,
  limit,
  renderItem,
}: {
  items: T[];
  limit: number;
  renderItem(item: T, index: number): ReactNode;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? items : items.slice(0, limit);
  const hidden = items.length - visible.length;
  return (
    <>
      {visible.map((item, index) => renderItem(item, index))}
      {hidden > 0 ? (
        <button
          type="button"
          className="text-left text-xs text-primary hover:underline"
          onClick={() => setShowAll(true)}
        >
          … {hidden.toLocaleString("de-DE")} weitere ausgeblendet – alle
          anzeigen
        </button>
      ) : null}
    </>
  );
}

/** LabeledInput-Variante mit Placeholder-Unterstützung. */
export function TextField({
  keyboardType,
  label,
  mono,
  multiline,
  placeholder,
  value,
  onChangeText,
}: {
  keyboardType?: "default" | "numeric";
  label: string;
  mono?: boolean;
  multiline?: boolean;
  placeholder?: string;
  value: string;
  onChangeText(value: string): void;
}) {
  return (
    <label className="grid min-w-0 gap-1.5 text-xs text-muted-foreground">
      {label}
      {multiline ? (
        <Textarea
          className={cn("min-h-20 text-xs text-foreground", mono && "font-mono")}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChangeText(event.currentTarget.value)}
        />
      ) : (
        <Input
          className={cn("h-8 text-xs text-foreground", mono && "font-mono")}
          inputMode={keyboardType === "numeric" ? "decimal" : undefined}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChangeText(event.currentTarget.value)}
        />
      )}
    </label>
  );
}

export function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
