import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { NativeIfcDocument } from "../../ifc/nativeDocument";
import {
  MATERIAL_PROPERTY_PRESETS, MATERIAL_UNIT_TYPES, MATERIAL_VALUE_TYPES, materialReflectanceMethods,
  readMaterialAppearances, readMaterialPropertySets, readMaterialPropertyValue,
  type MaterialAppearance, type MaterialAppearanceDraft, type MaterialPropertyDraft,
} from "../../ifc/materialEditing";

const selectClass = "h-8 w-full rounded-md border bg-background px-2 text-xs";

export function MaterialDetails({ document, materialId, section, onAppearance, onProperty }: {
  document: NativeIfcDocument; materialId: number;
  section: "appearance" | "properties";
  onAppearance(styleId: number | undefined, draft: MaterialAppearanceDraft): void;
  onProperty(draft: MaterialPropertyDraft): void;
}) {
  const styles = readMaterialAppearances(document, materialId);
  const sets = readMaterialPropertySets(document, materialId);
  const [edit, setEdit] = useState<MaterialPropertyDraft | null>(null);
  const [newNonce, setNewNonce] = useState(0);
  const errorTypes = new Set<string>();
  for (const entity of document.incomingRefs.get(materialId) ?? []) {
    if (/^IFC.*MATERIALPROPERTIES$/.test(entity.type) && !sets.some((set) => set.id === entity.id)) errorTypes.add(entity.type);
  }
  return <div className="space-y-5 pt-2">
    {section === "appearance" ? <section className="space-y-3" aria-label="Materialdarstellung">
      <h3 className="text-sm font-medium">Farbe & Oberfläche</h3>
      {!styles.length ? <p className="text-xs text-muted-foreground">Noch kein Materialstil gespeichert.</p> : null}
      {(styles.length ? styles : [undefined]).map((style) => <AppearanceForm key={style ? JSON.stringify(style) : "new"}
        initial={style} schema={document.schema} onSave={(draft) => onAppearance(style?.id, draft)} />)}
      <p className="text-xs text-muted-foreground">Die Materialdarstellung wird auf direkt zugeordnete Körper übernommen und ersetzt dort vorhandene Oberflächenfarben.</p>
    </section> : <section className="space-y-3" aria-label="Materialeigenschaften">
      <h3 className="text-sm font-medium">Materialeigenschaften</h3>
      {sets.map((set) => <div key={set.id} className="space-y-1 rounded-md border p-2">
        <h4 className="break-all text-xs font-semibold">{set.name}</h4>
        {set.properties.map((property) => {
          const value = readMaterialPropertyValue(property);
          const editable = property.type === "IFCPROPERTYSINGLEVALUE" && MATERIAL_VALUE_TYPES.includes(value.valueType);
          return <div key={property.id} className="flex items-start justify-between gap-2 border-t py-2 text-xs">
            <div className="min-w-0"><div className="break-words font-medium">{property.name}</div>
              <div className="break-all text-muted-foreground">{editable ? `${value.value} · ${value.valueType}` : property.args.slice(2).join(", ")}</div>
              {property.args[3]?.startsWith("#") && property.type === "IFCPROPERTYSINGLEVALUE" ? <div>Einheit {property.args[3]}</div> : null}
              {!editable ? <p className="mt-1 text-muted-foreground">{property.type}: komplexer Wert, bleibt unverändert erhalten.</p> : null}
            </div>
            {editable ? <Button type="button" size="sm" variant="ghost" aria-label={`${property.name} bearbeiten`} onClick={() => {
              setEdit({ ...value, name: property.name, setName: set.name, setId: set.id, propertyId: property.id, unitId: Number(property.args[3]?.slice(1)) || undefined });
              setNewNonce((value) => value + 1);
            }}>Bearbeiten</Button> : null}
          </div>;
        })}
      </div>)}
      {errorTypes.size ? <p className="text-xs text-muted-foreground">Vordefinierte IFC2X3-Eigenschaften ({[...errorTypes].join(", ")}) bleiben erhalten. Neue Werte werden als erweiterte Materialeigenschaften angelegt.</p> : null}
      <Button size="sm" variant="outline" onClick={() => { setEdit(null); setNewNonce((value) => value + 1); }}>Neue Eigenschaft</Button>
      <PropertyForm key={`${newNonce}:${JSON.stringify(edit)}`} document={document} initial={edit} onSave={(draft) => { onProperty(draft); setEdit(null); setNewNonce((value) => value + 1); }} />
    </section>}
  </div>;
}

function AppearanceForm({ initial, schema, onSave }: { initial?: MaterialAppearance; schema: string; onSave(draft: MaterialAppearanceDraft): void }) {
  const id = useId();
  const [color, setColor] = useState(initial?.color ?? "#cccccc");
  const [transparency, setTransparency] = useState(String((initial?.transparency ?? 0) * 100));
  const [reflectance, setReflectance] = useState(initial?.reflectance ?? "PHONG");
  const [specular, setSpecular] = useState(initial?.specular === undefined ? "" : String(initial.specular));
  const [roughness, setRoughness] = useState(initial?.roughness === undefined ? "" : String(initial.roughness));
  const [error, setError] = useState("");
  return <form className="space-y-3 rounded-md border p-3" onSubmit={(event) => {
    event.preventDefault();
    try { onSave({ color, transparency: Number(transparency) / 100, reflectance, ...(specular === "" ? {} : { specular: Number(specular) }), ...(roughness === "" ? {} : { roughness: Number(roughness) }) }); setError(""); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  }}>
    {initial ? <div className="text-xs text-muted-foreground">{initial.name} · #{initial.id}</div> : null}
    <div className="space-y-1"><label htmlFor={`${id}-color`} className="text-xs">Farbe</label>
      <div className="flex gap-2"><input id={`${id}-color`} className="h-9 w-12 shrink-0 rounded border bg-transparent p-1" type="color" value={/^#[\da-f]{6}$/i.test(color) ? color : "#cccccc"} onChange={(event) => setColor(event.target.value)} />
        <Input aria-label="Farbe als Hexwert" pattern="#[a-fA-F0-9]{6}" required value={color} onChange={(event) => setColor(event.target.value)} /></div></div>
    <div className="space-y-1"><label htmlFor={`${id}-alpha`} className="text-xs">Transparenz (%)</label>
      <Input id={`${id}-alpha`} required type="number" min="0" max="100" step="any" value={transparency} onChange={(event) => setTransparency(event.target.value)} /></div>
    <details><summary className="cursor-pointer text-xs">Oberflächenparameter</summary><div className="mt-3 space-y-3">
      <label className="block space-y-1 text-xs"><span>Reflexionsmodell</span><select className={selectClass} value={reflectance} onChange={(event) => setReflectance(event.target.value)}>{materialReflectanceMethods(schema).map((method) => <option key={method}>{method}</option>)}</select></label>
      <label className="block space-y-1 text-xs"><span>Glanzanteil / Metallanteil (0–1)</span><Input type="number" min="0" max="1" step="any" placeholder="Unverändert / nicht gesetzt" value={specular} onChange={(event) => setSpecular(event.target.value)} /></label>
      <label className="block space-y-1 text-xs"><span>Rauheit (0–1)</span><Input type="number" min="0" max="1" step="any" placeholder="Unverändert / nicht gesetzt" value={roughness} onChange={(event) => setRoughness(event.target.value)} /></label>
      <p className="text-xs text-muted-foreground">Metallanteil gilt für PHYSICAL (IFC4X3). Die Darstellung dieser Parameter hängt vom Viewer ab.</p>
    </div></details>
    {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    <Button type="submit" variant="outline" size="sm">Darstellung speichern</Button>
  </form>;
}

function PropertyForm({ document, initial, onSave }: { document: NativeIfcDocument; initial: MaterialPropertyDraft | null; onSave(draft: MaterialPropertyDraft): void }) {
  const [draft, setDraft] = useState<MaterialPropertyDraft>(initial ?? { setName: "Pset_MaterialCommon", name: "", valueType: "IFCREAL", value: "" });
  const [error, setError] = useState("");
  const units = document.entities.filter((entity) => MATERIAL_UNIT_TYPES.has(entity.type));
  return <form className="space-y-3 rounded-md border p-3" onSubmit={(event) => {
    event.preventDefault();
    try { onSave(draft); setError(""); } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  }}>
    <h4 className="text-xs font-semibold">{initial ? "Eigenschaft bearbeiten" : "Eigenschaft hinzufügen"}</h4>
    {!initial ? <label className="block space-y-1 text-xs"><span>Vorlage</span><select className={selectClass} defaultValue="" onChange={(event) => {
      const preset = MATERIAL_PROPERTY_PRESETS[Number(event.target.value)];
      if (event.target.value !== "" && preset) setDraft({ ...draft, ...preset, unitId: undefined });
    }}><option value="">Freie Eigenschaft</option>{MATERIAL_PROPERTY_PRESETS.map((preset, index) => <option key={preset.name} value={index}>{preset.label}</option>)}</select></label> : null}
    <label className="block space-y-1 text-xs"><span>Property-Set</span><Input required value={draft.setName} disabled={Boolean(initial)} onChange={(event) => setDraft({ ...draft, setName: event.target.value })} /></label>
    <label className="block space-y-1 text-xs"><span>Eigenschaftsname</span><Input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
    <label className="block space-y-1 text-xs"><span>IFC-Datentyp</span><select className={selectClass} value={draft.valueType} onChange={(event) => setDraft({ ...draft, valueType: event.target.value })}>{MATERIAL_VALUE_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>
    <label className="block space-y-1 text-xs"><span>Wert</span><Input required value={draft.value} onChange={(event) => setDraft({ ...draft, value: event.target.value })} /></label>
    <label className="block space-y-1 text-xs"><span>Einheit</span><select className={selectClass} value={draft.unitId ?? ""} onChange={(event) => setDraft({ ...draft, unitId: Number(event.target.value) || undefined })}>
      <option value="">Aus IFC-Datentyp / Projekteinheiten</option>{units.map((unit) => <option key={unit.id} value={unit.id}>#{unit.id} · {unit.name || unit.args.join(", ")}</option>)}
    </select></label>
    {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    <Button type="submit" variant="outline" size="sm">Eigenschaft speichern</Button>
  </form>;
}
