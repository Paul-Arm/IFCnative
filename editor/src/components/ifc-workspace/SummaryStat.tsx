import { cn } from "@/lib/utils";

type StatTone = "danger" | "warning" | "info" | "neutral" | "success";

const STAT_TONE_STYLES: Record<StatTone, { surface: string; number: string }> =
  {
    danger: {
      number: "text-destructive",
      surface: "border-destructive/30 bg-destructive/10",
    },
    info: {
      number: "text-info",
      surface: "border-info/30 bg-info/10",
    },
    neutral: {
      number: "text-foreground",
      surface: "border-border/60 bg-card",
    },
    success: {
      number: "text-success",
      surface: "border-success/25 bg-success/10",
    },
    warning: {
      number: "text-warning-foreground dark:text-warning",
      surface: "border-warning/30 bg-warning/10",
    },
  };

export function SummaryStat({
  label,
  tone,
  value,
}: {
  label: string;
  tone: StatTone;
  value: number;
}) {
  const active = value > 0;
  const styles = STAT_TONE_STYLES[tone];
  return (
    <div
      className={cn(
        "min-w-0 rounded-md border px-2.5 py-2",
        active ? styles.surface : "border-border/60 bg-card",
      )}
    >
      <div
        className={cn(
          "text-lg font-semibold leading-tight tabular-nums",
          active ? styles.number : "text-muted-foreground",
        )}
      >
        {value.toLocaleString("de-DE")}
      </div>
      <div className="truncate text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
    </div>
  );
}
