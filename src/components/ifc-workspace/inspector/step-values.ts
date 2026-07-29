import { quote, splitTopLevel, unquote, type NativeIfcEntity } from "@/ifc";

import { QUANTITY_TYPES } from "../constants";

/* ------------------------------------------------------------------ */
/* STEP-Parsing-Helfer                                                 */
/* ------------------------------------------------------------------ */

export function editableSetValue(
  entity: NativeIfcEntity | undefined,
  fallback: string,
) {
  if (!entity) {
    return fallback;
  }
  if (QUANTITY_TYPES.includes(entity.type)) {
    return `${entity.type}(${entity.args[3] ?? "0"})`;
  }
  if (entity.type === "IFCPROPERTYLISTVALUE") {
    return parseStepValueList(entity.args[2])
      .map((value) => parseIfcValue(value).value)
      .join("; ");
  }
  if (entity.type === "IFCPROPERTYENUMERATEDVALUE") {
    return parseStepValueList(entity.args[2])
      .map((value) => parseIfcValue(value).value)
      .join("; ");
  }
  if (entity.type === "IFCPROPERTYBOUNDEDVALUE") {
    const upper = parseOptionalIfcValue(entity.args[2]);
    const lower = parseOptionalIfcValue(entity.args[3]);
    const setPoint = parseOptionalIfcValue(entity.args[5]);
    return `${lower}..${upper}${setPoint ? `; ${setPoint}` : ""}`;
  }
  if (entity.type === "IFCPROPERTYTABLEVALUE") {
    const defining = parseStepValueList(entity.args[2]).map(
      (value) => parseIfcValue(value).value,
    );
    const defined = parseStepValueList(entity.args[3]).map(
      (value) => parseIfcValue(value).value,
    );
    return defining
      .map((value, index) => `${value}=>${defined[index] ?? ""}`)
      .join("; ");
  }
  return entity.args[2] ?? fallback;
}

export function parseTypedPropertyValue(rawValue: string, entity?: NativeIfcEntity) {
  if (entity?.type === "IFCPROPERTYLISTVALUE") {
    return {
      value: rawValue,
      valueType: `IFCPROPERTYLISTVALUE:${readStepListValueType(entity.args[2])}`,
    };
  }
  if (entity?.type === "IFCPROPERTYENUMERATEDVALUE") {
    return {
      value: rawValue,
      valueType: `IFCPROPERTYENUMERATEDVALUE:${readStepListValueType(entity.args[2])}`,
    };
  }
  if (entity?.type === "IFCPROPERTYBOUNDEDVALUE") {
    return {
      value: rawValue,
      valueType: `IFCPROPERTYBOUNDEDVALUE:${readFirstStepValueType([
        entity.args[2],
        entity.args[3],
        entity.args[5],
      ])}`,
    };
  }
  if (entity?.type === "IFCPROPERTYTABLEVALUE") {
    return {
      value: rawValue,
      valueType: `IFCPROPERTYTABLEVALUE:${readStepListValueType(entity.args[2])}:${readStepListValueType(entity.args[3])}`,
    };
  }
  const trimmed = rawValue.trim();
  const match = trimmed.match(/^([A-Z0-9_]+)\(([\s\S]*)\)$/i);
  if (!match) {
    return { value: trimmed === "-" ? "" : trimmed, valueType: "IFCLABEL" };
  }
  const valueType = normalizePropertyValueType(match[1]);
  const inner = match[2].trim();
  if (valueType === "IFCBOOLEAN") {
    const flag = inner.replace(/^\./, "").replace(/\.$/, "").toUpperCase();
    return { value: flag === "F" ? "False" : "True", valueType };
  }
  const unquoted = inner.match(/^'([\s\S]*)'$/)?.[1];
  if (unquoted != null) {
    return { value: unquote(inner) ?? unquoted.replace(/''/g, "'"), valueType };
  }
  return { value: inner.replace(/^\./, "").replace(/\.$/, ""), valueType };
}

function parseStepValueList(rawValue = "") {
  const trimmed = rawValue.trim();
  if (!trimmed || trimmed === "$") {
    return [];
  }
  return splitTopLevel(trimmed.replace(/^\(/, "").replace(/\)$/, ""));
}

function parseOptionalIfcValue(rawValue = "") {
  return rawValue && rawValue !== "$" ? parseIfcValue(rawValue).value : "";
}

export function readOptionalStepString(rawValue = "") {
  const trimmed = rawValue.trim();
  if (!trimmed || trimmed === "$" || trimmed === "*") {
    return "";
  }
  return unquote(trimmed) ?? readStepEnum(trimmed);
}

export function writeOptionalStepString(value: string) {
  const trimmed = value.trim();
  return trimmed ? quote(trimmed) : "$";
}

export function readStepEnum(rawValue = "") {
  return rawValue.trim().replace(/^\./, "").replace(/\.$/, "");
}

export function writeStepEnum(value: string) {
  const normalized = value.trim().replace(/^\./, "").replace(/\.$/, "");
  return normalized ? `.${normalized.toUpperCase()}.` : "$";
}

export function setStepArgs(args: string[], updates: Record<number, string>) {
  const next = [...args];
  for (const [index, value] of Object.entries(updates)) {
    next[Number(index)] = value;
  }
  return next;
}

function parseIfcValue(rawValue = "") {
  const trimmed = rawValue.trim();
  const match = trimmed.match(/^([A-Z0-9_]+)\(([\s\S]*)\)$/i);
  if (!match) {
    return { value: trimmed, valueType: "IFCLABEL" };
  }
  const valueType = normalizePropertyValueType(match[1]);
  const inner = match[2].trim();
  if (valueType === "IFCBOOLEAN") {
    const flag = inner.replace(/^\./, "").replace(/\.$/, "").toUpperCase();
    return { value: flag === "F" ? "False" : "True", valueType };
  }
  const unquoted = inner.match(/^'([\s\S]*)'$/)?.[1];
  if (unquoted != null) {
    return { value: unquote(inner) ?? unquoted.replace(/''/g, "'"), valueType };
  }
  return { value: inner.replace(/^\./, "").replace(/\.$/, ""), valueType };
}

function readStepListValueType(rawValue = "") {
  const first = parseStepValueList(rawValue)[0];
  return first ? parseIfcValue(first).valueType : "IFCLABEL";
}

function readFirstStepValueType(values: Array<string | undefined>) {
  const rawValue = values.find((value) => value && value !== "$");
  return rawValue ? parseIfcValue(rawValue).valueType : "IFCLABEL";
}

function normalizePropertyValueType(type: string) {
  const normalized = type
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "");
  return normalized.startsWith("IFC") ? normalized : "IFCLABEL";
}

export function propertyValueTypeLabel(valueType: string) {
  const [kind, firstType, secondType] = valueType.split(":");
  const shortKind = shortIfcName(kind);
  if (kind === "IFCPROPERTYLISTVALUE") {
    return `List ${shortIfcName(firstType ?? "IFCLABEL")}`;
  }
  if (kind === "IFCPROPERTYENUMERATEDVALUE") {
    return `Enum ${shortIfcName(firstType ?? "IFCLABEL")}`;
  }
  if (kind === "IFCPROPERTYBOUNDEDVALUE") {
    return `Bounded ${shortIfcName(firstType ?? "IFCREAL")}`;
  }
  if (kind === "IFCPROPERTYTABLEVALUE") {
    return `Table ${shortIfcName(firstType ?? "IFCREAL")} -> ${shortIfcName(secondType ?? "IFCREAL")}`;
  }
  return shortKind;
}

function shortIfcName(value: string) {
  return value.replace(/^IFCPROPERTY/i, "").replace(/^IFC/i, "");
}
