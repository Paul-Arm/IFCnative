import { useId, useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { canAssignNativeMaterial, readReferences, type NativeIfcDocument, type NativeMaterialDraft } from "../../ifc/nativeDocument";
import { unquoteStepString } from "../../ifc/stepEncoding";
import { PanelHeader, PanelShell } from "./ui";
import { MaterialDetails } from "./MaterialDetails";
import { readMaterialAppearances, type MaterialAppearanceDraft, type MaterialPropertyDraft } from "../../ifc/materialEditing";

export function MaterialsPanel({ document, selectedIds, onCreate, onUpdate, onAssign, onAppearance, onProperty }: {
  document: NativeIfcDocument;
  selectedIds: number[];
  onCreate(draft: NativeMaterialDraft): number;
  onUpdate(id: number, draft: NativeMaterialDraft): void;
  onAssign(id: number): void;
  onAppearance(id: number, styleId: number | undefined, draft: MaterialAppearanceDraft): void;
  onProperty(id: number, draft: MaterialPropertyDraft): void;
}) {
  const [query, setQuery] = useState("");
  const [chosenId, setChosenId] = useState<number | null | undefined>();
  const [tab, setTab] = useState("general");
  const materials = useMemo(() => [...(document.entitiesByType.get("IFCMATERIAL") ?? [])]
    .sort((a, b) => a.name.localeCompare(b.name, "de") || a.id - b.id), [document]);
  const colors = useMemo(() => new Map(materials.map((material) => [material.id, readMaterialAppearances(document, material.id)[0]?.color])), [document, materials]);
  const assignedCounts = useMemo(() => {
    const selected = new Set(selectedIds);
    const members = new Map<number, Set<number>>();
    for (const relation of document.entitiesByType.get("IFCRELASSOCIATESMATERIAL") ?? []) {
      const materialId = readReferences(relation.args[5])[0];
      const ids = members.get(materialId) ?? new Set<number>();
      for (const id of readReferences(relation.args[4])) if (selected.has(id)) ids.add(id);
      members.set(materialId, ids);
    }
    return new Map([...members].map(([id, ids]) => [id, ids.size]));
  }, [document, selectedIds]);
  const selected = chosenId === null ? undefined : materials.find((material) => material.id === chosenId)
    ?? materials.find((material) => assignedCounts.get(material.id)) ?? materials[0];
  const selectionCount = selectedIds.filter((id) => canAssignNativeMaterial(document, id)).length;
  const extended = !document.schema.startsWith("IFC2X3");
  const visible = materials.filter((material) => `${material.id} ${material.name} ${material.description} ${unquoteStepString(material.args[2] ?? "$")}`
    .toLocaleLowerCase("de").includes(query.trim().toLocaleLowerCase("de")));

  return <PanelShell scroll>
    <PanelHeader title="Materialien" description={`${materials.length} Materialien · ${selectionCount} Objekte ausgewählt`}
      actions={<Button size="sm" variant="outline" onClick={() => { setChosenId(null); setTab("general"); }}><Plus aria-hidden className="size-3.5" />Neu</Button>} />
    <div className="space-y-4 p-3">
      <div className="relative">
        <Search aria-hidden className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
        <Input className="pl-8" aria-label="Materialien suchen" placeholder="Name, Kategorie oder IFC-ID suchen" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      <div className="max-h-64 space-y-1 overflow-auto rounded-md border p-1" aria-label="IFC-Materialien">
        {visible.map((material) => <button key={material.id} type="button" aria-pressed={selected?.id === material.id}
          className={`flex w-full items-center justify-between gap-3 rounded px-2 py-2 text-left text-xs hover:bg-muted ${selected?.id === material.id ? "bg-primary/10 ring-1 ring-inset ring-primary/30" : ""}`}
          onClick={() => setChosenId(material.id)}>
          <span className="size-6 shrink-0 rounded border" title={colors.get(material.id) ?? "Keine Materialfarbe"} style={{ background: colors.get(material.id) ?? "repeating-conic-gradient(#ddd 0% 25%, white 0% 50%) 0 / 8px 8px" }} />
          <span className="min-w-0"><span className="block truncate font-medium">{material.name || "Unbenanntes Material"}</span>
            <span className="block truncate text-muted-foreground">{unquoteStepString(material.args[2] ?? "$") || "Ohne Kategorie"}</span>
            {assignedCounts.get(material.id) ? <span className="block text-primary">{assignedCounts.get(material.id)} in der Auswahl zugeordnet</span> : null}</span>
          <span className="shrink-0 text-muted-foreground">#{material.id}</span>
        </button>)}
        {!visible.length ? <p className="p-3 text-xs text-muted-foreground">{materials.length ? "Keine passenden Materialien." : "Noch keine IFC-Materialien. Lege das erste Material an."}</p> : null}
      </div>
      {selected ? <Button className="w-full" size="sm" disabled={!selectionCount} onClick={() => onAssign(selected.id)}>Der Auswahl zuordnen ({selectionCount})</Button> : null}
      <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
        <TabsList className="w-full"><TabsTrigger value="general" className="text-xs">Allgemein</TabsTrigger><TabsTrigger value="appearance" className="text-xs" disabled={!selected}>Farbe</TabsTrigger><TabsTrigger value="properties" className="text-xs" disabled={!selected}>Eigenschaften</TabsTrigger></TabsList>
        <TabsContent value="general">
      <MaterialForm key={selected ? `${selected.id}:${selected.args.join("|")}` : "new"}
        initial={{ name: selected?.name ?? "", description: selected?.description ?? "", category: selected ? unquoteStepString(selected.args[2] ?? "$") ?? "" : "" }}
        extended={extended} creating={!selected}
        onSave={(draft) => {
          if (selected) onUpdate(selected.id, draft);
          else { setChosenId(onCreate(draft)); setQuery(""); }
        }} />
      {selected ? <div className="space-y-2 border-t pt-3">
        <p className="text-xs text-muted-foreground">Ersetzt die direkte Materialzuordnung der ausgewählten Objekte. Andere Objekte behalten ihre Zuordnung.</p>
      </div> : null}
        </TabsContent>
        {selected ? (["appearance", "properties"] as const).map((section) => <TabsContent key={section} value={section}><MaterialDetails key={selected.id} document={document} materialId={selected.id} section={section}
          onAppearance={(styleId, draft) => onAppearance(selected.id, styleId, draft)} onProperty={(draft) => onProperty(selected.id, draft)} /></TabsContent>) : null}
      </Tabs>
    </div>
  </PanelShell>;
}

function MaterialForm({ initial, extended, creating, onSave }: {
  initial: NativeMaterialDraft; extended: boolean; creating: boolean; onSave(draft: NativeMaterialDraft): void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(initial);
  const changed = Object.keys(initial).some((key) => initial[key as keyof NativeMaterialDraft] !== draft[key as keyof NativeMaterialDraft]);
  return <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); if (draft.name.trim()) onSave(draft); }}>
    <h3 className="text-sm font-medium">{creating ? "Neues Material" : "Material bearbeiten"}</h3>
    <div className="space-y-1"><label className="text-xs" htmlFor={`${id}-name`}>Name</label>
      <Input id={`${id}-name`} required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></div>
    {extended ? <>
      <div className="space-y-1"><label className="text-xs" htmlFor={`${id}-category`}>Kategorie</label>
        <Input id={`${id}-category`} placeholder="z. B. Beton, Stahl, Holz" value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} /></div>
      <div className="space-y-1"><label className="text-xs" htmlFor={`${id}-description`}>Beschreibung</label>
        <Textarea id={`${id}-description`} rows={3} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></div>
    </> : <p className="text-xs text-muted-foreground">IFC2X3 unterstützt bei Materialien nur den Namen.</p>}
    {!creating ? <p className="text-xs text-muted-foreground">Änderungen gelten überall, wo dieses Material verwendet wird.</p> : null}
    <Button type="submit" size="sm" variant="outline" disabled={!draft.name.trim() || (!creating && !changed)}>{creating ? "Material anlegen" : "Änderungen speichern"}</Button>
  </form>;
}
