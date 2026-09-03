import {
    splitTopLevel,
    type NativeIfcDocument,
    type NativeIfcEntity,
} from "./nativeDocument";
import { unquoteStepString } from "./stepEncoding";

/**
 * IDS (Information Delivery Specification, buildingSMART) — Parser und
 * Validator gegen das native IFC-Dokumentmodell.
 *
 * Unterstützt IDS 1.0 mit den Facetten entity, attribute, property,
 * classification, material und partOf; Werte als ids:simpleValue oder
 * xs:restriction (enumeration, pattern, Schranken, Längen). Attribute werden
 * über bekannte STEP-Argumentpositionen gelesen (GlobalId, Name, Description,
 * ObjectType, Tag, LongName, PredefinedType); exotischere Attribute werden als
 * nicht prüfbar gemeldet statt still zu bestehen.
 */

export type IdsCardinality = "optional" | "prohibited" | "required";

export interface IdsRestriction {
  base?: string;
  enumeration?: string[];
  length?: number;
  maxExclusive?: number;
  maxInclusive?: number;
  maxLength?: number;
  minExclusive?: number;
  minInclusive?: number;
  minLength?: number;
  patterns?: string[];
}

export interface IdsValue {
  kind: "restriction" | "simple";
  restriction?: IdsRestriction;
  simple?: string;
}

export interface IdsEntityFacet {
  name: IdsValue;
  predefinedType?: IdsValue;
  type: "entity";
}

export interface IdsAttributeFacet {
  cardinality: IdsCardinality;
  instructions?: string;
  name: IdsValue;
  type: "attribute";
  value?: IdsValue;
}

export interface IdsPropertyFacet {
  baseName: IdsValue;
  cardinality: IdsCardinality;
  dataType?: string;
  instructions?: string;
  propertySet: IdsValue;
  type: "property";
  value?: IdsValue;
}

export interface IdsClassificationFacet {
  cardinality: IdsCardinality;
  instructions?: string;
  system?: IdsValue;
  type: "classification";
  value?: IdsValue;
}

export interface IdsMaterialFacet {
  cardinality: IdsCardinality;
  instructions?: string;
  type: "material";
  value?: IdsValue;
}

export interface IdsPartOfFacet {
  cardinality: IdsCardinality;
  entityName?: IdsValue;
  entityPredefinedType?: IdsValue;
  instructions?: string;
  relation?: string;
  type: "partOf";
}

export type IdsFacet =
  | IdsAttributeFacet
  | IdsClassificationFacet
  | IdsEntityFacet
  | IdsMaterialFacet
  | IdsPartOfFacet
  | IdsPropertyFacet;

export interface IdsInfo {
  author?: string;
  copyright?: string;
  date?: string;
  description?: string;
  milestone?: string;
  purpose?: string;
  title?: string;
  version?: string;
}

export interface IdsSpecification {
  applicability: IdsFacet[];
  /** 0 = optional, 1 = mindestens ein anwendbares Objekt erforderlich. */
  applicabilityMinOccurs: number;
  /** null = unbegrenzt, 0 = anwendbare Objekte sind verboten. */
  applicabilityMaxOccurs: number | null;
  description?: string;
  id: string;
  identifier?: string;
  ifcVersions: string[];
  instructions?: string;
  name: string;
  requirements: IdsFacet[];
}

export interface IdsDocumentModel {
  fileName: string;
  info: IdsInfo;
  specifications: IdsSpecification[];
  /** Nicht-fatale Parser-Hinweise (unbekannte Facetten o. Ä.). */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export function parseIdsXml(
  text: string,
  fileName = "specification.ids",
): IdsDocumentModel {
  if (typeof DOMParser === "undefined") {
    throw new Error("Kein XML-Parser (DOMParser) in dieser Umgebung.");
  }
  const dom = new DOMParser().parseFromString(text, "application/xml");
  const parseError = dom.querySelector("parsererror");
  if (parseError) {
    throw new Error(
      `IDS-XML konnte nicht gelesen werden: ${firstLine(parseError.textContent ?? "")}`,
    );
  }
  const root = dom.documentElement;
  if (!root || localName(root) !== "ids") {
    throw new Error(
      `Kein IDS-Dokument: Wurzelelement ist <${root ? localName(root) : "?"}> statt <ids>.`,
    );
  }

  const warnings: string[] = [];
  const info = parseInfo(childByName(root, "info"));
  const specifications: IdsSpecification[] = [];
  const specParent = childByName(root, "specifications") ?? root;
  for (const [index, element] of childrenByName(
    specParent,
    "specification",
  ).entries()) {
    specifications.push(parseSpecification(element, index, warnings));
  }
  if (!specifications.length) {
    warnings.push("Die IDS-Datei enthält keine Spezifikationen.");
  }
  return { fileName, info, specifications, warnings };
}

function parseInfo(element: Element | undefined): IdsInfo {
  if (!element) {
    return {};
  }
  const read = (name: string) =>
    childByName(element, name)?.textContent?.trim() || undefined;
  return {
    author: read("author"),
    copyright: read("copyright"),
    date: read("date"),
    description: read("description"),
    milestone: read("milestone"),
    purpose: read("purpose"),
    title: read("title"),
    version: read("version"),
  };
}

function parseSpecification(
  element: Element,
  index: number,
  warnings: string[],
): IdsSpecification {
  const name =
    element.getAttribute("name")?.trim() || `Spezifikation ${index + 1}`;
  const applicabilityElement = childByName(element, "applicability");
  const requirementsElement = childByName(element, "requirements");
  const minOccursRaw = applicabilityElement?.getAttribute("minOccurs") ?? "0";
  const maxOccursRaw =
    applicabilityElement?.getAttribute("maxOccurs") ?? "unbounded";
  return {
    applicability: parseFacets(applicabilityElement, name, warnings, false),
    applicabilityMaxOccurs:
      maxOccursRaw === "unbounded" ? null : safeInteger(maxOccursRaw, null),
    applicabilityMinOccurs: safeInteger(minOccursRaw, 0) ?? 0,
    description: element.getAttribute("description")?.trim() || undefined,
    id: `spec-${index}`,
    identifier: element.getAttribute("identifier")?.trim() || undefined,
    ifcVersions: (element.getAttribute("ifcVersion") ?? "")
      .split(/\s+/)
      .map((version) => version.trim().toUpperCase())
      .filter(Boolean),
    instructions: element.getAttribute("instructions")?.trim() || undefined,
    name,
    requirements: parseFacets(requirementsElement, name, warnings, true),
  };
}

function parseFacets(
  parent: Element | undefined,
  specName: string,
  warnings: string[],
  withCardinality: boolean,
): IdsFacet[] {
  if (!parent) {
    return [];
  }
  const facets: IdsFacet[] = [];
  for (const element of elementChildren(parent)) {
    const facet = parseFacet(element, withCardinality);
    if (facet) {
      facets.push(facet);
    } else {
      warnings.push(
        `${specName}: Facette <${localName(element)}> wird nicht unterstützt und wurde übersprungen.`,
      );
    }
  }
  return facets;
}

function parseFacet(
  element: Element,
  withCardinality: boolean,
): IdsFacet | undefined {
  const cardinality = withCardinality
    ? parseCardinality(element.getAttribute("cardinality"))
    : "required";
  const instructions =
    element.getAttribute("instructions")?.trim() || undefined;
  switch (localName(element)) {
    case "entity": {
      const name = parseValue(childByName(element, "name"));
      if (!name) {
        return undefined;
      }
      return {
        name,
        predefinedType: parseValue(childByName(element, "predefinedType")),
        type: "entity",
      };
    }
    case "attribute": {
      const name = parseValue(childByName(element, "name"));
      if (!name) {
        return undefined;
      }
      return {
        cardinality,
        instructions,
        name,
        type: "attribute",
        value: parseValue(childByName(element, "value")),
      };
    }
    case "property": {
      const propertySet = parseValue(childByName(element, "propertySet"));
      const baseName = parseValue(childByName(element, "baseName"));
      if (!propertySet || !baseName) {
        return undefined;
      }
      return {
        baseName,
        cardinality,
        dataType:
          element.getAttribute("dataType")?.trim().toUpperCase() || undefined,
        instructions,
        propertySet,
        type: "property",
        value: parseValue(childByName(element, "value")),
      };
    }
    case "classification":
      return {
        cardinality,
        instructions,
        system: parseValue(childByName(element, "system")),
        type: "classification",
        value: parseValue(childByName(element, "value")),
      };
    case "material":
      return {
        cardinality,
        instructions,
        type: "material",
        value: parseValue(childByName(element, "value")),
      };
    case "partOf": {
      const entity = childByName(element, "entity");
      return {
        cardinality,
        entityName: entity ? parseValue(childByName(entity, "name")) : undefined,
        entityPredefinedType: entity
          ? parseValue(childByName(entity, "predefinedType"))
          : undefined,
        instructions,
        relation:
          element.getAttribute("relation")?.trim().toUpperCase() || undefined,
        type: "partOf",
      };
    }
    default:
      return undefined;
  }
}

function parseCardinality(raw: string | null): IdsCardinality {
  const value = raw?.trim().toLowerCase();
  return value === "optional" || value === "prohibited" ? value : "required";
}

function parseValue(element: Element | undefined): IdsValue | undefined {
  if (!element) {
    return undefined;
  }
  const simple = childByName(element, "simpleValue");
  if (simple) {
    return { kind: "simple", simple: simple.textContent ?? "" };
  }
  const restriction = childByName(element, "restriction");
  if (restriction) {
    return { kind: "restriction", restriction: parseRestriction(restriction) };
  }
  const text = element.textContent?.trim();
  return text ? { kind: "simple", simple: text } : undefined;
}

function parseRestriction(element: Element): IdsRestriction {
  const restriction: IdsRestriction = {
    base: element.getAttribute("base")?.trim() || undefined,
  };
  for (const child of elementChildren(element)) {
    const value = child.getAttribute("value") ?? "";
    switch (localName(child)) {
      case "enumeration":
        (restriction.enumeration ??= []).push(value);
        break;
      case "pattern":
        (restriction.patterns ??= []).push(value);
        break;
      case "minInclusive":
        restriction.minInclusive = Number(value);
        break;
      case "maxInclusive":
        restriction.maxInclusive = Number(value);
        break;
      case "minExclusive":
        restriction.minExclusive = Number(value);
        break;
      case "maxExclusive":
        restriction.maxExclusive = Number(value);
        break;
      case "length":
        restriction.length = safeInteger(value, undefined) ?? undefined;
        break;
      case "minLength":
        restriction.minLength = safeInteger(value, undefined) ?? undefined;
        break;
      case "maxLength":
        restriction.maxLength = safeInteger(value, undefined) ?? undefined;
        break;
      default:
        break;
    }
  }
  return restriction;
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

export type IdsSpecificationStatus = "fail" | "not-applicable" | "pass";

/**
 * Verstoß-Meldung: `segments` für die hervorgehobene Darstellung in der UI,
 * `text` als äquivalenter Klartext (Tooltips, Logs, Tests).
 */
export interface IdsMessage {
  segments: IdsTextSegment[];
  text: string;
}

export interface IdsEntityFailure {
  entityId: number;
  entityName: string;
  entityType: string;
  messages: IdsMessage[];
}

export interface IdsSpecificationResult {
  applicableCount: number;
  failures: IdsEntityFailure[];
  /** Meldungen auf Spezifikationsebene (Kardinalität, Schema, …). */
  messages: string[];
  passedCount: number;
  specification: IdsSpecification;
  status: IdsSpecificationStatus;
}

export interface IdsValidationSummary {
  failCount: number;
  notApplicableCount: number;
  passCount: number;
  results: IdsSpecificationResult[];
  totalChecked: number;
  totalFailures: number;
}

interface IdsModelContext {
  classificationsByEntity: Map<number, { system: string; value: string }[]>;
  document: NativeIfcDocument;
  materialsByEntity: Map<number, string[]>;
  psetCache: Map<number, IdsPsetView[]>;
  typeIdsByEntity: Map<number, number[]>;
}

interface IdsPsetView {
  /** STEP-ID der Pset-Entität — für klickbare Verweise in Meldungen. */
  id: number;
  name: string;
  properties: IdsPropertyView[];
}

interface IdsPropertyView {
  measure?: string;
  name: string;
  values: string[];
}

export function validateIds(
  document: NativeIfcDocument,
  ids: IdsDocumentModel,
): IdsValidationSummary {
  const context = buildModelContext(document);
  const results = ids.specifications.map((specification) =>
    validateSpecification(context, specification),
  );
  return {
    failCount: results.filter((result) => result.status === "fail").length,
    notApplicableCount: results.filter(
      (result) => result.status === "not-applicable",
    ).length,
    passCount: results.filter((result) => result.status === "pass").length,
    results,
    totalChecked: results.reduce(
      (sum, result) => sum + result.applicableCount,
      0,
    ),
    totalFailures: results.reduce(
      (sum, result) => sum + result.failures.length,
      0,
    ),
  };
}

function validateSpecification(
  context: IdsModelContext,
  specification: IdsSpecification,
): IdsSpecificationResult {
  const messages: string[] = [];

  const schema = context.document.schema.trim().toUpperCase();
  if (
    specification.ifcVersions.length &&
    !specification.ifcVersions.some(
      (version) => schema.startsWith(version) || version.startsWith(schema),
    )
  ) {
    return {
      applicableCount: 0,
      failures: [],
      messages: [
        `Gilt für ${specification.ifcVersions.join(", ")} — das Modell ist ${schema || "unbekannt"}. Spezifikation wurde übersprungen.`,
      ],
      passedCount: 0,
      specification,
      status: "not-applicable",
    };
  }

  const applicable = collectApplicableEntities(context, specification);

  if (specification.applicabilityMaxOccurs === 0) {
    if (applicable.length) {
      return {
        applicableCount: applicable.length,
        failures: applicable.map((entity) => ({
          entityId: entity.id,
          entityName: entity.name,
          entityType: entity.type,
          messages: [
            textMessage("Darf laut Spezifikation nicht im Modell vorkommen."),
          ],
        })),
        messages: [
          `${applicable.length.toLocaleString("de-DE")} verbotene Objekte gefunden.`,
        ],
        passedCount: 0,
        specification,
        status: "fail",
      };
    }
    return {
      applicableCount: 0,
      failures: [],
      messages: ["Keine verbotenen Objekte im Modell — bestanden."],
      passedCount: 0,
      specification,
      status: "pass",
    };
  }

  if (!applicable.length) {
    if (specification.applicabilityMinOccurs > 0) {
      return {
        applicableCount: 0,
        failures: [],
        messages: [
          "Erforderlich, aber kein passendes Objekt im Modell gefunden.",
        ],
        passedCount: 0,
        specification,
        status: "fail",
      };
    }
    return {
      applicableCount: 0,
      failures: [],
      messages: ["Kein anwendbares Objekt im Modell."],
      passedCount: 0,
      specification,
      status: "not-applicable",
    };
  }

  const failures: IdsEntityFailure[] = [];
  let passedCount = 0;
  for (const entity of applicable) {
    const entityMessages: IdsMessage[] = [];
    for (const facet of specification.requirements) {
      const check = checkFacet(context, entity, facet);
      const message = requirementMessage(facet, check);
      if (message) {
        entityMessages.push(message);
      }
    }
    if (entityMessages.length) {
      failures.push({
        entityId: entity.id,
        entityName: entity.name,
        entityType: entity.type,
        messages: entityMessages,
      });
    } else {
      passedCount += 1;
    }
  }

  return {
    applicableCount: applicable.length,
    failures,
    messages,
    passedCount,
    specification,
    status: failures.length ? "fail" : "pass",
  };
}

/** Kardinalität anwenden: required/prohibited/optional. */
function requirementMessage(
  facet: IdsFacet,
  check: IdsFacetCheck,
): IdsMessage | undefined {
  const cardinality =
    facet.type === "entity" ? "required" : facet.cardinality;
  if (cardinality === "required") {
    return check.matches ? undefined : check.message;
  }
  if (cardinality === "prohibited") {
    return check.matches
      ? buildMessage(
          textSegment(`${IDS_FACET_TYPE_LABELS[facet.type]} `),
          ...describeFacetBodySegments(facet),
          textSegment(": vorhanden, obwohl verboten."),
        )
      : undefined;
  }
  // optional: nur prüfen, wenn überhaupt vorhanden.
  return !check.exists || check.matches ? undefined : check.message;
}

function collectApplicableEntities(
  context: IdsModelContext,
  specification: IdsSpecification,
): NativeIfcEntity[] {
  const { document } = context;
  const entityFacet = specification.applicability.find(
    (facet): facet is IdsEntityFacet => facet.type === "entity",
  );

  let candidates: NativeIfcEntity[];
  const namedTypes = entityFacetTypeNames(entityFacet);
  if (namedTypes) {
    candidates = namedTypes.flatMap(
      (type) => document.entitiesByType.get(type) ?? [],
    );
  } else {
    // Ohne (aufzählbare) Entity-Facette nur gerootete Objekte betrachten.
    candidates = document.entities.filter((entity) => entity.globalId);
  }

  const seen = new Set<number>();
  const applicable: NativeIfcEntity[] = [];
  for (const entity of candidates) {
    if (seen.has(entity.id)) {
      continue;
    }
    seen.add(entity.id);
    const matchesAll = specification.applicability.every(
      (facet) => checkFacet(context, entity, facet).matches,
    );
    if (matchesAll) {
      applicable.push(entity);
    }
  }
  return applicable;
}

/** Konkrete Klassennamen einer Entity-Facette (simpleValue oder Enumeration). */
function entityFacetTypeNames(
  facet: IdsEntityFacet | undefined,
): string[] | undefined {
  if (!facet) {
    return undefined;
  }
  if (facet.name.kind === "simple") {
    return [normalizeTypeName(facet.name.simple ?? "")];
  }
  const enumeration = facet.name.restriction?.enumeration;
  if (enumeration?.length) {
    return enumeration.map(normalizeTypeName);
  }
  return undefined;
}

function normalizeTypeName(value: string) {
  return value.trim().toUpperCase();
}

// ---------------------------------------------------------------------------
// Facetten-Prüfung
// ---------------------------------------------------------------------------

interface IdsFacetCheck {
  /** Für optional-Kardinalität: gibt es das geprüfte Merkmal überhaupt? */
  exists: boolean;
  matches: boolean;
  message?: IdsMessage;
}

function checkFacet(
  context: IdsModelContext,
  entity: NativeIfcEntity,
  facet: IdsFacet,
): IdsFacetCheck {
  switch (facet.type) {
    case "entity":
      return checkEntityFacet(context, entity, facet);
    case "attribute":
      return checkAttributeFacet(context, entity, facet);
    case "property":
      return checkPropertyFacet(context, entity, facet);
    case "classification":
      return checkClassificationFacet(context, entity, facet);
    case "material":
      return checkMaterialFacet(context, entity, facet);
    case "partOf":
      return checkPartOfFacet(context, entity, facet);
  }
}

function checkEntityFacet(
  context: IdsModelContext,
  entity: NativeIfcEntity,
  facet: IdsEntityFacet,
): IdsFacetCheck {
  if (!valueMatches(facet.name, entity.type, { caseInsensitive: true })) {
    return {
      exists: true,
      matches: false,
      message: buildMessage(
        textSegment("Klasse "),
        codeSegment(entity.type),
        textSegment(" entspricht nicht "),
        ...describeValueSegments(facet.name),
        textSegment("."),
      ),
    };
  }
  if (facet.predefinedType) {
    const predefined = readPredefinedType(context, entity);
    if (!predefined || !valueMatches(facet.predefinedType, predefined)) {
      return {
        exists: Boolean(predefined),
        matches: false,
        message: buildMessage(
          textSegment("PredefinedType "),
          predefined ? codeSegment(predefined) : textSegment("(leer)"),
          textSegment(" entspricht nicht "),
          ...describeValueSegments(facet.predefinedType),
          textSegment("."),
        ),
      };
    }
  }
  return { exists: true, matches: true };
}

const SPATIAL_LONGNAME_TYPES = new Set([
  "IFCBUILDING",
  "IFCBUILDINGSTOREY",
  "IFCPROJECT",
  "IFCSITE",
  "IFCSPACE",
]);

function checkAttributeFacet(
  context: IdsModelContext,
  entity: NativeIfcEntity,
  facet: IdsAttributeFacet,
): IdsFacetCheck {
  if (facet.name.kind !== "simple") {
    return {
      exists: false,
      matches: false,
      message: textMessage(
        "Attribut-Facette mit Restriction als Name wird nicht unterstützt.",
      ),
    };
  }
  const attributeName = (facet.name.simple ?? "").trim();
  const attribute = readAttributeValue(context, entity, attributeName);
  if (!attribute.supported) {
    return {
      exists: false,
      matches: false,
      message: buildMessage(
        textSegment("Attribut "),
        valueSegment(attributeName),
        textSegment(" kann nicht geprüft werden (nicht unterstützt)."),
      ),
    };
  }
  const value = attribute.value ?? "";
  if (!value) {
    return {
      exists: false,
      matches: false,
      message: buildMessage(
        textSegment("Attribut "),
        valueSegment(attributeName),
        textSegment(" ist leer oder fehlt."),
      ),
    };
  }
  if (facet.value && !valueMatches(facet.value, value)) {
    return {
      exists: true,
      matches: false,
      message: buildMessage(
        textSegment("Attribut "),
        valueSegment(attributeName),
        textSegment(" = "),
        codeSegment(value),
        textSegment(" entspricht nicht "),
        ...describeValueSegments(facet.value),
        textSegment("."),
      ),
    };
  }
  return { exists: true, matches: true };
}

interface IdsPropertyMatch {
  property: IdsPropertyView;
  set: IdsPsetView;
}

/**
 * Property-Facette mit Fehlerortung: unterscheidet „kein passendes Pset“
 * (nennt die vorhandenen), „Property fehlt im gefundenen Pset“ (nennt Pset
 * und enthaltene Properties), „vorhanden, aber leer“ sowie Datentyp- und
 * Wertabweichungen — jeweils mit klickbarem Pset-Verweis.
 */
function checkPropertyFacet(
  context: IdsModelContext,
  entity: NativeIfcEntity,
  facet: IdsPropertyFacet,
): IdsFacetCheck {
  const sets = entityPsets(context, entity);
  const matchingSets = dedupeSetsById(
    sets.filter((set) => valueMatches(facet.propertySet, set.name)),
  );

  if (!matchingSets.length) {
    const available = dedupeSetsById(sets);
    return {
      exists: false,
      matches: false,
      message: buildMessage(
        textSegment("Kein Pset entspricht "),
        ...describeValueSegments(facet.propertySet),
        ...(available.length
          ? [
              textSegment(". Vorhandene Psets: "),
              ...joinSegmentGroups(
                available.slice(0, 6).map((set) => [refSegment(set)]),
              ),
              ...(available.length > 6 ? [textSegment(", …")] : []),
              textSegment("."),
            ]
          : [textSegment(" — das Objekt hat keine Psets.")]),
      ),
    };
  }

  const namedMatches: IdsPropertyMatch[] = matchingSets.flatMap((set) =>
    set.properties
      .filter((property) => valueMatches(facet.baseName, property.name))
      .map((property) => ({ property, set })),
  );

  if (!namedMatches.length) {
    const containedNames = [
      ...new Set(
        matchingSets.flatMap((set) =>
          set.properties.map((property) => property.name),
        ),
      ),
    ].filter(Boolean);
    return {
      exists: false,
      matches: false,
      message: buildMessage(
        textSegment("Property "),
        ...describeValueSegments(facet.baseName),
        textSegment(" fehlt im Pset "),
        ...joinSegmentGroups(
          matchingSets.slice(0, 3).map((set) => [refSegment(set)]),
        ),
        ...(containedNames.length
          ? [
              textSegment(" — enthalten: "),
              ...joinSegmentGroups(
                containedNames.slice(0, 8).map((name) => [codeSegment(name)]),
              ),
              ...(containedNames.length > 8 ? [textSegment(", …")] : []),
              textSegment("."),
            ]
          : [textSegment(" — das Pset hat keine Properties.")]),
      ),
    };
  }

  const candidates = namedMatches.filter(
    ({ property }) => property.values.length,
  );
  if (!candidates.length) {
    return {
      exists: false,
      matches: false,
      message: buildMessage(
        textSegment("Property "),
        ...joinSegmentGroups(
          namedMatches.slice(0, 2).map(({ property, set }) => [
            codeSegment(property.name),
            textSegment(" im Pset "),
            refSegment(set),
          ]),
        ),
        textSegment(" ist vorhanden, aber leer."),
      ),
    };
  }

  const dataTypeOk = ({ property }: IdsPropertyMatch) =>
    !facet.dataType || !property.measure || property.measure === facet.dataType;
  const valueOk = ({ property }: IdsPropertyMatch) =>
    !facet.value ||
    property.values.some((value) => valueMatches(facet.value as IdsValue, value));
  if (facet.dataType && !candidates.some(dataTypeOk)) {
    const first = candidates[0];
    return {
      exists: true,
      matches: false,
      message: buildMessage(
        textSegment("Property "),
        codeSegment(first.property.name),
        textSegment(" im Pset "),
        refSegment(first.set),
        textSegment(": Datentyp "),
        codeSegment(first.property.measure ?? "?"),
        textSegment(" statt "),
        codeSegment(facet.dataType),
        textSegment("."),
      ),
    };
  }
  const matched = candidates.some(
    (candidate) => dataTypeOk(candidate) && valueOk(candidate),
  );
  if (!matched) {
    const actualPairs = candidates
      .flatMap(({ property, set }) =>
        property.values.map((value) => ({ set, value })),
      )
      .slice(0, 3);
    return {
      exists: true,
      matches: false,
      message: buildMessage(
        textSegment("Property "),
        ...describeValueSegments(facet.baseName),
        textSegment(" = "),
        ...joinSegmentGroups(
          actualPairs.map(({ set, value }) => [
            codeSegment(value),
            textSegment(" (Pset "),
            refSegment(set),
            textSegment(")"),
          ]),
        ),
        textSegment(" entspricht nicht "),
        ...describeValueSegments(facet.value),
        textSegment("."),
      ),
    };
  }
  return { exists: true, matches: true };
}

function dedupeSetsById(sets: IdsPsetView[]): IdsPsetView[] {
  const seen = new Set<number>();
  const result: IdsPsetView[] = [];
  for (const set of sets) {
    if (!seen.has(set.id)) {
      seen.add(set.id);
      result.push(set);
    }
  }
  return result;
}

function refSegment(set: IdsPsetView): IdsTextSegment {
  return { entityId: set.id, kind: "ref", text: set.name };
}

function joinSegmentGroups(
  groups: IdsTextSegment[][],
  separator = ", ",
): IdsTextSegment[] {
  return groups.flatMap((group, index) =>
    index ? [textSegment(separator), ...group] : group,
  );
}

function checkClassificationFacet(
  context: IdsModelContext,
  entity: NativeIfcEntity,
  facet: IdsClassificationFacet,
): IdsFacetCheck {
  const entries = [
    ...(context.classificationsByEntity.get(entity.id) ?? []),
    ...typeIds(context, entity).flatMap(
      (typeId) => context.classificationsByEntity.get(typeId) ?? [],
    ),
  ];
  if (!entries.length) {
    return {
      exists: false,
      matches: false,
      message: textMessage("Keine Klassifikation zugeordnet."),
    };
  }
  const matched = entries.some((entry) => {
    if (facet.system && !valueMatches(facet.system, entry.system)) {
      return false;
    }
    if (facet.value) {
      // Hierarchische Referenzen: „Ss_20“ wird auch von „Ss_20_10“ erfüllt.
      if (facet.value.kind === "simple") {
        const expected = facet.value.simple ?? "";
        return entry.value === expected || entry.value.startsWith(expected);
      }
      return valueMatches(facet.value, entry.value);
    }
    return true;
  });
  if (!matched) {
    const actualSegments = entries.slice(0, 3).flatMap((entry, index) => [
      ...(index ? [textSegment(", ")] : []),
      ...(entry.system ? [codeSegment(entry.system), textSegment(": ")] : []),
      codeSegment(entry.value || "—"),
    ]);
    const expectedSegments: IdsTextSegment[] = [
      ...(facet.system
        ? [textSegment("System "), ...describeValueSegments(facet.system)]
        : []),
      ...(facet.system && facet.value ? [textSegment(", ")] : []),
      ...(facet.value
        ? [textSegment("Wert "), ...describeValueSegments(facet.value)]
        : []),
    ];
    return {
      exists: true,
      matches: false,
      message: buildMessage(
        textSegment("Klassifikation ("),
        ...actualSegments,
        textSegment(") entspricht nicht "),
        ...expectedSegments,
        textSegment("."),
      ),
    };
  }
  return { exists: true, matches: true };
}

function checkMaterialFacet(
  context: IdsModelContext,
  entity: NativeIfcEntity,
  facet: IdsMaterialFacet,
): IdsFacetCheck {
  const names = [
    ...(context.materialsByEntity.get(entity.id) ?? []),
    ...typeIds(context, entity).flatMap(
      (typeId) => context.materialsByEntity.get(typeId) ?? [],
    ),
  ];
  if (!names.length) {
    return {
      exists: false,
      matches: false,
      message: textMessage("Kein Material zugeordnet."),
    };
  }
  if (
    facet.value &&
    !names.some((name) => valueMatches(facet.value as IdsValue, name))
  ) {
    const actualSegments = names
      .slice(0, 3)
      .flatMap((name, index) =>
        index ? [textSegment(", "), codeSegment(name)] : [codeSegment(name)],
      );
    return {
      exists: true,
      matches: false,
      message: buildMessage(
        textSegment("Material ("),
        ...actualSegments,
        textSegment(") entspricht nicht "),
        ...describeValueSegments(facet.value),
        textSegment("."),
      ),
    };
  }
  return { exists: true, matches: true };
}

const PART_OF_FAMILIES: Record<string, string> = {
  IFCRELAGGREGATES: "aggregates",
  IFCRELCONTAINEDINSPATIALSTRUCTURE: "contains",
  IFCRELNESTS: "nests",
};

function checkPartOfFacet(
  context: IdsModelContext,
  entity: NativeIfcEntity,
  facet: IdsPartOfFacet,
): IdsFacetCheck {
  const family = facet.relation
    ? PART_OF_FAMILIES[facet.relation]
    : undefined;
  if (facet.relation && !family) {
    return {
      exists: false,
      matches: false,
      message: buildMessage(
        textSegment("partOf-Relation "),
        codeSegment(facet.relation),
        textSegment(" wird nicht unterstützt."),
      ),
    };
  }
  const ancestors = collectAncestors(context, entity.id, family);
  if (!ancestors.length) {
    return {
      exists: false,
      matches: false,
      message: textMessage(
        "Objekt ist keiner übergeordneten Struktur zugeordnet.",
      ),
    };
  }
  const matched = ancestors.some((ancestor) => {
    if (
      facet.entityName &&
      !valueMatches(facet.entityName, ancestor.type, { caseInsensitive: true })
    ) {
      return false;
    }
    if (facet.entityPredefinedType) {
      const predefined = readPredefinedType(context, ancestor);
      if (
        !predefined ||
        !valueMatches(facet.entityPredefinedType, predefined)
      ) {
        return false;
      }
    }
    return true;
  });
  if (!matched) {
    return {
      exists: true,
      matches: false,
      message: buildMessage(
        textSegment("Kein übergeordnetes Objekt entspricht "),
        ...describeValueSegments(facet.entityName),
        textSegment("."),
      ),
    };
  }
  return { exists: true, matches: true };
}

function collectAncestors(
  context: IdsModelContext,
  entityId: number,
  family: string | undefined,
): NativeIfcEntity[] {
  const ancestors: NativeIfcEntity[] = [];
  const visited = new Set<number>([entityId]);
  let frontier = [entityId];
  for (let depth = 0; depth < 50 && frontier.length; depth += 1) {
    const next: number[] = [];
    for (const id of frontier) {
      for (const relationship of
        context.document.relationshipsByEntity.get(id) ?? []) {
        if (family && relationship.family !== family) {
          continue;
        }
        if (!family && !HIERARCHY_FAMILIES.has(relationship.family)) {
          continue;
        }
        if (!relationship.targetIds.includes(id)) {
          continue;
        }
        for (const parentId of relationship.sourceIds) {
          if (visited.has(parentId)) {
            continue;
          }
          visited.add(parentId);
          const parent = context.document.entityById.get(parentId);
          if (parent) {
            ancestors.push(parent);
            next.push(parentId);
          }
        }
      }
    }
    frontier = next;
  }
  return ancestors;
}

const HIERARCHY_FAMILIES = new Set(["aggregates", "contains", "nests"]);

// ---------------------------------------------------------------------------
// Modell-Indizes
// ---------------------------------------------------------------------------

function buildModelContext(document: NativeIfcDocument): IdsModelContext {
  const classificationsByEntity = new Map<
    number,
    { system: string; value: string }[]
  >();
  const materialsByEntity = new Map<number, string[]>();
  const typeIdsByEntity = new Map<number, number[]>();

  for (const rel of document.entities) {
    if (rel.type === "IFCRELASSOCIATESCLASSIFICATION") {
      const entry = readClassificationEntry(
        document,
        readRefs(rel.args[5])[0],
      );
      if (entry) {
        for (const objectId of readRefs(rel.args[4])) {
          pushMapValue(classificationsByEntity, objectId, entry);
        }
      }
    } else if (rel.type === "IFCRELASSOCIATESMATERIAL") {
      const names = readMaterialNames(document, readRefs(rel.args[5])[0]);
      if (names.length) {
        for (const objectId of readRefs(rel.args[4])) {
          for (const name of names) {
            pushMapValue(materialsByEntity, objectId, name);
          }
        }
      }
    }
  }

  for (const [entityId, assignments] of document.typeAssignmentsByEntity) {
    typeIdsByEntity.set(
      entityId,
      assignments.map((assignment) => assignment.typeId),
    );
  }

  return {
    classificationsByEntity,
    document,
    materialsByEntity,
    psetCache: new Map(),
    typeIdsByEntity,
  };
}

function readClassificationEntry(
  document: NativeIfcDocument,
  referenceId: number | undefined,
): { system: string; value: string } | undefined {
  let current: NativeIfcEntity | undefined = referenceId
    ? document.entityById.get(referenceId)
    : undefined;
  if (!current) {
    return undefined;
  }
  if (current.type === "IFCCLASSIFICATION") {
    return { system: decodeScalar(current.args[3]), value: "" };
  }
  if (current.type !== "IFCCLASSIFICATIONREFERENCE") {
    return undefined;
  }
  const value = decodeScalar(current.args[1]) || decodeScalar(current.args[2]);
  // ReferencedSource-Kette bis zur IFCCLASSIFICATION hochlaufen.
  let system = "";
  for (let depth = 0; depth < 10 && current; depth += 1) {
    const sourceId: number | undefined = readRefs(current.args[3])[0];
    const source: NativeIfcEntity | undefined =
      sourceId == null ? undefined : document.entityById.get(sourceId);
    if (!source) {
      break;
    }
    if (source.type === "IFCCLASSIFICATION") {
      system = decodeScalar(source.args[3]);
      break;
    }
    current = source;
  }
  return { system, value };
}

function readMaterialNames(
  document: NativeIfcDocument,
  materialId: number | undefined,
): string[] {
  if (!materialId) {
    return [];
  }
  const names: string[] = [];
  const visited = new Set<number>();
  let frontier = [materialId];
  for (let depth = 0; depth < 5 && frontier.length; depth += 1) {
    const next: number[] = [];
    for (const id of frontier) {
      if (visited.has(id)) {
        continue;
      }
      visited.add(id);
      const entity = document.entityById.get(id);
      if (!entity || !entity.type.startsWith("IFCMATERIAL")) {
        continue;
      }
      if (entity.type === "IFCMATERIAL") {
        const name = decodeScalar(entity.args[0]);
        if (name) {
          names.push(name);
        }
        continue;
      }
      for (const arg of entity.args) {
        for (const ref of readRefs(arg)) {
          next.push(ref);
        }
      }
    }
    frontier = next;
  }
  return names;
}

function typeIds(context: IdsModelContext, entity: NativeIfcEntity) {
  return context.typeIdsByEntity.get(entity.id) ?? [];
}

/** Psets des Objekts plus (nachrangig) Psets seiner Typen. */
function entityPsets(
  context: IdsModelContext,
  entity: NativeIfcEntity,
): IdsPsetView[] {
  const cached = context.psetCache.get(entity.id);
  if (cached) {
    return cached;
  }
  const views: IdsPsetView[] = [];
  for (const set of context.document.propertySetsByEntity.get(entity.id) ??
    []) {
    views.push(psetViewFromIndex(context, set.id, set.name));
  }
  for (const typeId of typeIds(context, entity)) {
    const typeEntity = context.document.entityById.get(typeId);
    // IfcTypeObject.HasPropertySets (Argument 5) referenziert Psets direkt.
    for (const setId of readRefs(typeEntity?.args[5] ?? "")) {
      const setEntity = context.document.entityById.get(setId);
      if (setEntity?.type === "IFCPROPERTYSET") {
        views.push(
          psetViewFromIndex(context, setId, decodeScalar(setEntity.args[2])),
        );
      }
    }
  }
  context.psetCache.set(entity.id, views);
  return views;
}

function psetViewFromIndex(
  context: IdsModelContext,
  setId: number,
  name: string,
): IdsPsetView {
  const setEntity = context.document.entityById.get(setId);
  const refIndex = setEntity?.type === "IFCELEMENTQUANTITY" ? 5 : 4;
  const properties: IdsPropertyView[] = [];
  for (const propertyId of readRefs(setEntity?.args[refIndex] ?? "")) {
    const property = context.document.entityById.get(propertyId);
    if (property) {
      properties.push(propertyView(property));
    }
  }
  return { id: setId, name, properties };
}

const QUANTITY_MEASURES: Record<string, string> = {
  IFCQUANTITYAREA: "IFCAREAMEASURE",
  IFCQUANTITYCOUNT: "IFCCOUNTMEASURE",
  IFCQUANTITYLENGTH: "IFCLENGTHMEASURE",
  IFCQUANTITYTIME: "IFCTIMEMEASURE",
  IFCQUANTITYVOLUME: "IFCVOLUMEMEASURE",
  IFCQUANTITYWEIGHT: "IFCMASSMEASURE",
};

function propertyView(entity: NativeIfcEntity): IdsPropertyView {
  const name = decodeScalar(entity.args[0]);
  if (entity.type.startsWith("IFCQUANTITY")) {
    const value = decodeScalar(entity.args[3]);
    return {
      measure: QUANTITY_MEASURES[entity.type],
      name,
      values: value ? [value] : [],
    };
  }
  if (
    entity.type === "IFCPROPERTYLISTVALUE" ||
    entity.type === "IFCPROPERTYENUMERATEDVALUE"
  ) {
    const raw = (entity.args[2] ?? "").trim();
    const items = raw && raw !== "$"
      ? splitTopLevel(raw.replace(/^\(/, "").replace(/\)$/, ""))
      : [];
    return {
      measure: measureOf(items[0]),
      name,
      values: items.map(decodeScalar).filter(Boolean),
    };
  }
  if (entity.type === "IFCPROPERTYBOUNDEDVALUE") {
    const values = [entity.args[2], entity.args[3], entity.args[5]]
      .map((arg) => decodeScalar(arg ?? ""))
      .filter(Boolean);
    return { measure: measureOf(entity.args[2]), name, values };
  }
  const value = decodeScalar(entity.args[2]);
  return {
    measure: measureOf(entity.args[2]),
    name,
    values: value ? [value] : [],
  };
}

function measureOf(raw = "") {
  const match = /^([A-Za-z][A-Za-z0-9_]*)\(/.exec(raw.trim());
  return match ? match[1].toUpperCase() : undefined;
}

function readPredefinedType(
  context: IdsModelContext,
  entity: NativeIfcEntity,
): string {
  let value = firstEnumArg(entity, 4);
  if (!value || value === "NOTDEFINED") {
    for (const typeId of typeIds(context, entity)) {
      const typeEntity = context.document.entityById.get(typeId);
      const typeValue = typeEntity ? firstEnumArg(typeEntity, 6) : "";
      if (typeValue && typeValue !== "NOTDEFINED") {
        value = typeValue;
        break;
      }
    }
  }
  if (value === "USERDEFINED") {
    const objectType = decodeScalar(entity.args[4]);
    return objectType || value;
  }
  return value;
}

function firstEnumArg(entity: NativeIfcEntity, fromIndex: number) {
  for (let index = fromIndex; index < entity.args.length; index += 1) {
    const match = /^\.([A-Z_][A-Z_0-9]*)\.$/.exec(
      (entity.args[index] ?? "").trim(),
    );
    if (match) {
      return match[1];
    }
  }
  return "";
}

interface AttributeReadResult {
  supported: boolean;
  value?: string;
}

function readAttributeValue(
  context: IdsModelContext,
  entity: NativeIfcEntity,
  name: string,
): AttributeReadResult {
  switch (name.trim().toLowerCase()) {
    case "globalid":
      return { supported: true, value: entity.globalId };
    case "name":
      return { supported: true, value: entity.name };
    case "description":
      return { supported: true, value: entity.description };
    case "objecttype":
      return { supported: true, value: decodeScalar(entity.args[4]) };
    case "tag":
      if (SPATIAL_LONGNAME_TYPES.has(entity.type)) {
        return { supported: false };
      }
      return { supported: true, value: decodeScalar(entity.args[7]) };
    case "longname":
      if (!SPATIAL_LONGNAME_TYPES.has(entity.type)) {
        return { supported: false };
      }
      return { supported: true, value: decodeScalar(entity.args[7]) };
    case "predefinedtype":
      return { supported: true, value: readPredefinedType(context, entity) };
    default:
      return { supported: false };
  }
}

// ---------------------------------------------------------------------------
// Wert-Matching
// ---------------------------------------------------------------------------

export function valueMatches(
  idsValue: IdsValue | undefined,
  actual: string,
  options?: { caseInsensitive?: boolean },
): boolean {
  if (!idsValue) {
    return true;
  }
  if (idsValue.kind === "simple") {
    return scalarEquals(idsValue.simple ?? "", actual, options);
  }
  const restriction = idsValue.restriction ?? {};
  if (
    restriction.enumeration &&
    !restriction.enumeration.some((item) =>
      scalarEquals(item, actual, options),
    )
  ) {
    return false;
  }
  if (restriction.patterns?.length) {
    const matched = restriction.patterns.some((pattern) =>
      xsdPatternTest(pattern, actual),
    );
    if (!matched) {
      return false;
    }
  }
  const numeric = Number(actual);
  const needsNumber =
    restriction.minInclusive != null ||
    restriction.maxInclusive != null ||
    restriction.minExclusive != null ||
    restriction.maxExclusive != null;
  if (needsNumber) {
    if (!Number.isFinite(numeric)) {
      return false;
    }
    if (restriction.minInclusive != null && numeric < restriction.minInclusive) {
      return false;
    }
    if (restriction.maxInclusive != null && numeric > restriction.maxInclusive) {
      return false;
    }
    if (restriction.minExclusive != null && numeric <= restriction.minExclusive) {
      return false;
    }
    if (restriction.maxExclusive != null && numeric >= restriction.maxExclusive) {
      return false;
    }
  }
  if (restriction.length != null && actual.length !== restriction.length) {
    return false;
  }
  if (restriction.minLength != null && actual.length < restriction.minLength) {
    return false;
  }
  if (restriction.maxLength != null && actual.length > restriction.maxLength) {
    return false;
  }
  return true;
}

function scalarEquals(
  expected: string,
  actual: string,
  options?: { caseInsensitive?: boolean },
) {
  const expectedNumber = Number(expected);
  const actualNumber = Number(actual);
  if (
    expected.trim() !== "" &&
    actual.trim() !== "" &&
    Number.isFinite(expectedNumber) &&
    Number.isFinite(actualNumber)
  ) {
    const tolerance =
      1e-6 * Math.max(1, Math.abs(expectedNumber), Math.abs(actualNumber));
    return Math.abs(expectedNumber - actualNumber) <= tolerance;
  }
  if (options?.caseInsensitive) {
    return expected.trim().toUpperCase() === actual.trim().toUpperCase();
  }
  return expected === actual;
}

function xsdPatternTest(pattern: string, actual: string) {
  for (const flags of ["u", ""]) {
    try {
      return new RegExp(`^(?:${pattern})$`, flags).test(actual);
    } catch {
      // Ungültig in diesem Modus — nächsten Versuch probieren.
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Beschreibungen (für die UI)
// ---------------------------------------------------------------------------

export const IDS_FACET_TYPE_LABELS: Record<IdsFacet["type"], string> = {
  attribute: "Attribut",
  classification: "Klassifikation",
  entity: "Entität",
  material: "Material",
  partOf: "Teil von",
  property: "Property",
};

/**
 * Beschreibungssegment: „value“ ist ein konkreter Fachwert aus der IDS
 * (Pset-Name, Property-Name, Sollwert), „code“ ein technisches Token bzw.
 * Ist-Wert aus dem Modell (Regex, Datentyp, Zahl), „ref“ ein klickbarer
 * Modellverweis (mit entityId), „text“ verbindendes Schlüsselwort. Die UI
 * hebt value/code/ref gegenüber dem Fließtext hervor; stringifySegments
 * setzt daraus den Klartext zusammen.
 */
export interface IdsTextSegment {
  /** Bei kind "ref": STEP-ID des referenzierten Objekts (klickbar in der UI). */
  entityId?: number;
  kind: "code" | "ref" | "text" | "value";
  text: string;
}

/**
 * Lesbare Wertbeschreibung: einfache XSD-Muster werden zu Aufzählungen
 * expandiert („Bauwerk“, „Pset_Bauwerk“ oder …) bzw. als „beginnt mit …“/
 * „endet auf …“ formuliert; nur nicht auflösbare Muster bleiben als Regex.
 */
export function describeValue(value: IdsValue | undefined): string {
  return stringifySegments(describeValueSegments(value));
}

export function describeValueSegments(
  value: IdsValue | undefined,
): IdsTextSegment[] {
  if (!value) {
    return [textSegment("beliebig")];
  }
  if (value.kind === "simple") {
    return [valueSegment(value.simple ?? "")];
  }
  const restriction = value.restriction ?? {};
  const parts: IdsTextSegment[][] = [];
  if (restriction.enumeration?.length) {
    parts.push(variantListSegments(restriction.enumeration));
  }
  for (const pattern of restriction.patterns ?? []) {
    parts.push(patternSegments(pattern));
  }
  if (restriction.minInclusive != null) {
    parts.push([textSegment("≥ "), codeSegment(String(restriction.minInclusive))]);
  }
  if (restriction.maxInclusive != null) {
    parts.push([textSegment("≤ "), codeSegment(String(restriction.maxInclusive))]);
  }
  if (restriction.minExclusive != null) {
    parts.push([textSegment("> "), codeSegment(String(restriction.minExclusive))]);
  }
  if (restriction.maxExclusive != null) {
    parts.push([textSegment("< "), codeSegment(String(restriction.maxExclusive))]);
  }
  if (restriction.length != null) {
    parts.push([textSegment("Länge "), codeSegment(String(restriction.length))]);
  }
  if (restriction.minLength != null) {
    parts.push([textSegment("Länge ≥ "), codeSegment(String(restriction.minLength))]);
  }
  if (restriction.maxLength != null) {
    parts.push([textSegment("Länge ≤ "), codeSegment(String(restriction.maxLength))]);
  }
  if (!parts.length) {
    return [textSegment("beliebig")];
  }
  return parts.flatMap((part, index) =>
    index ? [textSegment(", "), ...part] : part,
  );
}

/** Technische Wertbeschreibung mit Roh-Mustern (für Tooltips). */
export function describeValueTechnical(value: IdsValue | undefined): string {
  return renderValue(value, (pattern) => `Muster /${pattern}/`);
}

function renderValue(
  value: IdsValue | undefined,
  renderPattern: (pattern: string) => string,
): string {
  if (!value) {
    return "beliebig";
  }
  if (value.kind === "simple") {
    return `„${value.simple ?? ""}“`;
  }
  const restriction = value.restriction ?? {};
  const parts: string[] = [];
  if (restriction.enumeration?.length) {
    parts.push(formatVariantList(restriction.enumeration));
  }
  for (const pattern of restriction.patterns ?? []) {
    parts.push(renderPattern(pattern));
  }
  if (restriction.minInclusive != null) {
    parts.push(`≥ ${restriction.minInclusive}`);
  }
  if (restriction.maxInclusive != null) {
    parts.push(`≤ ${restriction.maxInclusive}`);
  }
  if (restriction.minExclusive != null) {
    parts.push(`> ${restriction.minExclusive}`);
  }
  if (restriction.maxExclusive != null) {
    parts.push(`< ${restriction.maxExclusive}`);
  }
  if (restriction.length != null) {
    parts.push(`Länge ${restriction.length}`);
  }
  if (restriction.minLength != null) {
    parts.push(`Länge ≥ ${restriction.minLength}`);
  }
  if (restriction.maxLength != null) {
    parts.push(`Länge ≤ ${restriction.maxLength}`);
  }
  return parts.length ? parts.join(", ") : "beliebig";
}

/**
 * Ziffern-Läufe (`[0-9]*`, `\d+`, …) werden für die ANZEIGE durch das in den
 * Fach-IDS übliche Kürzel `<n>` ersetzt, damit z. B. `Untersuchungsziel[0-9]*`
 * als „Untersuchungsziel<n>“ aufzählbar wird. Das Matching selbst läuft
 * weiterhin über das Original-Muster.
 */
function displayPattern(pattern: string): string {
  return pattern
    .replaceAll("[0-9]*", "<n>")
    .replaceAll("[0-9]+", "<n>")
    .replaceAll("\\d*", "<n>")
    .replaceAll("\\d+", "<n>");
}

function patternSegments(pattern: string): IdsTextSegment[] {
  if (pattern === ".*" || pattern === ".+") {
    return [textSegment("beliebig")];
  }
  const display = displayPattern(pattern);
  const variants = expandXsdPattern(display);
  if (variants?.some(Boolean)) {
    return variantListSegments(variants.filter(Boolean));
  }
  if (
    display.length > 4 &&
    display.startsWith(".*") &&
    display.endsWith(".*")
  ) {
    const inner = expandXsdPattern(display.slice(2, -2));
    if (inner?.some(Boolean)) {
      return [
        textSegment("enthält "),
        ...variantListSegments(inner.filter(Boolean)),
      ];
    }
  }
  if (display.startsWith(".*")) {
    const inner = expandXsdPattern(display.slice(2));
    if (inner?.some(Boolean)) {
      return [
        textSegment("endet auf "),
        ...variantListSegments(inner.filter(Boolean)),
      ];
    }
  }
  if (display.endsWith(".*")) {
    const inner = expandXsdPattern(display.slice(0, -2));
    if (inner?.some(Boolean)) {
      return [
        textSegment("beginnt mit "),
        ...variantListSegments(inner.filter(Boolean)),
      ];
    }
  }
  return [textSegment("Muster "), codeSegment(`/${pattern}/`)];
}

const VARIANT_DISPLAY_CAP = 8;

function variantListSegments(variants: string[]): IdsTextSegment[] {
  const shown = variants.slice(0, VARIANT_DISPLAY_CAP);
  const overflow = variants.length > VARIANT_DISPLAY_CAP;
  const segments: IdsTextSegment[] = [];
  shown.forEach((variant, index) => {
    if (index > 0) {
      const beforeLast = index === shown.length - 1;
      segments.push(textSegment(beforeLast && !overflow ? " oder " : ", "));
    }
    segments.push(valueSegment(variant));
  });
  if (overflow) {
    segments.push(textSegment(", …"));
  }
  return segments;
}

function formatVariantList(variants: string[]): string {
  return stringifySegments(variantListSegments(variants));
}

export function stringifySegments(segments: IdsTextSegment[]): string {
  return segments
    .map((segment) =>
      segment.kind === "value" || segment.kind === "ref"
        ? `„${segment.text}“`
        : segment.text,
    )
    .join("");
}

function buildMessage(...segments: IdsTextSegment[]): IdsMessage {
  return { segments, text: stringifySegments(segments) };
}

function textMessage(text: string): IdsMessage {
  return buildMessage(textSegment(text));
}

function textSegment(text: string): IdsTextSegment {
  return { kind: "text", text };
}

function valueSegment(text: string): IdsTextSegment {
  return { kind: "value", text };
}

function codeSegment(text: string): IdsTextSegment {
  return { kind: "code", text };
}

export function describeFacet(facet: IdsFacet): string {
  return `${IDS_FACET_TYPE_LABELS[facet.type]} ${describeFacetBody(facet)}`;
}

/** Wie describeFacet, aber ohne das führende Typwort (für die Facetten-Chips). */
export function describeFacetBody(facet: IdsFacet): string {
  return stringifySegments(describeFacetBodySegments(facet));
}

/** Facettenbeschreibung als Segmente, damit die UI Werte hervorheben kann. */
export function describeFacetBodySegments(facet: IdsFacet): IdsTextSegment[] {
  switch (facet.type) {
    case "entity":
      return [
        ...describeValueSegments(facet.name),
        ...(facet.predefinedType
          ? [
              textSegment(" (PredefinedType "),
              ...describeValueSegments(facet.predefinedType),
              textSegment(")"),
            ]
          : []),
      ];
    case "attribute":
      return [
        ...describeValueSegments(facet.name),
        ...(facet.value
          ? [textSegment(" = "), ...describeValueSegments(facet.value)]
          : [textSegment(" vorhanden")]),
      ];
    case "property":
      return [
        ...describeValueSegments(facet.baseName),
        textSegment(" im Pset "),
        ...describeValueSegments(facet.propertySet),
        ...(facet.value
          ? [textSegment(" = "), ...describeValueSegments(facet.value)]
          : [textSegment(" vorhanden")]),
        ...(facet.dataType
          ? [textSegment(" ("), codeSegment(facet.dataType), textSegment(")")]
          : []),
      ];
    case "classification": {
      if (!facet.system && !facet.value) {
        return [textSegment("vorhanden")];
      }
      const segments: IdsTextSegment[] = [];
      if (facet.system) {
        segments.push(
          textSegment("System "),
          ...describeValueSegments(facet.system),
        );
      }
      if (facet.system && facet.value) {
        segments.push(textSegment(", "));
      }
      if (facet.value) {
        segments.push(
          textSegment("Wert "),
          ...describeValueSegments(facet.value),
        );
      }
      return segments;
    }
    case "material":
      return facet.value
        ? describeValueSegments(facet.value)
        : [textSegment("vorhanden")];
    case "partOf":
      return [
        ...describeValueSegments(facet.entityName),
        ...(facet.relation
          ? [textSegment(" über "), codeSegment(facet.relation)]
          : []),
      ];
  }
}

/** Technische Facettenbeschreibung mit Roh-Mustern (für Tooltips). */
export function describeFacetTechnical(facet: IdsFacet): string {
  return `${IDS_FACET_TYPE_LABELS[facet.type]} ${facetBody(facet, describeValueTechnical)}`;
}

function facetBody(
  facet: IdsFacet,
  render: (value: IdsValue | undefined) => string,
): string {
  switch (facet.type) {
    case "entity":
      return `${render(facet.name)}${
        facet.predefinedType
          ? ` (PredefinedType ${render(facet.predefinedType)})`
          : ""
      }`;
    case "attribute":
      return `${render(facet.name)}${
        facet.value ? ` = ${render(facet.value)}` : " vorhanden"
      }`;
    case "property":
      return `${render(facet.baseName)} im Pset ${render(facet.propertySet)}${
        facet.value ? ` = ${render(facet.value)}` : " vorhanden"
      }${facet.dataType ? ` (${facet.dataType})` : ""}`;
    case "classification":
      return facet.system || facet.value
        ? `${facet.system ? `System ${render(facet.system)}` : ""}${
            facet.system && facet.value ? ", " : ""
          }${facet.value ? `Wert ${render(facet.value)}` : ""}`
        : "vorhanden";
    case "material":
      return facet.value ? render(facet.value) : "vorhanden";
    case "partOf":
      return `${render(facet.entityName)}${
        facet.relation ? ` über ${facet.relation}` : ""
      }`;
  }
}

// ---------------------------------------------------------------------------
// XSD-Muster in Klartext expandieren
// ---------------------------------------------------------------------------

const PATTERN_EXPANSION_LIMIT = 24;

/**
 * Expandiert ein einfaches XSD-Regex-Muster in seine endliche Wertemenge
 * (Alternationen, optionale Gruppen, kleine Zeichenklassen und {m,n}).
 * Liefert undefined bei unbegrenzten Konstrukten (`*`, `+`, `.`, `\d`, …)
 * oder wenn mehr als PATTERN_EXPANSION_LIMIT Varianten entstünden.
 */
export function expandXsdPattern(pattern: string): string[] | undefined {
  const parser = new PatternExpander(pattern);
  const variants = parser.parseAlternation();
  if (!variants || parser.index < pattern.length) {
    return undefined;
  }
  const unique = [...new Set(variants)];
  return unique.length <= PATTERN_EXPANSION_LIMIT ? unique : undefined;
}

class PatternExpander {
  index = 0;

  constructor(private readonly pattern: string) {}

  parseAlternation(): string[] | undefined {
    let variants = this.parseConcat();
    if (!variants) {
      return undefined;
    }
    while (this.pattern[this.index] === "|") {
      this.index += 1;
      const branch = this.parseConcat();
      if (!branch) {
        return undefined;
      }
      variants = [...variants, ...branch];
      if (variants.length > PATTERN_EXPANSION_LIMIT) {
        return undefined;
      }
    }
    return variants;
  }

  private parseConcat(): string[] | undefined {
    let variants = [""];
    while (
      this.index < this.pattern.length &&
      this.pattern[this.index] !== "|" &&
      this.pattern[this.index] !== ")"
    ) {
      const atom = this.parseRepeat();
      if (!atom) {
        return undefined;
      }
      const combined: string[] = [];
      for (const left of variants) {
        for (const right of atom) {
          combined.push(left + right);
          if (combined.length > PATTERN_EXPANSION_LIMIT) {
            return undefined;
          }
        }
      }
      variants = combined;
    }
    return variants;
  }

  private parseRepeat(): string[] | undefined {
    const atom = this.parseAtom();
    if (!atom) {
      return undefined;
    }
    const next = this.pattern[this.index];
    if (next === "?") {
      this.index += 1;
      return ["", ...atom];
    }
    if (next === "*" || next === "+") {
      return undefined;
    }
    if (next === "{") {
      const match = /^\{(\d+)(?:,(\d+))?\}/.exec(
        this.pattern.slice(this.index),
      );
      if (!match) {
        return undefined;
      }
      const min = Number(match[1]);
      const max = match[2] != null ? Number(match[2]) : min;
      if (max < min || max > 4) {
        return undefined;
      }
      this.index += match[0].length;
      const results: string[] = [];
      for (let count = min; count <= max; count += 1) {
        let current = [""];
        for (let step = 0; step < count; step += 1) {
          const combined: string[] = [];
          for (const left of current) {
            for (const right of atom) {
              combined.push(left + right);
              if (combined.length > PATTERN_EXPANSION_LIMIT) {
                return undefined;
              }
            }
          }
          current = combined;
        }
        results.push(...current);
        if (results.length > PATTERN_EXPANSION_LIMIT) {
          return undefined;
        }
      }
      return results;
    }
    return atom;
  }

  private parseAtom(): string[] | undefined {
    const char = this.pattern[this.index];
    if (char == null) {
      return undefined;
    }
    if (char === "(") {
      this.index += 1;
      if (this.pattern.startsWith("?:", this.index)) {
        this.index += 2;
      } else if (this.pattern[this.index] === "?") {
        // Lookahead/Lookbehind — nicht expandierbar.
        return undefined;
      }
      const inner = this.parseAlternation();
      if (!inner || this.pattern[this.index] !== ")") {
        return undefined;
      }
      this.index += 1;
      return inner;
    }
    if (char === "[") {
      return this.parseCharClass();
    }
    if (char === "\\") {
      const escaped = this.pattern[this.index + 1];
      if (escaped == null || /[dDwWsSbB]/.test(escaped)) {
        return undefined;
      }
      this.index += 2;
      return [unescapePatternChar(escaped)];
    }
    if (".^$*+?{}|)".includes(char)) {
      return undefined;
    }
    this.index += 1;
    return [char];
  }

  private parseCharClass(): string[] | undefined {
    let cursor = this.index + 1;
    if (this.pattern[cursor] === "^") {
      return undefined;
    }
    const chars: string[] = [];
    const readChar = (): string | undefined => {
      const char = this.pattern[cursor];
      if (char == null || char === "]") {
        return undefined;
      }
      if (char === "\\") {
        const escaped = this.pattern[cursor + 1];
        if (escaped == null || /[dDwWsS]/.test(escaped)) {
          return undefined;
        }
        cursor += 2;
        return unescapePatternChar(escaped);
      }
      cursor += 1;
      return char;
    };
    while (cursor < this.pattern.length && this.pattern[cursor] !== "]") {
      const start = readChar();
      if (start == null) {
        return undefined;
      }
      if (this.pattern[cursor] === "-" && this.pattern[cursor + 1] !== "]") {
        cursor += 1;
        const end = readChar();
        if (end == null) {
          return undefined;
        }
        const startCode = start.charCodeAt(0);
        const endCode = end.charCodeAt(0);
        if (
          endCode < startCode ||
          endCode - startCode + 1 > PATTERN_EXPANSION_LIMIT
        ) {
          return undefined;
        }
        for (let code = startCode; code <= endCode; code += 1) {
          chars.push(String.fromCharCode(code));
        }
      } else {
        chars.push(start);
      }
      if (chars.length > PATTERN_EXPANSION_LIMIT) {
        return undefined;
      }
    }
    if (this.pattern[cursor] !== "]") {
      return undefined;
    }
    this.index = cursor + 1;
    return chars;
  }
}

function unescapePatternChar(char: string): string {
  switch (char) {
    case "n":
      return "\n";
    case "r":
      return "\r";
    case "t":
      return "\t";
    default:
      return char;
  }
}

export function describeCardinality(cardinality: IdsCardinality): string {
  switch (cardinality) {
    case "optional":
      return "optional";
    case "prohibited":
      return "verboten";
    case "required":
      return "erforderlich";
  }
}

// ---------------------------------------------------------------------------
// Kleine Helfer
// ---------------------------------------------------------------------------

function decodeScalar(raw = ""): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "$" || trimmed === "*") {
    return "";
  }
  const enumMatch = /^\.(.+)\.$/.exec(trimmed);
  if (enumMatch) {
    return enumMatch[1];
  }
  const typedMatch = /^[A-Za-z][A-Za-z0-9_]*\((.*)\)$/.exec(trimmed);
  if (typedMatch) {
    return decodeScalar(typedMatch[1]);
  }
  const unquoted = unquoteStepString(trimmed);
  return unquoted != null ? unquoted : trimmed;
}

function readRefs(raw = ""): number[] {
  const matches = raw.match(/#\d+/g);
  return matches ? matches.map((match) => Number(match.slice(1))) : [];
}

function pushMapValue<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const values = map.get(key);
  if (values) {
    values.push(value);
  } else {
    map.set(key, [value]);
  }
}

function localName(element: Element) {
  return element.localName ?? element.tagName.replace(/^.*:/, "");
}

function elementChildren(parent: Element): Element[] {
  return [...parent.children];
}

function childByName(parent: Element, name: string): Element | undefined {
  return elementChildren(parent).find((child) => localName(child) === name);
}

function childrenByName(parent: Element, name: string): Element[] {
  return elementChildren(parent).filter((child) => localName(child) === name);
}

function safeInteger<T>(raw: string, fallback: T): number | T {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function firstLine(text: string) {
  return text.trim().split(/\r?\n/)[0] ?? "";
}
