import { assignNativeMaterial, getNativeBodyRepresentation, getNextNativeEntityId, readReferences, rebuildNativeDocument, type NativeIfcDocument, type NativeIfcEntity } from "./nativeDocument";
import { quoteStepString, unquoteStepString } from "./stepEncoding";

export interface MaterialAppearanceDraft {
  color: string;
  transparency: number;
  reflectance: string;
  specular?: number;
  roughness?: number;
}
export interface MaterialAppearance extends MaterialAppearanceDraft { id: number; name: string }
const styleTypes = new Set(["IFCSTYLEDREPRESENTATION", "IFCSTYLEDITEM", "IFCPRESENTATIONSTYLEASSIGNMENT", "IFCSURFACESTYLE", "IFCSURFACESTYLERENDERING", "IFCSURFACESTYLESHADING"]);
const ratio = (value: string | undefined) => {
  if (!value || value === "$") return undefined;
  const n = Number(value.replace(/^IFC(?:NORMALISEDRATIOMEASURE|SPECULARROUGHNESS)\((.*)\)$/i, "$1"));
  return Number.isFinite(n) ? n : undefined;
};
const materialDefinitions = (doc: NativeIfcDocument, id: number) => (doc.incomingRefs.get(id) ?? [])
  .filter((entity) => entity.type === "IFCMATERIALDEFINITIONREPRESENTATION" && readReferences(entity.args[3])[0] === id);

export function readMaterialAppearances(doc: NativeIfcDocument, materialId: number): MaterialAppearance[] {
  const seen = new Set<number>();
  const result: MaterialAppearance[] = [];
  const visit = (id: number, name: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const entity = doc.entityById.get(id);
    if (!entity || !styleTypes.has(entity.type)) return;
    if (entity.type === "IFCSURFACESTYLE") name = entity.name || name;
    if (entity.type === "IFCSURFACESTYLERENDERING" || entity.type === "IFCSURFACESTYLESHADING") {
      const color = doc.entityById.get(readReferences(entity.args[0])[0]);
      const hex = color?.type === "IFCCOLOURRGB" ? "#" + color.args.slice(1, 4).map((v) => Math.round(Math.max(0, Math.min(1, Number(v))) * 255).toString(16).padStart(2, "0")).join("") : "#cccccc";
      result.push({ id, name: name || `Stil #${id}`, color: hex, transparency: ratio(entity.args[1]) ?? 0,
        reflectance: entity.args[8]?.replaceAll(".", "") ?? "NOTDEFINED", specular: ratio(entity.args[6]),
        roughness: entity.args[7]?.startsWith("IFCSPECULARROUGHNESS(") ? ratio(entity.args[7]) : undefined });
      return;
    }
    for (const ref of entity.args.flatMap(readReferences)) visit(ref, name);
  };
  for (const definition of materialDefinitions(doc, materialId)) for (const id of readReferences(definition.args[2])) visit(id, definition.name);
  return result;
}

export function materialReflectanceMethods(schema: string) {
  return ["NOTDEFINED", "PHONG", "BLINN", "FLAT", "GLASS", "MATT", "METAL", "MIRROR", "STRAUSS", ...(schema.startsWith("IFC4X3") ? ["PHYSICAL"] : [])];
}

/** Copy the selected material's style path, retaining other materials and texture/lighting data. */
export function updateMaterialAppearance(doc: NativeIfcDocument, materialId: number, styleId: number | undefined, draft: MaterialAppearanceDraft) {
  if (doc.entityById.get(materialId)?.type !== "IFCMATERIAL") throw new Error("Material nicht gefunden.");
  if (!/^#[\da-f]{6}$/i.test(draft.color)) throw new Error("Farbe als #RRGGBB eingeben.");
  for (const value of [draft.transparency, draft.specular, draft.roughness]) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1)) throw new Error("Oberflächenwerte müssen zwischen 0 und 1 liegen.");
  }
  if (!materialReflectanceMethods(doc.schema).includes(draft.reflectance)) throw new Error("Ungültiges Reflexionsmodell für dieses IFC-Schema.");
  if (styleId !== undefined && !readMaterialAppearances(doc, materialId).some((style) => style.id === styleId)) throw new Error("Der Materialstil wurde inzwischen geändert.");
  let nextId = getNextNativeEntityId(doc);
  const added: NativeIfcEntity[] = [];
  const add = (type: string, args: string[]) => {
    const id = nextId++;
    added.push({ id, type, args, name: "", description: "", globalId: "" });
    return id;
  };
  const colorId = add("IFCCOLOURRGB", ["$", ...[1, 3, 5].map((offset) => String(parseInt(draft.color.slice(offset, offset + 2), 16) / 255))]);
  const old = styleId === undefined ? undefined : doc.entityById.get(styleId);
  const args = old?.type === "IFCSURFACESTYLERENDERING" ? [...old.args] : ["$", "$", "$", "$", "$", "$", "$", "$", ".NOTDEFINED."];
  args[0] = `#${colorId}`;
  args[1] = String(draft.transparency);
  // A separate RGB diffuse colour would otherwise mask the newly selected colour.
  if (readReferences(args[2]).length) args[2] = `#${colorId}`;
  args[8] = `.${draft.reflectance}.`;
  if (draft.specular !== undefined) args[6] = `IFCNORMALISEDRATIOMEASURE(${draft.specular})`;
  if (draft.roughness !== undefined) args[7] = `IFCSPECULARROUGHNESS(${draft.roughness})`;
  const renderingId = add("IFCSURFACESTYLERENDERING", args);
  let entities = [...doc.entities];
  if (styleId !== undefined) {
    const cloned = new Map<number, number>([[styleId, renderingId]]);
    const clonePath = (id: number): number => {
      if (cloned.has(id)) return cloned.get(id)!;
      const entity = doc.entityById.get(id);
      if (!entity || !styleTypes.has(entity.type)) return id;
      // IFC style paths are acyclic; mark before descending to tolerate malformed imports.
      cloned.set(id, id);
      const replacements = new Map<number, number>();
      for (const ref of entity.args.flatMap(readReferences)) replacements.set(ref, clonePath(ref));
      const changed = [...replacements].some(([before, after]) => before !== after);
      if (!changed) return id;
      const mapped = entity.args.map((arg) => replaceRefs(arg, replacements));
      const result = add(entity.type, mapped);
      cloned.set(id, result);
      return result;
    };
    const definitions = new Set(materialDefinitions(doc, materialId).map((entity) => entity.id));
    entities = entities.map((entity) => {
      if (!definitions.has(entity.id)) return entity;
      const args = [...entity.args];
      args[2] = replaceRefs(args[2], new Map(readReferences(args[2]).map((id) => [id, clonePath(id)])));
      return { ...entity, args };
    });
  } else {
    const context = doc.entitiesByType.get("IFCGEOMETRICREPRESENTATIONCONTEXT")?.[0];
    if (!context) throw new Error("Für die Materialdarstellung fehlt ein geometrischer IFC-Kontext.");
    const name = quoteStepString(doc.entityById.get(materialId)!.name || "Material");
    const surface = add("IFCSURFACESTYLE", [name, ".BOTH.", `(#${renderingId})`]);
    const style = doc.schema.startsWith("IFC2X3") ? add("IFCPRESENTATIONSTYLEASSIGNMENT", [`(#${surface})`]) : surface;
    const item = add("IFCSTYLEDITEM", ["$", `(#${style})`, name]);
    const representation = add("IFCSTYLEDREPRESENTATION", [`#${context.id}`, "'Style'", "'Material'", `(#${item})`]);
    const definition = materialDefinitions(doc, materialId)[0];
    if (definition) {
      entities = entities.map((entity) => {
        if (entity.id !== definition.id) return entity;
        const args = [...entity.args];
        args[2] = `(${[...readReferences(args[2]), representation].map((id) => `#${id}`).join(",")})`;
        return { ...entity, args };
      });
    } else add("IFCMATERIALDEFINITIONREPRESENTATION", [name, "$", `(#${representation})`, `#${materialId}`]);
  }
  const updated = rebuildNativeDocument(doc, [...entities, ...added]);
  const productIds = (updated.entitiesByType.get("IFCRELASSOCIATESMATERIAL") ?? [])
    .filter((relation) => readReferences(relation.args[5])[0] === materialId)
    .flatMap((relation) => readReferences(relation.args[4]));
  return applyMaterialAppearanceToProducts(updated, materialId, productIds);
}

/** Assigning an existing material also replaces conflicting per-object surface styles. */
export function assignMaterialWithAppearance(doc: NativeIfcDocument, ids: Iterable<number>, materialId: number) {
  const selected = [...new Set(ids)];
  return applyMaterialAppearanceToProducts(assignNativeMaterial(doc, selected, materialId), materialId, selected);
}

/**
 * IFC imports frequently style the BRep or mapped source directly. Merely adding
 * IfcRelAssociatesMaterial cannot override those styles. Copy only the geometry
 * paths that need a new style, so shared representations keep their other users.
 * Coordinates, placements and mapping transforms are preserved verbatim.
 */
export function applyMaterialAppearanceToProducts(doc: NativeIfcDocument, materialId: number, ids: Iterable<number>) {
  const surfaces = new Set<number>();
  const visited = new Set<number>();
  const visitStyle = (id: number) => {
    if (visited.has(id)) return;
    visited.add(id);
    const entity = doc.entityById.get(id);
    if (!entity || !styleTypes.has(entity.type)) return;
    if (entity.type === "IFCSURFACESTYLE") { surfaces.add(id); return; }
    for (const ref of entity.args.flatMap(readReferences)) visitStyle(ref);
  };
  for (const definition of materialDefinitions(doc, materialId)) for (const ref of readReferences(definition.args[2])) visitStyle(ref);
  if (!surfaces.size) return doc;
  const selected = new Set(ids);
  const targets = doc.entities.filter((entity) => selected.has(entity.id) && getNativeBodyRepresentation(doc, entity.id).canAssign &&
    doc.entityById.get(readReferences(entity.args[6])[0])?.type === "IFCPRODUCTDEFINITIONSHAPE");
  if (!targets.length) return doc;
  const styledItems = new Map<number, NativeIfcEntity[]>();
  const indexedItems = new Set<number>();
  for (const entity of doc.entities) {
    if (entity.type === "IFCSTYLEDITEM") {
      const target = readReferences(entity.args[0])[0];
      if (target) styledItems.set(target, [...(styledItems.get(target) ?? []), entity]);
    } else if (entity.type === "IFCINDEXEDCOLOURMAP" || entity.type.startsWith("IFCINDEXED") && entity.type.endsWith("TEXTUREMAP")) {
      // MappedTo is the second attribute for indexed colour/texture maps.
      const target = readReferences(entity.args[1])[0];
      if (target) indexedItems.add(target);
    }
  }
  let nextId = getNextNativeEntityId(doc);
  const added: NativeIfcEntity[] = [];
  const add = (type: string, args: string[]) => {
    const id = nextId++;
    added.push({ id, type, args, name: "", description: "", globalId: "" });
    return id;
  };
  const flattenStyles = (id: number): number[] => {
    const entity = doc.entityById.get(id);
    return entity?.type === "IFCPRESENTATIONSTYLEASSIGNMENT" ? readReferences(entity.args[0]) : [id];
  };
  const cloned = new Map<number, number>();
  const forcedItems = new Set<number>();
  const copyPath = (id: number): number => {
    if (cloned.has(id)) return cloned.get(id)!;
    const entity = doc.entityById.get(id);
    if (!entity || entity.type.startsWith("IFCGEOMETRICREPRESENTATION") || entity.type === "IFCLOCALPLACEMENT") return id;
    cloned.set(id, id);
    if (entity.type === "IFCSHAPEREPRESENTATION") {
      for (const item of readReferences(entity.args[3])) forcedItems.add(item);
    }
    const oldStyles = (styledItems.get(id) ?? []).flatMap((item) => readReferences(item.args[1]).flatMap(flattenStyles));
    const oldSurfaces = oldStyles.filter((ref) => doc.entityById.get(ref)?.type === "IFCSURFACESTYLE");
    const needsStyle = (forcedItems.has(id) || oldSurfaces.length > 0 || indexedItems.has(id)) &&
      (indexedItems.has(id) || oldSurfaces.length !== surfaces.size || oldSurfaces.some((ref) => !surfaces.has(ref)));
    const replacements = new Map<number, number>();
    for (const ref of entity.args.flatMap(readReferences)) replacements.set(ref, copyPath(ref));
    if (!needsStyle && ![...replacements].some(([before, after]) => before !== after)) return id;
    const copiedId = add(entity.type, entity.args.map((arg) => replaceRefs(arg, replacements)));
    cloned.set(id, copiedId);
    const preserved = oldStyles.filter((ref) => doc.entityById.get(ref)?.type !== "IFCSURFACESTYLE");
    const newStyles = needsStyle ? [...new Set([...preserved, ...surfaces])] : [...new Set(oldStyles)];
    if (newStyles.length) {
      const styles = doc.schema.startsWith("IFC2X3") ? [add("IFCPRESENTATIONSTYLEASSIGNMENT", [`(${newStyles.map((ref) => `#${ref}`).join(",")})`])] : newStyles;
      add("IFCSTYLEDITEM", [`#${copiedId}`, `(${styles.map((ref) => `#${ref}`).join(",")})`, "$"]);
    }
    return copiedId;
  };
  const shapes = new Map<number, number>();
  for (const target of targets) {
    const shape = readReferences(target.args[6])[0];
    if (shape) shapes.set(target.id, copyPath(shape));
  }
  if (!added.length) return doc;
  const entities = doc.entities.map((entity) => {
    const shape = shapes.get(entity.id);
    if (shape && shape !== readReferences(entity.args[6])[0]) {
      const args = [...entity.args]; args[6] = `#${shape}`;
      return { ...entity, args };
    }
    if (entity.type === "IFCPRESENTATIONLAYERASSIGNMENT" || entity.type === "IFCPRESENTATIONLAYERWITHSTYLE") {
      const oldMembers = readReferences(entity.args[2]);
      const newMembers = oldMembers.flatMap((id) => cloned.has(id) && cloned.get(id) !== id ? [cloned.get(id)!] : []);
      if (newMembers.length) {
        const args = [...entity.args]; args[2] = `(${[...new Set([...oldMembers, ...newMembers])].map((id) => `#${id}`).join(",")})`;
        return { ...entity, args };
      }
    }
    return entity;
  });
  return rebuildNativeDocument(doc, [...entities, ...added]);
}

// Replace STEP references without treating quoted text as references.
function replaceRefs(arg: string, replacements: Map<number, number>) {
  return arg.replace(/'(?:[^']|'')*'|#(\d+)/g, (text, id: string | undefined) => id === undefined ? text : `#${replacements.get(Number(id)) ?? id}`);
}

export interface MaterialPropertySet { id: number; name: string; properties: NativeIfcEntity[]; legacy: boolean }
export function readMaterialPropertySets(doc: NativeIfcDocument, materialId: number): MaterialPropertySet[] {
  return (doc.incomingRefs.get(materialId) ?? []).flatMap((entity) => {
    const legacy = entity.type === "IFCEXTENDEDMATERIALPROPERTIES";
    if ((!legacy && entity.type !== "IFCMATERIALPROPERTIES") || readReferences(entity.args[legacy ? 0 : 3])[0] !== materialId) return [];
    return [{ id: entity.id, name: unquoteStepString(entity.args[legacy ? 3 : 0]) || `Eigenschaften #${entity.id}`, legacy,
      properties: readReferences(entity.args[legacy ? 1 : 2]).flatMap((id) => doc.entityById.get(id) ?? []) }];
  });
}

export const MATERIAL_VALUE_TYPES = ["IFCLABEL", "IFCTEXT", "IFCIDENTIFIER", "IFCBOOLEAN", "IFCLOGICAL", "IFCINTEGER", "IFCREAL", "IFCLENGTHMEASURE", "IFCAREAMEASURE", "IFCVOLUMEMEASURE", "IFCMASSDENSITYMEASURE", "IFCTHERMALCONDUCTIVITYMEASURE", "IFCSPECIFICHEATCAPACITYMEASURE", "IFCMODULUSOFELASTICITYMEASURE", "IFCPRESSUREMEASURE", "IFCPOSITIVERATIOMEASURE", "IFCNORMALISEDRATIOMEASURE", "IFCTHERMODYNAMICTEMPERATUREMEASURE", "IFCTHERMALEXPANSIONCOEFFICIENTMEASURE"];
export interface MaterialPropertyDraft { setId?: number; propertyId?: number; setName: string; name: string; valueType: string; value: string; unitId?: number }
export const MATERIAL_PROPERTY_PRESETS = [
  { label: "Dichte", setName: "Pset_MaterialCommon", name: "MassDensity", valueType: "IFCMASSDENSITYMEASURE" },
  { label: "Wärmeleitfähigkeit", setName: "Pset_MaterialThermal", name: "ThermalConductivity", valueType: "IFCTHERMALCONDUCTIVITYMEASURE" },
  { label: "Spezifische Wärmekapazität", setName: "Pset_MaterialThermal", name: "SpecificHeatCapacity", valueType: "IFCSPECIFICHEATCAPACITYMEASURE" },
  { label: "Elastizitätsmodul", setName: "Pset_MaterialMechanical", name: "YoungModulus", valueType: "IFCMODULUSOFELASTICITYMEASURE" },
  { label: "Querdehnzahl", setName: "Pset_MaterialMechanical", name: "PoissonRatio", valueType: "IFCPOSITIVERATIOMEASURE" },
];

export function readMaterialPropertyValue(property: NativeIfcEntity) {
  const match = property.args[2]?.match(/^(IFC[A-Z0-9_]+)\((.*)\)$/s);
  return { valueType: match?.[1] ?? "IFCLABEL", value: match ? unquoteStepString(match[2]) ?? match[2] : "" };
}

export function saveMaterialProperty(doc: NativeIfcDocument, materialId: number, draft: MaterialPropertyDraft) {
  if (doc.entityById.get(materialId)?.type !== "IFCMATERIAL") throw new Error("Material nicht gefunden.");
  if (!draft.name.trim() || !draft.setName.trim()) throw new Error("Eigenschaft und Property-Set benötigen einen Namen.");
  if (!MATERIAL_VALUE_TYPES.includes(draft.valueType)) throw new Error("Dieser IFC-Datentyp wird im Formular nicht unterstützt.");
  let value = draft.value.trim();
  if (["IFCLABEL", "IFCTEXT", "IFCIDENTIFIER"].includes(draft.valueType)) value = quoteStepString(draft.value);
  else if (draft.valueType === "IFCBOOLEAN" || draft.valueType === "IFCLOGICAL") {
    const v = value.toUpperCase().replaceAll(".", "");
    value = ["TRUE", "T"].includes(v) ? ".T." : ["FALSE", "F"].includes(v) ? ".F." : draft.valueType === "IFCLOGICAL" && ["UNKNOWN", "U"].includes(v) ? ".U." : "";
    if (!value) throw new Error("Boolescher Wert: TRUE oder FALSE (LOGICAL zusätzlich UNKNOWN).");
  } else {
    const n = Number(value.replace(",", "."));
    if (!value || !Number.isFinite(n) || (draft.valueType === "IFCINTEGER" && !Number.isInteger(n))) throw new Error("Bitte einen gültigen Zahlenwert eingeben.");
    if ((draft.valueType === "IFCPOSITIVERATIOMEASURE" && n <= 0) || (draft.valueType === "IFCNORMALISEDRATIOMEASURE" && (n < 0 || n > 1))) throw new Error("Wert außerhalb des IFC-Wertebereichs.");
    value = String(n);
  }
  if (draft.unitId && !MATERIAL_UNIT_TYPES.has(doc.entityById.get(draft.unitId)?.type ?? "")) throw new Error("Ungültige IFC-Einheit.");
  const sets = readMaterialPropertySets(doc, materialId);
  const set = draft.setId === undefined ? sets.find((set) => set.name === draft.setName.trim()) : sets.find((set) => set.id === draft.setId);
  if (draft.setId !== undefined && !set) throw new Error("Property-Set nicht mehr vorhanden.");
  const property = draft.propertyId === undefined ? set?.properties.find((prop) => prop.name === draft.name.trim()) : set?.properties.find((prop) => prop.id === draft.propertyId);
  if (draft.propertyId !== undefined && !property) throw new Error("Eigenschaft nicht mehr vorhanden.");
  if (set?.properties.some((entry) => entry.id !== property?.id && entry.name === draft.name.trim())) throw new Error("Eine Eigenschaft mit diesem Namen existiert bereits im Property-Set.");
  if (property && property.type !== "IFCPROPERTYSINGLEVALUE") throw new Error("Komplexe Eigenschaft bleibt unverändert. Bitte einen anderen Namen verwenden.");
  let nextId = getNextNativeEntityId(doc);
  const propertyId = nextId++;
  const args = [quoteStepString(draft.name.trim()), property?.args[1] ?? "$", `${draft.valueType}(${value})`, draft.unitId ? `#${draft.unitId}` : "$"];
  if (property && args.every((arg, index) => arg === property.args[index])) return doc;
  const added: NativeIfcEntity[] = [{ id: propertyId, type: "IFCPROPERTYSINGLEVALUE", args, name: "", globalId: "", description: "" }];
  let entities = [...doc.entities];
  if (set) {
    const ids = set.properties.map((entry) => entry.id === property?.id ? propertyId : entry.id);
    if (!property) ids.push(propertyId);
    entities = entities.map((entity) => {
      if (entity.id !== set.id) return entity;
      const args = [...entity.args];
      args[set.legacy ? 1 : 2] = `(${ids.map((id) => `#${id}`).join(",")})`;
      return { ...entity, args };
    });
  } else {
    const legacy = doc.schema.startsWith("IFC2X3");
    added.push({ id: nextId, type: legacy ? "IFCEXTENDEDMATERIALPROPERTIES" : "IFCMATERIALPROPERTIES", name: "", globalId: "", description: "",
      args: legacy ? [`#${materialId}`, `(#${propertyId})`, "$", quoteStepString(draft.setName.trim())] : [quoteStepString(draft.setName.trim()), "$", `(#${propertyId})`, `#${materialId}`] });
  }
  return rebuildNativeDocument(doc, [...entities, ...added]);
}

export const MATERIAL_UNIT_TYPES = new Set(["IFCSIUNIT", "IFCCONVERSIONBASEDUNIT", "IFCCONVERSIONBASEDUNITWITHOFFSET", "IFCDERIVEDUNIT", "IFCCONTEXTDEPENDENTUNIT", "IFCMONETARYUNIT"]);
