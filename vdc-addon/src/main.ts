import { IMPORTARTEN, activeSchema, importartLabel, parseFachmodellSchema, setActiveSchema, type Importart } from '../../editor/src/ifc/attribution/schema';
import { catalogFields, checkSnapshot, planChanges, splitProperty, validateSchemaShape } from './domain';
import { detectApi, VdcHost } from './vdc';
import { DemoHost } from './demo';
import type { Change, Finding, Host, Mapping, Snapshot } from './types';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const value = (id: string) => el<HTMLInputElement>(id).value;
const button = (id: string) => el<HTMLButtonElement>(id);
const dialog = el<HTMLDialogElement>('preview-dialog');
let host: Host | null = null;
let snapshot: Snapshot | null = null;
let findings: Finding[] | null = null;
let selected = new Set<string>();
let pending: Change[] = [];
let busy = false;
let page = 0;
let activeMapping: Mapping | null = null;
const phase = () => value('phase') as Importart;
const mapping = (): Mapping => ({ classProperty: value('class-property').trim(), guidProperty: value('guid-property').trim(), separator: value('separator') });
const text = (tag: string, content: string, className = '') => {
  const node = document.createElement(tag); node.textContent = content; node.className = className; return node;
};
function status(message: string, kind = '') { el('status').textContent = message; el('status').className = kind; }
function stateButtons() {
  for (const id of ['connect', 'demo', 'schema-reset', 'cancel']) button(id).disabled = busy;
  for (const id of ['model', 'phase', 'loi', 'class-property', 'guid-property', 'separator', 'schema-file']) el<HTMLInputElement>(id).disabled = busy;
  for (const id of ['check', 'selection', 'all', 'none', 'preview']) button(id).disabled = busy || !snapshot;
  button('check').disabled = busy || !snapshot || !targetElements().length;
  button('export').disabled = busy || findings === null;
  button('apply').disabled = busy || !pending.length;
  for (const node of document.querySelectorAll<HTMLInputElement>('#objects input, #references input, #pset, #property, #datatype, #value, #fill-mode')) node.disabled = busy;
}
async function task(fn: () => Promise<void> | void) {
  if (busy) return;
  busy = true; stateButtons();
  try { await fn(); } catch (e) { status(e instanceof Error ? e.message : String(e), 'error'); }
  finally { busy = false; stateButtons(); }
}
function invalidate() {
  findings = null; pending = []; page = 0;
  if (dialog.open) dialog.close();
  renderFindings(); stateButtons();
}
function schemaLabel() {
  el('schema-label').textContent = `Schema ${activeSchema().schemaVersion} · ${activeSchema().erzeugt || 'ohne Datum'}`;
  const previous = value('phase');
  el('phase').replaceChildren(...IMPORTARTEN.map((p) => new Option(importartLabel(p), p)));
  el<HTMLSelectElement>('phase').value = previous || 'bauwerksmodell';
}
function models() { return [...new Set(snapshot?.elements.map((e) => e.modelId) ?? [])]; }
function modelName(id: string) {
  const building = snapshot?.elements.find((e) => e.modelId === id && e.ifcClass === 'IFCBUILDING');
  return building ? `${building.name} · ${id}` : id;
}
function targetElements() { return snapshot?.elements.filter((e) => e.modelId === value('model')) ?? []; }
function references(): string[] { return [...el('references').querySelectorAll<HTMLInputElement>('input:checked')].map((e) => e.value); }
function renderModels() {
  const previous = value('model');
  const refs = new Set(references());
  el('model').replaceChildren(...models().map((id) => new Option(modelName(id), id)));
  if (models().includes(previous)) el<HTMLSelectElement>('model').value = previous;
  renderReferences(refs); renderObjects(); renderSuggestions();
}
function renderReferences(refs = new Set<string>()) {
  el('references').replaceChildren();
  for (const id of models().filter((m) => m !== value('model'))) {
    const label = document.createElement('label');
    const input = document.createElement('input'); input.type = 'checkbox'; input.value = id; input.checked = refs.has(id);
    input.onchange = invalidate;
    label.append(input, document.createTextNode(modelName(id))); el('references').append(label);
  }
  if (!el('references').childElementCount) el('references').textContent = 'Kein weiteres Modell geladen. Externe Bauteilreferenzen bleiben ungeprüft.';
}
function renderObjects() {
  const items = targetElements();
  el('count-objects').textContent = snapshot ? String(items.length) : '–';
  el('objects').replaceChildren();
  for (const e of items.slice(0, 300)) {
    const label = document.createElement('label'); label.className = 'object-row';
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = selected.has(e.id); input.disabled = busy;
    input.onchange = () => { if (input.checked) selected.add(e.id); else selected.delete(e.id); pending = []; updateSelected(); };
    label.append(input, document.createTextNode(e.name), text('small', e.ifcClass || 'IFC-Klasse unbekannt')); el('objects').append(label);
  }
  if (items.length > 300) el('objects').append(text('p', `${items.length - 300} weitere Objekte: über die 3D-Auswahl oder „Alle“ auswählen.`, 'muted'));
  updateSelected();
}
function updateSelected() { el('selected-count').textContent = `${selected.size} ausgewählt`; }
function renderSuggestions() {
  const fields = catalogFields(phase());
  const sets = new Set(fields.map((f) => f.pset));
  const props = new Set(fields.filter((f) => f.pset === value('pset')).map((f) => f.property));
  for (const e of targetElements()) for (const p of e.properties) {
    const path = splitProperty(p.name, activeMapping ?? mapping());
    if (path) { sets.add(path[0]); if (path[0] === value('pset')) props.add(path[1]); }
  }
  el('psets').replaceChildren(...[...sets].sort().map((s) => new Option(s, s)));
  el('properties').replaceChildren(...[...props].sort().map((s) => new Option(s, s)));
}
function renderFindings() {
  el('count-errors').textContent = findings ? String(findings.filter((f) => f.severity === 'error').length) : '–';
  el('count-warnings').textContent = findings ? String(findings.filter((f) => f.severity === 'warning').length) : '–';
  const list = el('findings'); list.replaceChildren(); el('finding-pages').replaceChildren();
  if (!findings) { list.append(text('div', 'Noch keine aktuelle Prüfung. Modell laden und „Modell prüfen“ starten.', 'empty')); return; }
  const query = value('search').toLowerCase();
  const filtered = findings.filter((f) => (value('severity') === 'all' || f.severity === value('severity')) && `${f.message} ${f.elementName ?? ''} ${f.code}`.toLowerCase().includes(query));
  const count = Math.max(1, Math.ceil(filtered.length / 50)); page = Math.min(page, count - 1);
  if (!filtered.length) list.append(text('div', 'Keine Befunde für diesen Filter.', 'empty'));
  for (const f of filtered.slice(page * 50, (page + 1) * 50)) {
    const row = text('div', '', 'finding');
    row.append(text('span', { error: 'Fehler', warning: 'Warnung', info: 'Hinweis' }[f.severity], `badge ${f.severity}`));
    const body = document.createElement('div'); body.append(text('strong', f.elementName || 'Modell'), text('p', f.message), text('small', f.code)); row.append(body);
    if (f.elementId) {
      const b = text('button', 'Im Modell zeigen') as HTMLButtonElement;
      b.onclick = () => task(async () => { await host!.select([f.elementId!]); status(host!.kind === 'demo' ? `Demo-Auswahl: ${f.elementName}` : `Objekt ausgewählt: ${f.elementName}`); }); row.append(b);
    }
    list.append(row);
  }
  const pages = el('finding-pages');
  pages.append(text('span', `${filtered.length} Befunde · Seite ${page + 1} / ${count}`));
  for (const [label, offset] of [['Zurück', -1], ['Weiter', 1]] as const) {
    const b = text('button', label) as HTMLButtonElement; b.disabled = page + offset < 0 || page + offset >= count;
    b.onclick = () => { page += offset; renderFindings(); }; pages.append(b);
  }
}
async function load() {
  const next = await host!.load(mapping(), (done, total) => status(`Objekte laden … ${done} / ${total}`));
  snapshot = next; activeMapping = mapping(); selected.clear(); invalidate(); renderModels();
  el('project').textContent = `${next.projectName} · Objekte: ${next.elements.length} · Modelle: ${models().length}`;
  const demo = host!.kind === 'demo';
  el('connection').textContent = demo ? 'Demo · Beispieldaten' : 'VDC verbunden'; el('connection').className = `chip ${demo ? 'demo' : 'connected'}`;
  status(demo ? 'Demo aktiv. Änderungen betreffen ausschließlich die Beispieldaten.' : next.elements.length ? 'Projekt eingelesen. Prüfmodell und Phase wählen.' : 'Projekt verbunden. Noch keine Modellobjekte vorhanden. IFC-Modell in VDC importieren und anschließend erneut laden.', 'success');
}
function check() {
  findings = checkSnapshot(snapshot!, value('model'), references(), phase(), activeMapping!, Number(value('loi')));
  page = 0; renderFindings();
  status(`Prüfung abgeschlossen: ${findings.filter((f) => f.severity === 'error').length} Fehler, ${findings.filter((f) => f.severity === 'warning').length} Warnungen. Prüfgrenzen stehen in den Hinweisen.`, 'success');
}
button('connect').onclick = () => task(async () => {
  const api = detectApi(window as unknown as Record<string, any>);
  if (!api) throw new Error('Keine VDC-WebForms-API gefunden. Die gebaute index.html in VDC Manager als WebForm öffnen.');
  host = new VdcHost(api); snapshot = null; activeMapping = null; invalidate(); await load();
});
button('demo').onclick = () => task(async () => { host = new DemoHost(); snapshot = null; activeMapping = null; invalidate(); await load(); });
button('check').onclick = () => task(check);
el('model').onchange = () => { selected.clear(); invalidate(); renderReferences(); renderObjects(); renderSuggestions(); };
for (const id of ['phase', 'loi']) el(id).onchange = () => { invalidate(); renderSuggestions(); };
for (const id of ['class-property', 'guid-property', 'separator']) el(id).onchange = () => {
  snapshot = null; selected.clear(); invalidate(); renderObjects(); status('Zuordnung geändert. Projekt oder Demo erneut laden.');
};
for (const id of ['search', 'severity']) el(id).addEventListener('input', () => { page = 0; renderFindings(); });
el('pset').addEventListener('input', renderSuggestions);
button('selection').onclick = () => task(async () => {
  const allowed = new Set(targetElements().map((e) => e.id));
  const ids = await host!.selected(); selected = new Set(ids.filter((id) => allowed.has(id)));
  status(`Objekte übernommen: ${selected.size}; außerhalb des Prüfmodells ignoriert: ${ids.length - selected.size}.`);
  renderObjects();
});
button('all').onclick = () => { selected = new Set(targetElements().map((e) => e.id)); renderObjects(); };
button('none').onclick = () => { selected.clear(); renderObjects(); };
button('preview').onclick = () => task(() => {
  const plan = planChanges(snapshot!, [...selected], activeMapping!, value('pset'), value('property'), value('datatype'), value('value'), value('fill-mode') as 'empty' | 'all');
  pending = plan.changes;
  el('preview-summary').textContent = `Geplante Änderungen: ${pending.length} · Unverändert oder übersprungen: ${plan.skipped} (z. B. vererbt).${host!.kind === 'demo' ? ' DEMO: nur Beispieldaten.' : ''}`;
  el('preview-rows').replaceChildren();
  for (const c of pending) {
    const tr = document.createElement('tr'); const name = text('td', c.elementName); name.append(text('small', c.propertyName));
    tr.append(name, text('td', c.existed ? (c.before === '' || c.before == null ? '(leer)' : String(c.before)) : '(fehlt)'), text('td', c.after === '' || c.after == null ? '(leer)' : String(c.after))); el('preview-rows').append(tr);
  }
  dialog.showModal();
});
button('cancel').onclick = () => { dialog.close(); pending = []; stateButtons(); };
dialog.addEventListener('cancel', (e) => { if (busy) e.preventDefault(); else pending = []; });
button('apply').onclick = () => task(async () => {
  const result = await host!.apply(snapshot!, pending);
  pending = []; dialog.close();
  // Always reload after any attempted write. Never leave the old plan reusable.
  try { await load(); check(); }
  catch (e) { snapshot = null; invalidate(); status(`Nachladen fehlgeschlagen. ${result.applied.length} Änderungen wurden bestätigt. ${result.error ?? ''} ${String(e)}`, 'error'); return; }
  status(result.error ? `Bestätigte Änderungen: ${result.applied.length}. ${result.error} Weitere Änderungen gestoppt; keine automatische Rücknahme.` : `Änderungen übernommen: ${result.applied.length}. Modell erneut geprüft.${host!.kind === 'demo' ? ' Nur Demo-Daten.' : ''}`, result.error ? 'error' : 'success');
});
button('export').onclick = () => {
  const report = { tool: 'MKP VDC Add-on 0.1.0', mode: host!.kind, createdAt: new Date().toISOString(), project: snapshot!.projectName, model: value('model'), phase: phase(), loi: Number(value('loi')), schema: activeSchema().schemaVersion, mapping: activeMapping, referenceModels: references(), findings };
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = 'mkp-modellpruefung.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
el<HTMLInputElement>('schema-file').onchange = () => task(async () => {
  const file = el<HTMLInputElement>('schema-file').files?.[0]; if (!file) return;
  if (file.size > 5_000_000) throw new Error('Schemadatei ist größer als 5 MB.');
  const parsed = parseFachmodellSchema(await file.text());
  if (!parsed.ok) throw new Error(parsed.error);
  validateSchemaShape(parsed.schema); setActiveSchema(parsed.schema); schemaLabel(); invalidate(); renderSuggestions(); status(`Schema geladen: ${file.name}`);
});
button('schema-reset').onclick = () => { setActiveSchema(null); el<HTMLInputElement>('schema-file').value = ''; schemaLabel(); invalidate(); renderSuggestions(); status('Mitgeliefertes Schema aktiviert.'); };
schemaLabel(); stateButtons(); renderFindings();
