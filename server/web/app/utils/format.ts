/**
 * Formatierung für die Oberfläche (de-DE): relative Zeiten wie bei GitHub
 * („vor 3 Stunden“), Datumsangaben, Zahlen, Dateigrößen.
 */

const relativeFmt = new Intl.RelativeTimeFormat("de-DE", { numeric: "auto" });
const dateFmt = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });
const dateTimeFmt = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "medium",
  timeStyle: "short",
});
const longDateFmt = new Intl.DateTimeFormat("de-DE", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const numberFmt = new Intl.NumberFormat("de-DE");
const compactFmt = new Intl.NumberFormat("de-DE", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

function toDate(value: string | number | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

/** „gerade eben“, „vor 5 Minuten“, „gestern“, „vor 3 Monaten“ … */
export function relativeTime(value: string | number | Date, now = Date.now()): string {
  const date = toDate(value);
  const seconds = Math.round((date.getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return "gerade eben";
  for (const [unit, size] of UNITS) {
    if (abs >= size * 0.9 || unit === "minute") {
      return relativeFmt.format(Math.round(seconds / size), unit);
    }
  }
  return relativeFmt.format(Math.round(seconds / 60), "minute");
}

export function formatDate(value: string | number | Date): string {
  return dateFmt.format(toDate(value));
}

export function formatDateTime(value: string | number | Date): string {
  return dateTimeFmt.format(toDate(value));
}

export function formatLongDate(value: string | number | Date): string {
  return longDateFmt.format(toDate(value));
}

export function formatNumber(value: number): string {
  return numberFmt.format(value);
}

/** 1.234 → „1,2 Tsd.“ — für Kennzahlen in engen Kacheln. */
export function formatCompact(value: number): string {
  return value < 10_000 ? numberFmt.format(value) : compactFmt.format(value);
}

export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** Dauer in ms → „42 s“, „3 min 05 s“, „1 h 12 min“. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ${String(seconds % 60).padStart(2, "0")} s`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

/** „1 Modell“ / „3 Modelle“ */
export function plural(count: number, one: string, many: string): string {
  return `${numberFmt.format(count)} ${count === 1 ? one : many}`;
}

export function shortSha(id: string): string {
  return id.slice(0, 7);
}

/** Tageszeitabhängige Begrüßung. */
export function greeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 5) return "Gute Nacht";
  if (hour < 11) return "Guten Morgen";
  if (hour < 18) return "Guten Tag";
  return "Guten Abend";
}

/** Tag (YYYY-MM-DD, lokal) für Gruppierungen „Commits am …“. */
export function dayKey(value: string | number | Date): string {
  const date = toDate(value);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function fileExtension(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx <= 0 ? "" : name.slice(idx + 1).toLowerCase();
}
