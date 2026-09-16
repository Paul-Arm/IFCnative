import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MAPPING, type Property, type Snapshot } from '../src/types';
import { VdcHost, detectApi, elementFromProperties, parseProperties, type VdcApi } from '../src/vdc';
import { checkSnapshot, parseValue, planChanges, projectDocument, splitProperty, validateSchemaShape } from '../src/domain';
import { DemoHost } from '../src/demo';
import { activeSchema } from '../../editor/src/ifc/attribution/schema';
import { getValue, findPset } from '../../editor/src/ifc/attribution/normalize';

const mapping = DEFAULT_MAPPING;
const prop = (name: string, value: string | number | boolean | null, type = 'xs:string', inherited = false): Property => ({ name, value, type, inherited });
function snapshot(properties = [prop('ePset_Objektinformation:IDEbene2', '')]): Snapshot {
  return { projectId: 'project-a', projectName: 'Brücke', loadedAt: '', elements: [elementFromProperties('wall-a', 'model-a', properties, mapping)] };
}
function plan(s: Snapshot, value = 'Wand') {
  return planChanges(s, ['wall-a'], mapping, 'ePset_Objektinformation', 'IDEbene2', 'xs:string', value, 'empty').changes;
}
function mock(s = snapshot()) {
  let transaction = 0;
  const calls: unknown[][] = [];
  const api: VdcApi = {
    getPropertyValue: () => s.projectId,
    getProjectName: () => s.projectName,
    getAllElements: () => s.elements.map((e) => e.id),
    getModelByElement: (id: string) => s.elements.find((e) => e.id === id)?.modelId,
    getPropertyValuesByObject: (id: string) => s.elements.find((e) => e.id === id)!.properties.map((p) => ({ Name: p.name, Type: p.type, Value: p.value, isInherited: p.inherited })),
    getPropertySource: (id: string, name: string) => s.elements.find((e) => e.id === id)!.properties.find((p) => p.name === name)?.value,
    isModelReadOnly: () => false,
    startProjectTransaction: () => { calls.push(['start']); return ++transaction; },
    endProjectTransaction: () => { calls.push(['end']); return --transaction; },
    setPropertyValue: (...args: unknown[]) => { calls.push(['write', ...args]); return 1; },
    getSelectedElements: () => ['wall-a'],
    clearSelection: (...args: unknown[]) => calls.push(['clear', ...args]),
    setElementsSelected: (...args: unknown[]) => calls.push(['select', ...args]),
    zoomToSelected: () => calls.push(['zoom']),
  };
  return { api, calls, host: new VdcHost(api) };
}
test('WebForms detection supports current and legacy host, never invents a connection', () => {
  const { api } = mock();
  assert.equal(detectApi({ vdcApp: api }), api);
  assert.equal(detectApi({ desiteAPI: api }), api);
  assert.equal(detectApi({}), null);
});
test('documented property response preserves null, false, zero and inheritance', () => {
  assert.deepEqual(parseProperties([{ Name: 'a', Type: 'xs:boolean', Value: false, isInherited: true }]), [prop('a', false, 'xs:boolean', true)]);
  assert.equal(parseProperties('[{"Name":"a","Type":"xs:long","Value":0}]')[0].value, 0);
  assert.throws(() => parseProperties({}), /Eigenschaftsliste/);
  assert.throws(() => parseProperties([{ displayName: 'x' }]), /Name\/Type/);
});
test('projection retains strings, suffixes and independent host identity', () => {
  const e = elementFromProperties('host-guid', 'm', [prop('IFC:Type', 'IfcWall'), prop('ePset_Objektinformation:_ID_OI', "Brücke.O'Neil")], mapping);
  const { doc, hostIds } = projectDocument([e], mapping, 'm');
  assert.equal(hostIds.get(1)?.id, 'host-guid');
  assert.equal(getValue(findPset(doc, 1, 'Objektinformation'), 'ID'), "Brücke.O'Neil");
  assert.equal(doc.entities[0].args[6], undefined);
  assert.deepEqual(splitProperty('ePset_Objektinformation::ID', { ...mapping, separator: '::' }), ['ePset_Objektinformation', 'ID']);
});
test('demo exercises shared rules, correcting required value reveals duplicate IDs', async () => {
  const host = new DemoHost();
  const before = await host.load(mapping);
  let results = checkSnapshot(before, 'demo-bridge', [], 'bauwerksmodell', mapping, 300);
  assert.ok(results.some((f) => f.code === 'component_missing_attributes' && f.elementId === 'wall-b'));
  const changes = planChanges(before, ['wall-a', 'wall-b'], mapping, 'ePset_Objektinformation', 'IDEbene2', 'xs:string', 'Wand', 'empty');
  assert.equal(changes.changes.length, 1);
  await host.apply(before, changes.changes);
  results = checkSnapshot(await host.load(mapping), 'demo-bridge', [], 'bauwerksmodell', mapping, 300);
  assert.ok(!results.some((f) => f.code === 'component_missing_attributes'));
  assert.ok(results.some((f) => f.code === 'duplicate_ifc_id'));
  assert.ok(results.some((f) => f.code === 'coverage'));
});
test('separate model scopes avoid counting two buildings as one IFC', async () => {
  const s = await new DemoHost().load(mapping);
  s.elements.push(...s.elements.map((e) => ({ ...e, id: 'other-' + e.id, modelId: 'other-model' })));
  const results = checkSnapshot(s, 'demo-bridge', [], 'bauwerksmodell', mapping, 300);
  assert.ok(!results.some((f) => f.code === 'invalid_building_count'));
});
test('missing class is reported as untested, not a successful check', () => {
  const results = checkSnapshot(snapshot(), 'model-a', [], 'bauwerksmodell', mapping, 300);
  assert.deepEqual(results.map((f) => f.code), ['adapter-ifc-class']);
});
test('schema bundled with editor is usable', () => validateSchemaShape(activeSchema()));
test('preview only fills empty values and retains imported aliases', () => {
  const s = snapshot([prop('Pset_Objektinformation:_IDEbene2_OI', '-')]);
  assert.equal(plan(s)[0].propertyName, 'Pset_Objektinformation:_IDEbene2_OI');
  assert.equal(plan(snapshot([prop('ePset_Objektinformation:IDEbene2', 'Bestand')])).length, 0);
  assert.equal(plan(snapshot([prop('ePset_Objektinformation:IDEbene2', '', 'xs:string', true)])).length, 0);
  assert.equal(plan(snapshot([]))[0].existed, false);
});
test('ambiguous aliases and unknown selections are blocked before writing', () => {
  assert.throws(() => plan(snapshot([prop('ePset_Objektinformation:IDEbene2', ''), prop('Pset_Objektinformation:IDEbene2', '')])), /Mehrdeutige/);
  assert.throws(() => planChanges(snapshot(), ['missing'], mapping, 'Pset_A', 'B', 'xs:string', 'x', 'all'), /nicht geladene/);
  assert.throws(() => planChanges(snapshot(), ['wall-a'], mapping, 'Probe\\d*', 'B', 'xs:string', 'x', 'all'), /konkreten/);
});
test('typed values handle German decimals and reject lossy integers and invalid values', () => {
  assert.equal(parseValue('1,25', 'xs:double'), 1.25);
  assert.equal(parseValue('falsch', 'xs:boolean'), false);
  assert.throws(() => parseValue('', 'xs:double'));
  assert.throws(() => parseValue('9007199254740993', 'xs:long'));
  assert.throws(() => parseValue('1.2', 'xs:long'));
  assert.throws(() => parseValue('Infinity', 'xs:double'));
});
test('adapter loads and selects documented host objects', async () => {
  const { host, calls } = mock();
  assert.equal((await host.load(mapping)).elements[0].modelId, 'model-a');
  await host.select(['wall-a']);
  assert.deepEqual(calls, [['clear', true, 'geometry'], ['select', true, ['wall-a']], ['zoom']]);
});

test('modern WebForms use getProjectInfo when GlobalProject/ID returns null', async () => {
  const m = mock();
  m.api.getPropertyValue = () => null;
  m.api.getProjectInfo = async () => ({ ID: 'modern-project' });
  const loaded = await m.host.load(mapping);
  assert.equal(loaded.projectId, 'modern-project');
  m.api.getProjectInfo = async () => ({ ID: 'other-project' });
  assert.match((await m.host.apply(loaded, plan(loaded))).error!, /Projekt/);
  assert.deepEqual(m.calls, []);
});

test('modern host without active project cannot use a stale legacy ID', async () => {
  const m = mock();
  m.api.getProjectInfo = () => ({ ID: '' });
  await assert.rejects(() => m.host.load(mapping), /Projekt-ID/);
});
test('changed values and changed projects reject the entire plan before transaction', async () => {
  const s = snapshot(); const changes = plan(s); const { host, calls } = mock(s);
  s.elements[0].properties[0].value = 'Extern';
  assert.match((await host.apply(s, changes)).error!, /Zwischenzeitlich/);
  assert.deepEqual(calls, []);
  const other = mock(s); other.api.getPropertyValue = () => 'another-project';
  assert.match((await other.host.apply(s, changes)).error!, /Projekt/);
  assert.deepEqual(other.calls, []);
});
test('read-only, unknown read-only state, inherited and calculated properties cannot be changed', async () => {
  for (const state of [true, undefined]) {
    const s = snapshot(); const m = mock(s); m.api.isModelReadOnly = () => state;
    assert.match((await m.host.apply(s, plan(s))).error!, /schreibgeschützt/);
    assert.deepEqual(m.calls, []);
  }
  const s = snapshot(); const changes = plan(s); const m = mock(s);
  s.elements[0].properties[0].inherited = true;
  assert.match((await m.host.apply(s, changes)).error!, /vererbt/);
  s.elements[0].properties[0].inherited = false; m.api.getPropertySource = () => '=formula';
  assert.match((await m.host.apply(s, changes)).error!, /Berechnete/);
});
test('write success uses typed values and closes the project transaction', async () => {
  const s = snapshot(); const { host, calls } = mock(s);
  const result = await host.apply(s, plan(s));
  assert.equal(result.error, undefined); assert.equal(result.applied.length, 1);
  assert.deepEqual(calls, [['start'], ['write', 'wall-a', 'ePset_Objektinformation:IDEbene2', 'xs:string', 'Wand'], ['end']]);
});
test('partial failures report confirmed writes and still close the transaction', async () => {
  const s = snapshot(); s.elements.push({ ...s.elements[0], id: 'wall-b', properties: [prop('ePset_Objektinformation:IDEbene2', '')] });
  const changes = planChanges(s, ['wall-a', 'wall-b'], mapping, 'ePset_Objektinformation', 'IDEbene2', 'xs:string', 'Wand', 'empty').changes;
  const m = mock(s); let writes = 0;
  m.api.setPropertyValue = () => ++writes === 1 ? 1 : -3;
  const result = await m.host.apply(s, changes);
  assert.equal(result.applied.length, 1); assert.match(result.error!, /abgelehnt/);
  assert.deepEqual(m.calls, [['start'], ['end']]);
});
test('zero return and thrown write failures are never treated as success', async () => {
  for (const throws of [false, true]) {
    const s = snapshot(); const m = mock(s);
    m.api.setPropertyValue = () => { if (throws) throw new Error('Host offline'); return 0; };
    const result = await m.host.apply(s, plan(s));
    assert.equal(result.applied.length, 0); assert.ok(result.error); assert.deepEqual(m.calls, [['start'], ['end']]);
  }
});
test('reference resolution uses only explicitly selected other models', async () => {
  const s = await new DemoHost().load(mapping);
  const building = { ...s.elements[0], id: 'diagnostic-building', modelId: 'diagnostics', properties: [...s.elements[0].properties, prop('ePset_Projekt:ID', 'P1'), prop('ePset_Projekt:Bezeichnung', 'Untersuchung')] };
  const point = elementFromProperties('point', 'diagnostics', [prop('IFC:Type', 'IfcBuildingElementProxy'), prop('ePset_Objektinformation:ID', 'P1.1.1'), prop('ePset_Objektinformation:BauteilID', 'BW42.01.UG.Wand.Beton.1')], mapping);
  s.elements.push(building, point);
  assert.ok(checkSnapshot(s, 'diagnostics', [], 'planung', mapping, 300).some((f) => f.code === 'editor_reference_unchecked' && f.elementId === 'point'));
  const checked = checkSnapshot(s, 'diagnostics', ['demo-bridge'], 'planung', mapping, 300);
  assert.ok(!checked.some((f) => f.code === 'editor_reference_unchecked' && f.elementId === 'point'));
  point.properties.find((p) => p.name.endsWith(':BauteilID'))!.value = 'does-not-exist';
  assert.ok(checkSnapshot(s, 'diagnostics', ['demo-bridge'], 'planung', mapping, 300).some((f) => f.code === 'unknown_reference' && f.elementId === 'point'));
});
test('a change after batch preflight is detected before its write', async () => {
  const s = snapshot(); const m = mock(s);
  m.api.startProjectTransaction = () => { s.elements[0].properties[0].value = 'changed'; return 1; };
  const result = await m.host.apply(s, plan(s));
  assert.equal(result.applied.length, 0); assert.match(result.error!, /während der Bearbeitung/);
  assert.ok(!m.calls.some((c) => c[0] === 'write'));
});
test('transaction close failure retains the successful write count', async () => {
  const s = snapshot(); const m = mock(s);
  m.api.endProjectTransaction = () => { throw new Error('Host disconnected'); };
  const result = await m.host.apply(s, plan(s));
  assert.equal(result.applied.length, 1); assert.match(result.error!, /Transaktionsabschluss/);
});
