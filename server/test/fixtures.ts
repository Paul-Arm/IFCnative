/** Minimal valid-enough IFC fixtures shared by the server tests. */

function guid(seed: string): string {
  return (`3t2$${seed}` + "0".repeat(22)).slice(0, 22);
}

export const WALL = guid("wallA");
export const PSET = guid("psetA");
export const REL = guid("relAA");

export interface IfcModelOptions {
  height?: string;
  wallName?: string;
}

export function ifcModel(opts: IfcModelOptions = {}): string {
  const height = opts.height ?? "3000.";
  const wallName = opts.wallName ?? "Wall A";
  return [
    "ISO-10303-21;",
    "HEADER;",
    "FILE_DESCRIPTION((''),'2;1');",
    "FILE_NAME('test.ifc','',(''),(''),'','','');",
    "FILE_SCHEMA(('IFC4'));",
    "ENDSEC;",
    "DATA;",
    `#1= IFCWALL('${WALL}',$,'${wallName}',$,$,$,$,$,$);`,
    `#2= IFCPROPERTYSINGLEVALUE('Height',$,IFCREAL(${height}),$);`,
    `#3= IFCPROPERTYSET('${PSET}',$,'Pset_WallCommon',$,(#2));`,
    `#4= IFCRELDEFINESBYPROPERTIES('${REL}',$,$,$,(#1),#3);`,
    "ENDSEC;",
    "END-ISO-10303-21;",
    "",
  ].join("\n");
}
