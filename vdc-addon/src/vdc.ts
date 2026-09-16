import type { ApplyResult, Change, Element, Host, Mapping, Property, Scalar, Snapshot } from './types';

export type VdcApi = Record<string, (...args: any[]) => any>;
export function detectApi(scope: Record<string, any>): VdcApi | null {
  for (const key of ['vdcApp', 'desiteAPI', 'desiteMD']) {
    if (typeof scope[key]?.getAllElements === 'function') return scope[key];
  }
  return null;
}
export function parseProperties(value: unknown): Property[] {
  if (typeof value === 'string') value = JSON.parse(value);
  if (!Array.isArray(value)) throw new Error('VDC liefert keine lesbare Eigenschaftsliste.');
  return value.map((item) => {
    if (!item || typeof item.Name !== 'string' || typeof item.Type !== 'string')
      throw new Error('Unerwartetes VDC-Eigenschaftsformat (Name/Type fehlen).');
    const v = item.Value ?? null;
    if (!['string', 'number', 'boolean'].includes(typeof v) && v !== null)
      throw new Error(`Strukturierter Wert wird nicht unterstützt: ${item.Name}`);
    return { name: item.Name, type: item.Type, value: v, inherited: item.isInherited === true };
  });
}
function ids(value: unknown): string[] {
  if (typeof value === 'string') return value.split(';').filter(Boolean);
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string')) throw new Error('VDC liefert keine Objekt-ID-Liste.');
  return value;
}
function valueOf(props: Property[], names: string[]): string {
  for (const name of names) {
    const found = props.find((p) => p.name === name && p.value != null && p.value !== '');
    if (found) return String(found.value);
  }
  return '';
}
export function elementFromProperties(id: string, modelId: string, properties: Property[], mapping: Mapping): Element {
  return {
    id, modelId, properties,
    name: valueOf(properties, ['cpName', 'Name']) || id,
    ifcClass: valueOf(properties, [mapping.classProperty, 'IFC:Type', 'IFC:Entity', 'ifcType', 'IfcEntity']).toUpperCase(),
    globalId: valueOf(properties, [mapping.guidProperty, 'IFC:GlobalId', 'GlobalId', 'ifcGUID']),
  };
}
const equal = (a: Scalar, b: Scalar) => a === b;
const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);

/** Direct WebForms bridge calls; await also accepts promise-returning host wrappers. */
export class VdcHost implements Host {
  kind = 'vdc' as const;
  constructor(private api: VdcApi) {}
  private async call(name: string, ...args: unknown[]): Promise<any> {
    if (typeof this.api[name] !== 'function') throw new Error(`VDC-Funktion fehlt: ${name}. Version und Lizenz prüfen.`);
    return await this.api[name](...args);
  }
  private async projectId(): Promise<string> {
    // VDC 4.2.1 returns null for GlobalProject/ID in modern WebForms.
    // Use the dedicated project information API; retain the legacy fallback
    // only for hosts where that function is unavailable.
    const id = typeof this.api.getProjectInfo === 'function'
      ? (await this.call('getProjectInfo'))?.ID
      : await this.call('getPropertyValue', 'GlobalProject', 'ID', 'xs:ID', false);
    if (typeof id !== 'string' || !id) throw new Error('Kein aktives VDC-Projekt mit lesbarer Projekt-ID.');
    return id;
  }
  async load(mapping: Mapping, progress = (_done: number, _total: number) => {}): Promise<Snapshot> {
    const projectId = await this.projectId();
    const projectName = String(await this.call('getProjectName'));
    const all = [...new Set(ids(await this.call('getAllElements', 'geometry')))];
    const elements: Element[] = [];
    for (const [index, id] of all.entries()) {
      const properties = parseProperties(await this.call('getPropertyValuesByObject', id, '*'));
      const modelId = await this.call('getModelByElement', id, 'geometry');
      if (typeof modelId !== 'string' || !modelId) throw new Error(`Modellzuordnung fehlt: ${id}`);
      elements.push(elementFromProperties(id, modelId, properties, mapping));
      if (index % 40 === 0) {
        progress(index + 1, all.length);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    if (await this.projectId() !== projectId) throw new Error('Projekt während des Einlesens gewechselt. Bitte neu laden.');
    progress(all.length, all.length);
    return { projectId, projectName, elements, loadedAt: new Date().toISOString() };
  }
  async selected(): Promise<string[]> { return ids(await this.call('getSelectedElements', 'geometry')); }
  async select(elementIds: string[]): Promise<void> {
    if (!elementIds.length) return;
    await this.call('clearSelection', true, 'geometry');
    if (this.api.setElementsSelected) await this.call('setElementsSelected', true, elementIds);
    else await this.call('selectElements', elementIds.join(';'), true, 'geometry');
    await this.call('zoomToSelected');
  }
  /** Preflight the whole plan. A host transaction batches writes; it is NOT rollback. */
  async apply(snapshot: Snapshot, changes: Change[]): Promise<ApplyResult> {
    const applied: Change[] = [];
    let transaction = false;
    let failure: string | undefined;
    try {
      if (await this.projectId() !== snapshot.projectId) throw new Error('Das aktive Projekt hat sich geändert. Bitte neu laden.');
      const seen = new Set<string>();
      for (const change of changes) {
        const key = `${change.elementId}\0${change.propertyName}`;
        if (seen.has(key)) throw new Error('Die Vorschau enthält doppelte Zielzellen.');
        seen.add(key);
        const current = parseProperties(await this.call('getPropertyValuesByObject', change.elementId, '*'));
        const sameName = current.filter((p) => p.name === change.propertyName);
        const p = sameName[0];
        if (sameName.length > 1 || Boolean(p) !== change.existed || (p && (p.type !== change.type || p.inherited || !equal(p.value, change.before))))
          throw new Error(`Zwischenzeitlich geändert oder vererbt: ${change.elementName} / ${change.propertyName}. Bitte neu laden.`);
        if (p && (await this.call('getPropertySource', change.elementId, change.propertyName, change.type, false) ?? null) !== p.value)
          throw new Error(`Berechnete Eigenschaft wird nicht überschrieben: ${change.elementName} / ${change.propertyName}.`);
        if (await this.call('getModelByElement', change.elementId, 'geometry') !== change.modelId)
          throw new Error(`Modellzuordnung geändert: ${change.elementName}. Bitte neu laden.`);
        if (await this.call('isModelReadOnly', change.modelId) !== false)
          throw new Error(`Modell schreibgeschützt oder Status unbekannt: ${change.elementName}.`);
      }
      if (!changes.length) return { applied };
      const opened = await this.call('startProjectTransaction', 'geometry');
      if (typeof opened !== 'number' || opened < 1) throw new Error('VDC-Projekttransaktion konnte nicht geöffnet werden.');
      transaction = true;
      for (const change of changes) {
        if (await this.projectId() !== snapshot.projectId) throw new Error('Projekt während der Bearbeitung gewechselt.');
        const live = parseProperties(await this.call('getPropertyValuesByObject', change.elementId, '*')).filter((p) => p.name === change.propertyName);
        if (live.length > 1 || Boolean(live[0]) !== change.existed || (live[0] && (live[0].inherited || live[0].type !== change.type || live[0].value !== change.before)))
          throw new Error(`Wert während der Bearbeitung geändert: ${change.elementName} / ${change.propertyName}.`);
        if (live[0] && (await this.call('getPropertySource', change.elementId, change.propertyName, change.type, false) ?? null) !== live[0].value)
          throw new Error(`Eigenschaft ist inzwischen berechnet: ${change.elementName} / ${change.propertyName}.`);
        const result = await this.call('setPropertyValue', change.elementId, change.propertyName, change.type, change.after);
        if (result !== 1) throw new Error(`Schreiben abgelehnt (${String(result)}): ${change.elementName} / ${change.propertyName}.`);
        applied.push(change);
      }
    } catch (e) { failure = errorText(e); }
    finally {
      if (transaction) {
        try {
          const remaining = await this.call('endProjectTransaction', 'geometry');
          if (typeof remaining !== 'number' || remaining < 0) throw new Error('Ungültiger Transaktionsstatus');
        } catch (e) { failure = [failure, `Transaktionsabschluss fehlgeschlagen: ${errorText(e)}`].filter(Boolean).join(' '); }
      }
    }
    return { applied, error: failure };
  }
}
