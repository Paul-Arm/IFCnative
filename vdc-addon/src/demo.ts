import type { Change, Host, Mapping, Snapshot } from './types';
import { elementFromProperties } from './vdc';
/** Only explicitly started by the user; demo data never falls through to the real host. */
export class DemoHost implements Host {
  kind = 'demo' as const;
  private data?: Snapshot;
  private selectedIds = ['wall-a', 'wall-b'];
  async load(mapping: Mapping): Promise<Snapshot> {
    if (!this.data) {
      const element = (id: string, name: string, ifcClass: string, values: Record<string, string>) => elementFromProperties(id, 'demo-bridge', [
        { name: 'cpName', type: 'xs:string', value: name, inherited: false },
        { name: mapping.classProperty, type: 'xs:string', value: ifcClass, inherited: false },
        ...Object.entries(values).map(([name, value]) => ({ name: name.replace(':', mapping.separator), type: 'xs:string', value, inherited: false })),
      ], mapping);
      this.data = { projectId: 'demo-project', projectName: 'Demo · Brücke am Mühlenweg', loadedAt: new Date().toISOString(), elements: [
        element('building', 'Brücke am Mühlenweg', 'IfcBuilding', { 'ePset_Bauwerk:Bauwerksnummer': 'BW42', 'ePset_Bauwerk:Bauwerksname': 'Brücke am Mühlenweg', 'ePset_Bauwerk:Teilbauwerksnummer': '01' }),
        element('storey', 'Überbau', 'IfcBuildingStorey', {}),
        element('wall-a', 'Widerlager Nord', 'IfcWall', { 'ePset_Objektinformation:ID': 'BW42.01.UG.Wand.Beton.1', 'ePset_Objektinformation:IDEbene1': 'UG', 'ePset_Objektinformation:IDEbene2': 'Wand', 'ePset_Objektinformation:IDEbene3': 'Beton' }),
        element('wall-b', 'Widerlager Süd', 'IfcWall', { 'ePset_Objektinformation:ID': 'BW42.01.UG.Wand.Beton.1', 'ePset_Objektinformation:IDEbene1': 'UG', 'ePset_Objektinformation:IDEbene2': '', 'ePset_Objektinformation:IDEbene3': 'Beton' }),
      ] };
    }
    return structuredClone(this.data);
  }
  async selected() { return [...this.selectedIds]; }
  async select(ids: string[]) { this.selectedIds = [...ids]; }
  async apply(_snapshot: Snapshot, changes: Change[]) {
    for (const c of changes) {
      const e = this.data!.elements.find((e) => e.id === c.elementId)!;
      const property = e.properties.find((p) => p.name === c.propertyName);
      if (property) property.value = c.after;
      else e.properties.push({ name: c.propertyName, type: c.type, value: c.after, inherited: false });
    }
    return { applied: [...changes] };
  }
}
