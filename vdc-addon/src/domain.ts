import type { NativeIfcDocument, NativeIfcEntity, NativeIfcPropertySet } from '../../editor/src/ifc/nativeDocument';
import { quoteStepString } from '../../editor/src/ifc/stepEncoding';
import { runPortalCheck } from '../../editor/src/ifc/attribution/portalCheck';
import { cleanValue, getProperty, psetMatches, stripPsetPrefix, stripPropertyPrefix } from '../../editor/src/ifc/attribution/normalize';
import { activeSchema, katalogFor, type Importart } from '../../editor/src/ifc/attribution/schema';
import type { Change, Element, Finding, Mapping, Scalar, Snapshot } from './types';

export function splitProperty(name: string, mapping: Mapping): [string, string] | null {
  const i = name.lastIndexOf(mapping.separator);
  return i > 0 && i + mapping.separator.length < name.length
    ? [name.slice(0, i), name.slice(i + mapping.separator.length)] : null;
}
/** Read-only projection: synthetic IDs never leave this module as VDC IDs. */
export function projectDocument(elements: Element[], mapping: Mapping, fileName: string) {
  const doc: NativeIfcDocument = {
    fileName, schema: 'IFC4', headerText: '', entities: [], entityById: new Map(), entitiesByType: new Map(),
    outgoingRefs: new Map(), incomingRefs: new Map(), relationships: [], relationshipsByEntity: new Map(),
    propertySetsByEntity: new Map(), typeAssignmentsByEntity: new Map(), resourcesByEntity: new Map(),
    units: [], spatialRoots: [], diagnostics: [],
  };
  const hostIds = new Map<number, Element>();
  let propertyId = elements.length + 1;
  for (const [index, source] of elements.entries()) {
    if (!/^IFC[A-Z0-9]+$/.test(source.ifcClass)) continue;
    const id = index + 1;
    // No representation is invented. Geometry-dependent assignability is explicitly not covered.
    const entity: NativeIfcEntity = { id, type: source.ifcClass, globalId: source.globalId, name: source.name, description: '', args: [] };
    doc.entities.push(entity); doc.entityById.set(id, entity); hostIds.set(id, source);
    const sameType = doc.entitiesByType.get(entity.type) ?? [];
    sameType.push(entity); doc.entitiesByType.set(entity.type, sameType);
    const sets = new Map<string, NativeIfcPropertySet>();
    for (const prop of source.properties) {
      const path = splitProperty(prop.name, mapping);
      if (!path) continue;
      const [pset, name] = path;
      const set = sets.get(pset) ?? { id: propertyId++, kind: 'IFCPROPERTYSET', name: pset, values: [] };
      sets.set(pset, set);
      // Quote scalars so literal apostrophes and STEP-looking strings survive normalization.
      set.values.push({ id: propertyId++, name, value: quoteStepString(prop.value == null ? '' : String(prop.value)), type: prop.type });
    }
    doc.propertySetsByEntity.set(id, [...sets.values()]);
  }
  return { doc, hostIds };
}

export function checkSnapshot(snapshot: Snapshot, modelId: string, referenceModels: string[], phase: Importart, mapping: Mapping, loi: number): Finding[] {
  const elements = snapshot.elements.filter((e) => e.modelId === modelId);
  if (!elements.length) throw new Error('Das Prüfmodell enthält keine geladenen Objekte.');
  const { doc, hostIds } = projectDocument(elements, mapping, modelId);
  const refs = referenceModels.filter((id) => id !== modelId).map((id) => projectDocument(snapshot.elements.filter((e) => e.modelId === id), mapping, id).doc);
  const result: Finding[] = [];
  for (const e of elements) {
    if (!/^IFC[A-Z0-9]+$/.test(e.ifcClass)) result.push({ severity: 'warning', code: 'adapter-ifc-class', elementId: e.id, elementName: e.name, message: 'IFC-Klasse nicht erkannt. Objekt fachlich ungeprüft; Eigenschaftszuordnung prüfen.' });
  }
  if (!doc.entities.length) return result;
  result.push(...runPortalCheck(doc, { importart: phase, bauwerksmodelle: refs }).findings.map((f): Finding => {
    const e = f.entityId === undefined ? undefined : hostIds.get(f.entityId);
    return { severity: f.severity, code: f.code, message: f.message, elementId: e?.id, elementName: e?.name, pset: f.pset_name, property: f.property_name };
  }));
  const phaseTrade: Record<string, string> = { planung: 'UP', einzelergebnisse: 'EE', ergebnisse: 'UE' };
  const catalog = katalogFor(phase);
  const seen = new Set<string>();
  // Check catalog fields on existing matching Psets. Never guess a catalog class from IFC class alone.
  for (const [id, e] of hostIds) {
    for (const set of doc.propertySetsByEntity.get(id) ?? []) {
      for (const cls of catalog?.objektklassen ?? []) {
        for (const rules of cls.psets) {
          if (!psetMatches(set.name, rules.familie || rules.portalName || rules.name)) continue;
          for (const rule of rules.properties) {
            if (!rule.pflicht || (rule.loi.length && !rule.loi.includes(loi)) ||
              (phaseTrade[phase] && rule.gewerk.length && !rule.gewerk.includes(phaseTrade[phase]))) continue;
            const key = `${e.id}\0${set.name}\0${rule.name}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const hit = getProperty(set, rule.name);
            if (!hit?.value) result.push({ severity: 'error', code: 'catalog-required', message: `Pflichtwert fehlt: ${set.name}.${rule.name} (LoI ${loi}).`, elementId: e.id, elementName: e.name, pset: set.name, property: rule.name });
          }
        }
      }
    }
  }
  result.push({ severity: 'info', code: 'coverage', message: 'Geprüft: Fachattribute, IDs und Referenzen sowie Katalog-Pflichtwerte vorhandener Psets. Nicht geprüft: IFC-Geometrie, geometrieabhängige Zuordenbarkeit, vollständige IDS-Konformität und Portal-Datenbank.' });
  return result;
}

export function parseValue(draft: string, type: string): Scalar {
  if (type === 'xs:string') return draft;
  if (type === 'xs:boolean') {
    const s = draft.trim().toLowerCase();
    if (['true', 'wahr', '1'].includes(s)) return true;
    if (['false', 'falsch', '0'].includes(s)) return false;
    throw new Error('Boolescher Wert erwartet: wahr oder falsch.');
  }
  if (!['xs:long', 'xs:integer', 'xs:int', 'xs:double', 'xs:float', 'xs:decimal'].includes(type))
    throw new Error(`Datentyp wird nicht bearbeitet: ${type}`);
  const s = draft.trim().replace(',', '.');
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(s)) throw new Error('Gültige Zahl erwartet.');
  const n = Number(s);
  if (!Number.isFinite(n) || (['xs:long', 'xs:integer', 'xs:int'].includes(type) && !Number.isSafeInteger(n)))
    throw new Error('Zahl liegt außerhalb des unterstützten Wertebereichs.');
  if (type === 'xs:int' && (n < -2147483648 || n > 2147483647)) throw new Error('Wert liegt außerhalb von xs:int.');
  return n;
}

export function planChanges(snapshot: Snapshot, selected: string[], mapping: Mapping, pset: string, property: string, type: string, draft: string, mode: 'empty' | 'all'): { changes: Change[]; skipped: number } {
  pset = pset.trim(); property = property.trim();
  if (!mapping.separator || !pset || !property || pset.includes(mapping.separator) || property.includes(mapping.separator) || /[\r\n\0]/.test(pset + property))
    throw new Error('Pset und Merkmal müssen eindeutige Namen ohne Trennzeichen sein.');
  if (/^cp/i.test(pset) || /[\\[\]()*+?|]/.test(pset)) throw new Error('Einen konkreten Pset-Namen verwenden (keine Muster oder Systemfelder).');
  if (!selected.length) throw new Error('Zuerst Objekte für die Bearbeitung auswählen.');
  const after = parseValue(draft, type);
  const changes: Change[] = [];
  let skipped = 0;
  const wanted = new Set(selected);
  for (const e of snapshot.elements.filter((e) => wanted.has(e.id))) {
    const matchSets = [...new Set(e.properties.map((p) => splitProperty(p.name, mapping)?.[0]).filter((s): s is string => Boolean(s) && stripPsetPrefix(s!) === stripPsetPrefix(pset)))];
    if (matchSets.length > 1) throw new Error(`Mehrdeutige Pset-Aliase an ${e.name}; zuerst bereinigen.`);
    const actualSet = matchSets[0] ?? pset;
    const normalized = stripPropertyPrefix(property).toLowerCase();
    const candidates = e.properties.filter((p) => {
      const path = splitProperty(p.name, mapping);
      if (!path || path[0] !== actualSet) return false;
      const name = stripPropertyPrefix(path[1]).toLowerCase();
      return name === normalized || name.startsWith(normalized + '_');
    });
    if (candidates.length > 1) throw new Error(`Mehrdeutiges Merkmal an ${e.name}: ${property}.`);
    const existing = candidates[0];
    if (existing?.inherited) { skipped++; continue; }
    if (existing && existing.type !== type) throw new Error(`Datentyp an ${e.name} ist ${existing.type}; passende Auswahl verwenden.`);
    if (mode === 'empty' && existing && cleanValue(String(existing.value ?? ''))) { skipped++; continue; }
    if (existing?.value === after) { skipped++; continue; }
    changes.push({ elementId: e.id, modelId: e.modelId, elementName: e.name, propertyName: existing?.name ?? `${actualSet}${mapping.separator}${property}`, type, before: existing?.value ?? null, existed: Boolean(existing), after });
  }
  if (snapshot.elements.filter((e) => wanted.has(e.id)).length !== wanted.size) throw new Error('Auswahl enthält nicht geladene Objekte. Bitte neu laden.');
  return { changes, skipped };
}

export function catalogFields(phase: Importart): Array<{ pset: string; property: string; type: string }> {
  const types: Record<string, string> = { IfcReal: 'xs:double', IfcInteger: 'xs:long', IfcBoolean: 'xs:boolean' };
  const rows = new Map<string, { pset: string; property: string; type: string }>();
  for (const cls of katalogFor(phase)?.objektklassen ?? []) for (const p of cls.psets) for (const r of p.properties) {
    const pset = p.name;
    rows.set(`${pset}.${r.name}`, { pset, property: r.name, type: types[r.typ] ?? 'xs:string' });
  }
  return [...rows.values()];
}

export function validateSchemaShape(schema: ReturnType<typeof activeSchema>): void {
  for (const catalog of [schema.katalog.bwd, schema.katalog.mon]) {
    for (const cls of catalog.objektklassen) {
      if (!Array.isArray(cls.psets)) throw new Error('Schema: Pset-Liste fehlt.');
      for (const pset of cls.psets) {
        if (typeof pset.name !== 'string' || typeof pset.portalName !== 'string' || !Array.isArray(pset.properties)) throw new Error('Schema: ungültiger Pset.');
        if (pset.familie) new RegExp(`^(?:${pset.familie})$`);
        for (const p of pset.properties) if (typeof p.name !== 'string' || typeof p.typ !== 'string' || !Array.isArray(p.loi) || !Array.isArray(p.gewerk)) throw new Error('Schema: ungültiges Merkmal.');
      }
    }
  }
  for (const v of schema.verfahren) {
    if (typeof v.pset !== 'string' || !Array.isArray(v.erweitert) || !Array.isArray(v.nurAusfuehrung)) throw new Error('Schema: ungültiges Verfahren.');
    for (const regex of [v.pset, ...v.erweitert, ...v.nurAusfuehrung]) new RegExp(`^(?:${regex})$`);
  }
}
