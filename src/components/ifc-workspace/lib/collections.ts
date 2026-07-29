import type { SetStateAction } from "react";

import type { NativeIfcDocument } from "@/ifc";

import type { Point } from "../types";

export function addToSet<T>(current: Set<T>, value: T) {
  return new Set(current).add(value);
}

export function removeFromSet<T>(current: Set<T>, value: T) {
  const next = new Set(current);
  next.delete(value);
  return next;
}

export function filterEntitySet(
  current: Set<number>,
  document: NativeIfcDocument,
) {
  return new Set([...current].filter((id) => document.entityById.has(id)));
}

export function filterGraphPositions(
  current: Map<number, Point>,
  document: NativeIfcDocument,
) {
  return new Map([...current].filter(([id]) => document.entityById.has(id)));
}

export function applyStateAction<T>(current: T, action: SetStateAction<T>) {
  return typeof action === "function"
    ? (action as (value: T) => T)(current)
    : action;
}
