/**
 * BCF 2.1-Export der Importvorschau: jeder Befund (Importer-Regel oder IDS)
 * wird ein Thema mit dem betroffenen Objekt als Viewpoint-Auswahl, damit
 * Modellierer die Punkte in Allplan, BIMcollab oder Solibri abarbeiten.
 */
import type { IdsValidationSummary } from "../ids";
import type { NativeIfcDocument } from "../nativeDocument";

import { contextLines } from "./messages";
import type { PortalFinding } from "./portalCheck";
import { importartLabel, type Importart } from "./schema";
import { createZip } from "./zip";

export interface BcfComponent {
  ifcGuid?: string;
  authoringToolId: string;
}

export interface BcfTopic {
  guid: string;
  index: number;
  title: string;
  description: string;
  type: "Error" | "Warning";
  labels: string[];
  comments: string[];
  components: BcfComponent[];
}

export interface BcfMeta {
  fileName: string;
  importart: Importart;
  author?: string;
  date?: Date;
}

export function uuid(): string {
  const generator = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID;
  if (generator) return generator.call(globalThis.crypto);
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    return (char === "x" ? random : (random & 0x3) | 0x8).toString(16);
  });
}

function escapeXml(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code < 32 && char !== "\t" && char !== "\n" && char !== "\r") continue;
    out += char === "&" ? "&amp;" : char === "<" ? "&lt;" : char === ">" ? "&gt;" : char === '"' ? "&quot;" : char;
  }
  return out;
}

function shorten(text: string, max = 120): string {
  const firstSentence = text.split(/(?<=[.!?])\s/)[0] ?? text;
  return firstSentence.length > max ? `${firstSentence.slice(0, max - 1)}…` : firstSentence;
}

function componentFor(document: NativeIfcDocument, entityId: number | undefined): BcfComponent[] {
  if (entityId == null) return [];
  const entity = document.entityById.get(entityId);
  if (!entity) return [];
  const ifcGuid = entity.globalId && entity.globalId.length === 22 ? entity.globalId : undefined;
  return [{ ifcGuid, authoringToolId: `#${entityId}` }];
}

/** Themen aus Portal-Befunden und IDS-Verstößen; Fehler zuerst. */
export function collectBcfTopics(document: NativeIfcDocument, findings: PortalFinding[], ids: IdsValidationSummary | null, meta: BcfMeta): BcfTopic[] {
  const topics: BcfTopic[] = [];
  const label = importartLabel(meta.importart);
  const sorted = [...findings].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
  for (const finding of sorted) {
    topics.push({
      guid: uuid(),
      index: topics.length + 1,
      title: `${finding.code}: ${shorten(finding.message)}`,
      description: finding.message,
      type: finding.severity === "error" ? "Error" : "Warning",
      labels: [label, finding.code, finding.severity === "error" ? "Import blockiert" : "Hinweis"],
      comments: contextLines(finding),
      components: componentFor(document, finding.entityId),
    });
  }
  for (const result of ids?.results ?? []) {
    if (result.status !== "fail") continue;
    const specification = `${result.specification.identifier ? `${result.specification.identifier} · ` : ""}${result.specification.name}`;
    if (!result.failures.length) {
      topics.push({ guid: uuid(), index: topics.length + 1, title: `IDS ${specification}`, description: result.messages.join(" "), type: "Error", labels: [label, "IDS"], comments: [], components: [] });
      continue;
    }
    for (const failure of result.failures) {
      topics.push({
        guid: uuid(),
        index: topics.length + 1,
        title: `IDS ${specification}`,
        description: failure.messages.map((message) => message.text).join(" "),
        type: "Error",
        labels: [label, "IDS", result.specification.identifier ?? result.specification.name],
        comments: [`Betroffenes IFC-Objekt: '${failure.entityName || failure.entityType}' (#${failure.entityId})`],
        components: componentFor(document, failure.entityId),
      });
    }
  }
  return topics;
}

function markup(topic: BcfTopic, meta: BcfMeta, projectGuid: string | undefined, iso: string, viewpointGuid: string | null): string {
  const author = escapeXml(meta.author ?? "IFCnative");
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<Markup>",
    "  <Header>",
    `    <File${projectGuid ? ` IfcProject="${escapeXml(projectGuid)}"` : ""} isExternal="true"><Filename>${escapeXml(meta.fileName)}</Filename><Date>${iso}</Date></File>`,
    "  </Header>",
    `  <Topic Guid="${topic.guid}" TopicType="${topic.type}" TopicStatus="Open">`,
    `    <Title>${escapeXml(topic.title)}</Title>`,
    `    <Index>${topic.index}</Index>`,
    ...topic.labels.map((entry) => `    <Labels>${escapeXml(entry)}</Labels>`),
    `    <CreationDate>${iso}</CreationDate>`,
    `    <CreationAuthor>${author}</CreationAuthor>`,
    `    <Description>${escapeXml(topic.description)}</Description>`,
    "  </Topic>",
  ];
  for (const comment of topic.comments) {
    lines.push(`  <Comment Guid="${uuid()}"><Date>${iso}</Date><Author>${author}</Author><Comment>${escapeXml(comment)}</Comment>${viewpointGuid ? `<Viewpoint Guid="${viewpointGuid}"/>` : ""}</Comment>`);
  }
  if (viewpointGuid) lines.push(`  <Viewpoints Guid="${viewpointGuid}"><Viewpoint>viewpoint.bcfv</Viewpoint></Viewpoints>`);
  lines.push("</Markup>", "");
  return lines.join("\n");
}

function viewpoint(topic: BcfTopic, viewpointGuid: string): string {
  const components = topic.components.map((component) => `      <Component${component.ifcGuid ? ` IfcGuid="${escapeXml(component.ifcGuid)}"` : ""} AuthoringToolId="${escapeXml(component.authoringToolId)}"/>`).join("\n");
  return ['<?xml version="1.0" encoding="UTF-8"?>', `<VisualizationInfo Guid="${viewpointGuid}">`, "  <Components>", "    <Selection>", components, "    </Selection>", "  </Components>", "</VisualizationInfo>", ""].join("\n");
}

/** BCF-Paket (ZIP) mit bcf.version, project.bcfp und je Thema markup.bcf + viewpoint.bcfv. */
export function createBcfArchive(document: NativeIfcDocument, topics: BcfTopic[], meta: BcfMeta): Uint8Array {
  const date = meta.date ?? new Date();
  const iso = date.toISOString();
  const projectGuid = document.entitiesByType.get("IFCPROJECT")?.[0]?.globalId || undefined;
  const entries = [
    { name: "bcf.version", data: '<?xml version="1.0" encoding="UTF-8"?>\n<Version VersionId="2.1"><DetailedVersion>2.1</DetailedVersion></Version>\n' },
    { name: "project.bcfp", data: `<?xml version="1.0" encoding="UTF-8"?>\n<ProjectExtension><Project ProjectId="${escapeXml(projectGuid ?? uuid())}"><Name>${escapeXml(meta.fileName)}</Name></Project><ExtensionSchema></ExtensionSchema></ProjectExtension>\n` },
  ];
  for (const topic of topics) {
    const viewpointGuid = topic.components.length ? uuid() : null;
    entries.push({ name: `${topic.guid}/markup.bcf`, data: markup(topic, meta, projectGuid, iso, viewpointGuid) });
    if (viewpointGuid) entries.push({ name: `${topic.guid}/viewpoint.bcfv`, data: viewpoint(topic, viewpointGuid) });
  }
  return createZip(entries, date);
}

export function bcfFileName(fileName: string): string {
  return `${fileName.replace(/\.ifc$/i, "") || "befunde"}.befunde.bcf`;
}
