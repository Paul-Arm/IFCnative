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

/**
 * Minimal-IFC4 mit ECHTER Geometrie (extrudierte Rechteck-Wand 4 x 0.3 x 3 m
 * in korrekter Projekt->Site-Struktur) — für die Fragments-Konvertierung.
 */
export function ifcModelWithGeometry(): string {
  return [
    "ISO-10303-21;",
    "HEADER;",
    "FILE_DESCRIPTION((''),'2;1');",
    "FILE_NAME('geo.ifc','',(''),(''),'','','');",
    "FILE_SCHEMA(('IFC4'));",
    "ENDSEC;",
    "DATA;",
    "#1=IFCPROJECT('0Project000000000000aa',$,'Projekt',$,$,$,$,(#10),#5);",
    "#5=IFCUNITASSIGNMENT((#6));",
    "#6=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);",
    "#10=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.0E-5,#11,$);",
    "#11=IFCAXIS2PLACEMENT3D(#12,$,$);",
    "#12=IFCCARTESIANPOINT((0.,0.,0.));",
    "#20=IFCSITE('0Site00000000000000aa',$,'Site',$,$,#21,$,$,.ELEMENT.,$,$,0.,$,$);",
    "#21=IFCLOCALPLACEMENT($,#11);",
    "#30=IFCWALL('0Wall00000000000000aa',$,'Wand A',$,$,#31,#40,$,$);",
    "#31=IFCLOCALPLACEMENT(#21,#11);",
    "#40=IFCPRODUCTDEFINITIONSHAPE($,$,(#41));",
    "#41=IFCSHAPEREPRESENTATION(#10,'Body','SweptSolid',(#42));",
    "#42=IFCEXTRUDEDAREASOLID(#43,#11,#46,3.);",
    "#43=IFCRECTANGLEPROFILEDEF(.AREA.,$,#44,4.,0.3);",
    "#44=IFCAXIS2PLACEMENT2D(#45,$);",
    "#45=IFCCARTESIANPOINT((0.,0.));",
    "#46=IFCDIRECTION((0.,0.,1.));",
    "#50=IFCRELAGGREGATES('0RelAgg00000000000Aaa',$,$,$,#1,(#20));",
    "#51=IFCRELCONTAINEDINSPATIALSTRUCTURE('0RelCon00000000000Aaa',$,$,$,(#30),#20);",
    "ENDSEC;",
    "END-ISO-10303-21;",
    "",
  ].join("\n");
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
