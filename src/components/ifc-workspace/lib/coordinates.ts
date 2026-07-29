import type { ParsedCoordinates } from "../types";

export function formatCoordinate(value: number) {
  if (!Number.isFinite(value)) {
    return "0";
  }
  const rounded = Math.round(value * 1000) / 1000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

export function readBodyCoordinate(value: string | undefined) {
  const numeric = Number(
    String(value ?? "")
      .trim()
      .replace(",", "."),
  );
  return Number.isFinite(numeric) ? numeric : 0;
}

export function parseCoordinateClipboardText(
  text: string,
): ParsedCoordinates | undefined {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const data = JSON.parse(trimmed) as Record<string, unknown>;
    const x = readClipboardCoordinate(data.x);
    const y = readClipboardCoordinate(data.y);
    const z = readClipboardCoordinate(data.z);
    if (x && y && z) {
      const parsed = toParsedCoordinates(x, y, z);
      const documentId = readClipboardString(data.documentId);
      const entityId = readClipboardNumber(data.entityId);
      const fileName = readClipboardString(data.fileName);
      const localId = readClipboardNumber(data.localId);
      const modelId = readClipboardString(data.modelId);
      return {
        ...parsed,
        ...(documentId ? { documentId } : {}),
        ...(entityId ? { entityId } : {}),
        ...(fileName ? { fileName } : {}),
        ...(localId ? { localId } : {}),
        ...(modelId ? { modelId } : {}),
        ...(data.source === "thatopen" ? { source: "thatopen" as const } : {}),
      };
    }
  } catch {
    // fall through to plain text parsing
  }

  const labeled = [
    ...trimmed.matchAll(/\b([xyz])\s*[:=]?\s*(-?\d+(?:[.,]\d+)?)/gi),
  ];
  if (labeled.length >= 3) {
    const coordinates = new Map(
      labeled.map((match) => [
        match[1].toLowerCase(),
        normalizeCoordinateText(match[2]),
      ]),
    );
    const x = coordinates.get("x");
    const y = coordinates.get("y");
    const z = coordinates.get("z");
    if (x && y && z) {
      return toParsedCoordinates(x, y, z);
    }
  }

  const numbers = trimmed
    .match(/-?\d+(?:[.,]\d+)?/g)
    ?.map(normalizeCoordinateText);
  if (numbers && numbers.length >= 3) {
    const [x, y, z] = numbers;
    if (x && y && z) {
      return toParsedCoordinates(x, y, z);
    }
  }
  return undefined;
}

function toParsedCoordinates(
  x: string,
  y: string,
  z: string,
): ParsedCoordinates {
  return { x, y, z };
}

function readClipboardCoordinate(value: unknown) {
  if (typeof value === "number") {
    return formatCoordinate(value);
  }
  if (typeof value === "string") {
    return normalizeCoordinateText(value);
  }
  return undefined;
}

function readClipboardString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readClipboardNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function normalizeCoordinateText(value: string) {
  const normalized = Number(value.trim().replace(",", "."));
  if (!Number.isFinite(normalized)) {
    return undefined;
  }
  return formatCoordinate(normalized);
}
