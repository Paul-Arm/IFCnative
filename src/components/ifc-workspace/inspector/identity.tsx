import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type ReactNode } from "react";

import { quote, unquote, type NativeIfcEntity } from "@/ifc";

import { ENTITY_TYPES } from "../constants";
import type { EntityEditDraft } from "../types";
import { CommitInput, shortType } from "../ui";

/* ------------------------------------------------------------------ */
/* Editierbare Identität (Tab "Übersicht")                             */
/* ------------------------------------------------------------------ */

/** Label/Control-Zeile im InfoRow-Layout für die editierbare Identität. */
export function IdentityEditRow({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div className="grid gap-1 rounded-md bg-muted/30 px-2 py-1 text-sm sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-center sm:gap-2">
      <span className="text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

type IdentityAttributeKind = "angle" | "enum" | "number" | "text";

interface IdentityAttributeDefinition {
  argIndex: number;
  kind: IdentityAttributeKind;
  label: string;
  options?: { label: string; value: string }[];
  placeholder?: string;
}

const COMPOSITION_TYPE_OPTIONS = [
  { label: "Nicht gesetzt", value: "$" },
  { label: "Element", value: ".ELEMENT." },
  { label: "Teilweise", value: ".PARTIAL." },
  { label: "Komplex", value: ".COMPLEX." },
];

const SPACE_TYPE_OPTIONS = [
  { label: "Nicht gesetzt", value: "$" },
  { label: "Innenraum", value: ".INTERNAL." },
  { label: "Außenraum", value: ".EXTERNAL." },
  { label: "GFA", value: ".GFA." },
  { label: "Parken", value: ".PARKING." },
  { label: "USERDEFINED", value: ".USERDEFINED." },
  { label: "NOTDEFINED", value: ".NOTDEFINED." },
];

const PROXY_TYPE_OPTIONS = [
  { label: "Nicht gesetzt", value: "$" },
  { label: "Komplex", value: ".COMPLEX." },
  { label: "Element", value: ".ELEMENT." },
  { label: "Teil", value: ".PARTIAL." },
  { label: "Platzhalter für Raum", value: ".PROVISIONFORSPACE." },
  { label: "Platzhalter für Öffnung", value: ".PROVISIONFORVOID." },
  { label: "Benutzerdefiniert", value: ".USERDEFINED." },
  { label: "Nicht definiert", value: ".NOTDEFINED." },
];

const IDENTITY_ATTRIBUTES_BY_TYPE: Record<
  string,
  IdentityAttributeDefinition[]
> = {
  IFCBUILDING: [
    { argIndex: 4, kind: "text", label: "Objekttyp" },
    { argIndex: 7, kind: "text", label: "Langname" },
    {
      argIndex: 8,
      kind: "enum",
      label: "Gliederung",
      options: COMPOSITION_TYPE_OPTIONS,
    },
    {
      argIndex: 9,
      kind: "number",
      label: "Referenzhöhe",
      placeholder: "z. B. 125.40",
    },
    {
      argIndex: 10,
      kind: "number",
      label: "Geländehöhe",
      placeholder: "z. B. 123.80",
    },
  ],
  IFCBUILDINGSTOREY: [
    { argIndex: 4, kind: "text", label: "Objekttyp" },
    { argIndex: 7, kind: "text", label: "Langname" },
    {
      argIndex: 8,
      kind: "enum",
      label: "Gliederung",
      options: COMPOSITION_TYPE_OPTIONS,
    },
    {
      argIndex: 9,
      kind: "number",
      label: "Höhenlage",
      placeholder: "z. B. 3.20",
    },
  ],
  IFCPROJECT: [
    { argIndex: 4, kind: "text", label: "Objekttyp" },
    { argIndex: 5, kind: "text", label: "Langname" },
    { argIndex: 6, kind: "text", label: "Projektphase" },
  ],
  IFCSITE: [
    { argIndex: 4, kind: "text", label: "Objekttyp" },
    { argIndex: 7, kind: "text", label: "Langname" },
    {
      argIndex: 8,
      kind: "enum",
      label: "Gliederung",
      options: COMPOSITION_TYPE_OPTIONS,
    },
    {
      argIndex: 9,
      kind: "angle",
      label: "Breitengrad",
      placeholder: "z. B. 52, 31, 12",
    },
    {
      argIndex: 10,
      kind: "angle",
      label: "Längengrad",
      placeholder: "z. B. 13, 24, 18",
    },
    {
      argIndex: 11,
      kind: "number",
      label: "Referenzhöhe",
      placeholder: "z. B. 34.50",
    },
    { argIndex: 12, kind: "text", label: "Grundbuchnummer" },
  ],
  IFCSPACE: [
    { argIndex: 4, kind: "text", label: "Objekttyp" },
    { argIndex: 7, kind: "text", label: "Langname" },
    {
      argIndex: 8,
      kind: "enum",
      label: "Gliederung",
      options: COMPOSITION_TYPE_OPTIONS,
    },
    {
      argIndex: 9,
      kind: "enum",
      label: "Raumtyp",
      options: SPACE_TYPE_OPTIONS,
    },
    {
      argIndex: 10,
      kind: "number",
      label: "Fertigfußboden",
      placeholder: "z. B. 0.15",
    },
  ],
};

export function EntitySpecificIdentityFields({
  entity,
  schema,
  onSave,
}: {
  entity: NativeIfcEntity;
  schema: string;
  onSave(draft: EntityEditDraft): void;
}) {
  const definitions = identityAttributeDefinitions(entity.type, schema);
  if (!definitions.length) {
    return null;
  }

  const saveAttribute = (
    definition: IdentityAttributeDefinition,
    nextValue: string,
  ) => {
    const nextArgs = [...entity.args];
    while (nextArgs.length <= definition.argIndex) {
      nextArgs.push("$");
    }
    nextArgs[definition.argIndex] = encodeIdentityAttribute(
      nextValue,
      definition.kind,
    );
    onSave({
      description: entity.description,
      name: entity.name,
      rawArgs: nextArgs.join(","),
      type: entity.type,
    });
  };

  return definitions.map((definition) => {
    const rawValue = entity.args[definition.argIndex] ?? "$";
    return (
      <IdentityEditRow key={definition.argIndex} label={definition.label}>
        {definition.kind === "enum" ? (
          <Select
            value={rawValue}
            onValueChange={(nextValue) => {
              if (nextValue && nextValue !== rawValue) {
                saveAttribute(definition, nextValue);
              }
            }}
          >
            <SelectTrigger className="h-6 w-full min-w-0 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent
              align="start"
              className="w-auto min-w-(--anchor-width)"
            >
              {definition.options?.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <CommitInput
            className="h-6 w-full"
            placeholder={definition.placeholder ?? "–"}
            value={decodeIdentityAttribute(rawValue, definition.kind)}
            onCommit={(nextValue) => saveAttribute(definition, nextValue)}
          />
        )}
      </IdentityEditRow>
    );
  });
}

function identityAttributeDefinitions(
  entityType: string,
  schema: string,
): IdentityAttributeDefinition[] {
  if (entityType !== "IFCBUILDINGELEMENTPROXY") {
    return IDENTITY_ATTRIBUTES_BY_TYPE[entityType] ?? [];
  }

  const legacyIfc2x3 = /^IFC2X3/i.test(schema);
  return [
    { argIndex: 4, kind: "text", label: "Objekttyp" },
    { argIndex: 7, kind: "text", label: "Kennzeichen / Tag" },
    {
      argIndex: 8,
      kind: "enum",
      label: legacyIfc2x3 ? "Gliederung" : "Vordefinierter Typ",
      options: legacyIfc2x3
        ? COMPOSITION_TYPE_OPTIONS
        : PROXY_TYPE_OPTIONS,
    },
  ];
}

function decodeIdentityAttribute(rawValue: string, kind: IdentityAttributeKind) {
  if (!rawValue || rawValue === "$" || rawValue === "*") {
    return "";
  }
  if (kind === "text") {
    return unquote(rawValue) ?? rawValue;
  }
  if (kind === "angle") {
    return rawValue.replace(/^\(|\)$/g, "");
  }
  return rawValue;
}

function encodeIdentityAttribute(value: string, kind: IdentityAttributeKind) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "$") {
    return "$";
  }
  if (kind === "text") {
    return quote(trimmed);
  }
  if (kind === "angle") {
    const components = trimmed
      .replace(/^\(|\)$/g, "")
      .split(/[;,\s]+/)
      .filter(Boolean)
      .join(",");
    return components ? `(${components})` : "$";
  }
  if (kind === "number") {
    return trimmed.replace(",", ".");
  }
  return trimmed;
}

export function identityClassOptions(currentType: string) {
  const seen = new Set<string>();
  const options: { label: string; value: string }[] = [];
  for (const value of [currentType, ...ENTITY_TYPES]) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    options.push({ label: shortType(value), value });
  }
  return options;
}
