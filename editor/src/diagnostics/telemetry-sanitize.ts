export function sanitizeTelemetryText(value: string): string {
  if (/ISO-10303-21|#\d+\s*=\s*IFC/i.test(value)) return "[IFC content removed]";
  return value.slice(0, 8192)
    .replace(/(?:https?|file):\/\/[^\s<>"']+/gi, "[url]")
    .replace(/(?:[a-z]:[\\/]|\\\\)[^\r\n<>"']+/gi, "[path]")
    .replace(/(?:sig|token|password|authorization|secret|api[_-]?key|sas)["']?\s*[:=]\s*(?:Bearer\s+)?["']?[^\s&,;]+/gi, "[credential]")
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "[credential]");
}

export function telemetryFileNames(names: string[]): string[] {
  return names.slice(0, 32).map(name => sanitizeTelemetryText(name.split(/[\\/]/).at(-1)?.slice(0, 240) ?? ""));
}
