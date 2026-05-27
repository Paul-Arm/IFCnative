import type { IfcDiagnosticSeverity } from "./types";
import { decodeStepString } from "./stepEncoding";

export function asExpressID(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (value && typeof value === "object" && "value" in value) {
    const nested = (value as { value?: unknown }).value;
    return typeof nested === "number" && Number.isFinite(nested)
      ? nested
      : undefined;
  }
  return undefined;
}

export function asExpressIDs(value: unknown): number[] {
  if (!Array.isArray(value)) {
    const id = asExpressID(value);
    return id ? [id] : [];
  }
  return value.flatMap((entry) => {
    const id = asExpressID(entry);
    return id ? [id] : [];
  });
}

export function ifcText(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return decodeStepString(String(value));
  }
  if (Array.isArray(value)) {
    return value.map(ifcText).filter(Boolean).join(", ");
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("value" in record) {
      return ifcText(record.value);
    }
    if ("Name" in record) {
      return ifcText(record.Name);
    }
  }
  return undefined;
}

export function labelForLine(
  line: Record<string, unknown> | undefined,
  fallback: string,
) {
  return ifcText(line?.Name) ?? ifcText(line?.GlobalId) ?? fallback;
}

export function valueTypeName(value: unknown) {
  if (!value || typeof value !== "object") {
    return typeof value;
  }
  return value.constructor?.name === "Object"
    ? undefined
    : value.constructor?.name;
}

export function severityRank(severity: IfcDiagnosticSeverity) {
  return severity === "error" ? 3 : severity === "warning" ? 2 : 1;
}
