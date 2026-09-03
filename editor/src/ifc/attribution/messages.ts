/**
 * Deutsche Befundtexte — wörtlich aus dem Portal-Frontend
 * (services/mkp-portal-extern-frontend/src/utils/ifc-import-issues.ts),
 * gehalten im Schema unter `befunde`. Wer im Editor eine Meldung sieht,
 * sieht beim Upload dieselbe.
 */
import { fachmodellSchema } from "./schema";

export interface PortalIssueFields {
  code: string;
  reason?: string;
  element_name?: string;
  element_type?: string;
  ifc_guid?: string;
  import_role?: string;
  pset_name?: string;
  pset_names?: string[];
  property_name?: string;
  property_names?: string[];
  model_name?: string;
  value?: string;
  count?: number;
  suggestions?: string[];
}

const EMBEDDED_FIELDS: Record<string, string[]> = {
  missing_required_property: ["property_name", "pset_name"],
  missing_pset: ["pset_name"],
  duplicate_ifc_id: ["value"],
  unknown_reference: ["value"],
  unassignable_element: ["pset_name", "property_name"],
  ambiguous_result_target: ["value"],
  unassigned_extended_property_set: ["pset_name"],
  data_conflict: ["value"],
  invalid_date: ["value"],
  invalid_time: ["value"],
  editor_reference_unchecked: ["value"],
  editor_invalid_component_id: ["value"],
  editor_area_method_unused: ["value", "pset_name"],
  editor_method_not_in_area: ["value", "pset_name"],
};

/** Editor-eigene Hinweise (Präfix `editor_`), die das Portal so nicht kennt. */
const EDITOR_MESSAGES: Record<string, string> = {
  editor_reference_unchecked: "Referenz auf {model_name} '{value}' konnte nicht geprüft werden — kein Bauwerksmodell geladen bzw. Ziel nicht in dieser Datei. Das Portal prüft sie beim Upload gegen die Datenbank.",
  editor_invalid_component_id: "Bauteil-ID '{value}' hat nicht sechs Segmente (Bauwerk.Teilbauwerk.Ebene1.Ebene2.Ebene3.Nr).",
  editor_area_method_unused: "Der Untersuchungsbereich nennt das Verfahren '{value}' ({property_name}), aber keine Untersuchungsstelle des Bereichs trägt das zugehörige Pset. Entweder fehlt das Verfahren an einer Stelle oder der Eintrag im Bereich ist veraltet.",
  editor_method_not_in_area: "Die Untersuchungsstelle trägt das Verfahren '{value}' (Pset {pset_name}), ihr Untersuchungsbereich nennt es nicht. Verfahren im Bereich ergänzen oder das Pset prüfen.",
};

function fill(template: string, fields: PortalIssueFields): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = (fields as unknown as Record<string, unknown>)[key];
    if (Array.isArray(value)) return value.join(", ");
    return value == null ? "" : String(value);
  });
}

/** Haupttext eines Befunds, wie ihn das Portal-Frontend rendert. */
export function formatPortalMessage(fields: PortalIssueFields): string {
  const definition = fachmodellSchema.befunde[fields.code];
  if (!definition) {
    const editor = EDITOR_MESSAGES[fields.code];
    return editor ? fill(editor, fields) : fields.code;
  }
  if (fields.code === "unassignable_element") {
    const base = fields.import_role
      ? fill(definition.de, fields)
      : "Das 3D-Element kann der gewählten Importart nicht zugeordnet werden.";
    const reason = fields.reason ? definition.gruende?.[fields.reason] : undefined;
    return `${base} ${
      reason
        ? fill(reason, fields)
        : "Bitte prüfen, ob das Element zur gewählten Importart gehört, die erwarteten PSets besitzt und die Pflichtangaben darin (z. B. die Bauteil-Referenz) gefüllt sind."
    }`;
  }
  if (fields.code === "duplicate_ifc_id" && !fields.value) {
    return `Eine IFC-ID für ${fields.model_name ?? ""} ist mehrfach vergeben. Jede IFC-ID darf nur einmal vorkommen.`;
  }
  if (fields.code === "unknown_reference" && !fields.value) {
    return `${fields.model_name ?? ""} mit der angegebenen ID wurde nicht gefunden. Bitte die Schreibweise der Referenz prüfen.`;
  }
  return fill(definition.de, fields);
}

/** Zeile „Betroffenes IFC-Objekt …", wie im Portal-Frontend. */
export function affectedObjectLine(fields: PortalIssueFields): string | null {
  const details: string[] = [];
  if (fields.element_type) details.push(fields.element_type);
  if (fields.ifc_guid) details.push(`GUID: ${fields.ifc_guid}`);
  if (fields.element_name) {
    return details.length
      ? `Betroffenes IFC-Objekt: '${fields.element_name}' (${details.join(", ")})`
      : `Betroffenes IFC-Objekt: '${fields.element_name}'`;
  }
  return details.length ? `Betroffenes IFC-Objekt: ${details.join(", ")}` : null;
}

/** Kontextzeilen (PSet, vorhandene PSets, Wert, Vorschläge), wie im Portal-Frontend. */
export function contextLines(fields: PortalIssueFields): string[] {
  const embedded = EMBEDDED_FIELDS[fields.code] ?? [];
  const lines: string[] = [];
  const object = affectedObjectLine(fields);
  if (object) lines.push(object);
  if (fields.pset_name && !embedded.includes("pset_name")) lines.push(`PSet: ${fields.pset_name}`);
  if (fields.pset_names?.length) lines.push(`Vorhandene PSets: ${fields.pset_names.join(", ")}`);
  if (fields.value && !embedded.includes("value")) lines.push(`Wert: ${fields.value}`);
  if (fields.suggestions?.length) lines.push(`Meinten Sie: ${fields.suggestions.join(", ")}?`);
  return lines;
}
