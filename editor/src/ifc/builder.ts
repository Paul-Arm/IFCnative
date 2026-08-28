import { escapeStepStringContent } from "./stepEncoding";

export interface MinimalProjectOptions {
  name?: string;
  author?: string;
  organization?: string;
  siteName?: string;
  buildingName?: string;
  storeyName?: string;
  products?: BuilderProductOptions[];
}

export interface BuilderProductOptions {
  name?: string;
  tag?: string;
  width?: number;
  depth?: number;
  height?: number;
  x?: number;
  y?: number;
  z?: number;
  materialCategory?: string;
  materialName?: string;
  classificationCode?: string;
  classificationName?: string;
  classificationUri?: string;
  documentIdentification?: string;
  documentName?: string;
  documentUri?: string;
  properties?: Record<string, string>;
}

const SAMPLE_GUIDS = [
  "0IFCnative000000000001",
  "0IFCnative000000000002",
  "0IFCnative000000000003",
  "0IFCnative000000000004",
  "0IFCnative000000000005",
  "0IFCnative000000000006",
  "0IFCnative000000000007",
  "0IFCnative000000000008",
  "0IFCnative000000000009",
  "0IFCnative000000000010",
];

export function createMinimalIfcProject(options: MinimalProjectOptions = {}) {
  const projectName = escapeStepString(
    options.name ?? "IFCnative Builder Sample",
  );
  const author = escapeStepString(options.author ?? "IFCnative");
  const organization = escapeStepString(options.organization ?? "IFCnative");
  const siteName = escapeStepString(options.siteName ?? "Sample Site");
  const buildingName = escapeStepString(
    options.buildingName ?? "Sample Building",
  );
  const storeyName = escapeStepString(options.storeyName ?? "Level 0");
  const timestamp = new Date().toISOString().slice(0, 19);
  const products = normalizeProducts(options.products);
  const productIDs = products.map((_product, index) =>
    getBuilderProductExpressID(index),
  );
  const productStep = products
    .map((product, index) => productToStep(product, index))
    .join("");

  return `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');
FILE_NAME('${projectName}.ifc','${timestamp}',('${author}'),('${organization}'),'IFCnative','IFCnative','');
FILE_SCHEMA(('IFC4X3_ADD2'));
ENDSEC;
DATA;
#1=IFCPROJECT('${SAMPLE_GUIDS[0]}',$,'${projectName}',$,$,$,$,(#10),#20);
#10=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#11,$);
#11=IFCAXIS2PLACEMENT3D(#12,$,$);
#12=IFCCARTESIANPOINT((0.,0.,0.));
#20=IFCUNITASSIGNMENT((#21,#22,#23));
#21=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
#22=IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.);
#23=IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.);
#30=IFCLOCALPLACEMENT($,#31);
#31=IFCAXIS2PLACEMENT3D(#12,$,$);
#40=IFCSITE('${SAMPLE_GUIDS[1]}',$,'${siteName}',$,$,#30,$,$,.ELEMENT.,$,$,$,$,$);
#41=IFCBUILDING('${SAMPLE_GUIDS[2]}',$,'${buildingName}',$,$,#30,$,$,.ELEMENT.,$,$,$);
#42=IFCBUILDINGSTOREY('${SAMPLE_GUIDS[3]}',$,'${storeyName}',$,$,#30,$,$,.ELEMENT.,0.);
#50=IFCRELAGGREGATES('${SAMPLE_GUIDS[4]}',$,$,$,#1,(#40));
#51=IFCRELAGGREGATES('${SAMPLE_GUIDS[5]}',$,$,$,#40,(#41));
#52=IFCRELAGGREGATES('${SAMPLE_GUIDS[6]}',$,$,$,#41,(#42));
${productStep}#81=IFCRELCONTAINEDINSPATIALSTRUCTURE('${SAMPLE_GUIDS[8]}',$,$,$,(${productIDs.map((id) => `#${id}`).join(",")}),#42);
ENDSEC;
END-ISO-10303-21;
`;
}

export function createMinimalIfcProjectBytes(options?: MinimalProjectOptions) {
  return new TextEncoder().encode(createMinimalIfcProject(options));
}

function escapeStepString(value: string) {
  const trimmed = value.trim().slice(0, 80) || "IFCnative";
  return escapeStepStringContent(trimmed);
}

function escapeStepUri(value: string) {
  const trimmed =
    value.trim().replace(/\s/g, "").slice(0, 180) || "https://ifcnative.local";
  return escapeStepStringContent(trimmed);
}

export function getBuilderProductExpressID(index: number) {
  return productBase(index) + 20;
}

function normalizeProducts(products?: BuilderProductOptions[]) {
  const fallback: BuilderProductOptions[] = [
    {
      depth: 2,
      height: 1.5,
      name: "Sample Inspection Block",
      properties: {
        MonitoringRole: "Inspection target",
        Reference: "Generated IFCnative block",
      },
      tag: "IFCNATIVE-BLOCK-001",
      width: 4,
      x: 0,
      y: 0,
      z: 0,
    },
  ];
  return (products?.length ? products : fallback).map((product, index) => ({
    depth: safePositive(product.depth, 2),
    height: safePositive(product.height, 1.5),
    materialCategory: product.materialCategory || "Concrete",
    materialName: product.materialName || "Inspection Concrete",
    classificationCode:
      product.classificationCode ||
      `IFCNATIVE-${String(index + 1).padStart(3, "0")}`,
    classificationName: product.classificationName || "Inspection Target",
    classificationUri:
      product.classificationUri ||
      "https://ifcnative.local/classification/inspection-target",
    documentIdentification:
      product.documentIdentification ||
      `DOC-${String(index + 1).padStart(3, "0")}`,
    documentName: product.documentName || "Inspection Report Placeholder",
    documentUri:
      product.documentUri ||
      "https://ifcnative.local/documents/inspection-report",
    name: product.name || `Builder Block ${index + 1}`,
    properties: product.properties ?? {},
    tag: product.tag || `IFCNATIVE-BLOCK-${String(index + 1).padStart(3, "0")}`,
    width: safePositive(product.width, 4),
    x: safeNumber(product.x, index * 5),
    y: safeNumber(product.y, 0),
    z: safeNumber(product.z, 0),
  }));
}

function productToStep(
  product: Required<BuilderProductOptions>,
  index: number,
) {
  const base = productBase(index);
  const propertyBaseID = propertyBase(index);
  const quantityBaseID = productExtraBase(index);
  const materialID = quantityBaseID + 20;
  const classificationID = quantityBaseID + 30;
  const documentID = quantityBaseID + 40;
  const productID = getBuilderProductExpressID(index);
  const productGuid = sampleGuid(20 + index);
  const psetGuid = sampleGuid(120 + index);
  const relGuid = sampleGuid(220 + index);
  const quantityGuid = sampleGuid(320 + index);
  const quantityRelGuid = sampleGuid(420 + index);
  const materialRelGuid = sampleGuid(520 + index);
  const classificationRelGuid = sampleGuid(620 + index);
  const documentRelGuid = sampleGuid(720 + index);
  const footprintArea = product.width * product.depth;
  const netVolume = footprintArea * product.height;
  const propertyEntries = Object.entries({
    Reference: "Generated IFCnative block",
    MonitoringRole: "Inspection target",
    ...product.properties,
  }).slice(0, 6);
  const propertyIDs = propertyEntries.map(
    (_entry, propertyIndex) => propertyBaseID + propertyIndex + 1,
  );
  const propertyStep = propertyEntries
    .map(
      ([name, value], propertyIndex) =>
        `#${propertyBaseID + propertyIndex + 1}=IFCPROPERTYSINGLEVALUE('${escapeStepString(
          name,
        )}',$,IFCLABEL('${escapeStepString(value)}'),$);\n`,
    )
    .join("");

  return `#${base}=IFCLOCALPLACEMENT(#30,#${base + 1});
#${base + 1}=IFCAXIS2PLACEMENT3D(#${base + 2},$,$);
#${base + 2}=IFCCARTESIANPOINT((${formatStepNumber(product.x)},${formatStepNumber(
    product.y,
  )},${formatStepNumber(product.z)}));
#${base + 10}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${base + 11}));
#${base + 11}=IFCSHAPEREPRESENTATION(#10,'Body','SweptSolid',(#${base + 12}));
#${base + 12}=IFCEXTRUDEDAREASOLID(#${base + 15},#${base + 13},#${base + 18},${formatStepNumber(
    product.height,
  )});
#${base + 13}=IFCAXIS2PLACEMENT3D(#${base + 14},$,$);
#${base + 14}=IFCCARTESIANPOINT((0.,0.,0.));
#${base + 15}=IFCRECTANGLEPROFILEDEF(.AREA.,'Block Profile',#${base + 16},${formatStepNumber(
    product.width,
  )},${formatStepNumber(product.depth)});
#${base + 16}=IFCAXIS2PLACEMENT2D(#${base + 17},#${base + 19});
#${base + 17}=IFCCARTESIANPOINT((0.,0.));
#${base + 18}=IFCDIRECTION((0.,0.,1.));
#${base + 19}=IFCDIRECTION((1.,0.));
#${productID}=IFCBUILTELEMENT('${productGuid}',$,'${escapeStepString(product.name)}',$,$,#${base},#${base + 10},'${escapeStepString(
    product.tag,
  )}');
#${propertyBaseID}=IFCPROPERTYSET('${psetGuid}',$,'IFCnative_Diagnostics',$,(${propertyIDs
    .map((id) => `#${id}`)
    .join(",")}));
${propertyStep}#${propertyBaseID + 9}=IFCRELDEFINESBYPROPERTIES('${relGuid}',$,$,$,(#${productID}),#${propertyBaseID});
#${quantityBaseID}=IFCELEMENTQUANTITY('${quantityGuid}',$,'IFCnative_BaseQuantities',$,'BaseQuantities',(#${quantityBaseID + 1},#${quantityBaseID + 2},#${quantityBaseID + 3}));
#${quantityBaseID + 1}=IFCQUANTITYLENGTH('Height',$,$,${formatStepNumber(product.height)},$);
#${quantityBaseID + 2}=IFCQUANTITYAREA('FootprintArea',$,$,${formatStepNumber(footprintArea)},$);
#${quantityBaseID + 3}=IFCQUANTITYVOLUME('NetVolume',$,$,${formatStepNumber(netVolume)},$);
#${quantityBaseID + 9}=IFCRELDEFINESBYPROPERTIES('${quantityRelGuid}',$,$,$,(#${productID}),#${quantityBaseID});
#${materialID}=IFCMATERIAL('${escapeStepString(product.materialName)}',$,'${escapeStepString(product.materialCategory)}');
#${materialID + 1}=IFCRELASSOCIATESMATERIAL('${materialRelGuid}',$,'Material',$,(#${productID}),#${materialID});
#${classificationID}=IFCCLASSIFICATIONREFERENCE('${escapeStepUri(product.classificationUri)}','${escapeStepString(product.classificationCode)}','${escapeStepString(product.classificationName)}',$,$,$);
#${classificationID + 1}=IFCRELASSOCIATESCLASSIFICATION('${classificationRelGuid}',$,'Classification',$,(#${productID}),#${classificationID});
#${documentID}=IFCDOCUMENTREFERENCE('${escapeStepUri(product.documentUri)}','${escapeStepString(product.documentIdentification)}','${escapeStepString(product.documentName)}',$,$);
#${documentID + 1}=IFCRELASSOCIATESDOCUMENT('${documentRelGuid}',$,'Document',$,(#${productID}),#${documentID});
`;
}

function productBase(index: number) {
  return index === 0 ? 60 : 100 + (index - 1) * 40;
}

function propertyBase(index: number) {
  return index === 0 ? 90 : 130 + (index - 1) * 40;
}

function productExtraBase(index: number) {
  // Disjunkt zu den Produkt-/Property-Blöcken (100 + n·40): mit der alten
  // 500er-Basis kollidierte productBase(11) = 500 ab dem 12. Produkt mit dem
  // Quantity-Block des ersten — doppelte Express-Ids, korrupte Datei.
  return 1_000_000 + index * 100;
}

function sampleGuid(index: number) {
  return `0IFCnative${String(index).padStart(12, "0")}`;
}

function safePositive(value: number | undefined, fallback: number) {
  return Math.max(safeNumber(value, fallback), 0.05);
}

function safeNumber(value: number | undefined, fallback: number) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function formatStepNumber(value: number) {
  const fixed = Number(value)
    .toFixed(4)
    .replace(/0+$/g, "")
    .replace(/\.$/g, "");
  return fixed.includes(".") ? fixed : `${fixed}.`;
}
