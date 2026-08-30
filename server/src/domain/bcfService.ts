import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { DOMParser } from "linkedom";

import type { Issue, IssueComment, User } from "../repository/types";

/**
 * BCF-2.1-Export (buildingSMART BIM Collaboration Format).
 *
 * Jedes "bcf"-Issue wird zu einem BCF-Topic: die Issue-Id (UUID) ist die
 * Topic-Guid, Titel/Beschreibung/Status/Kommentare wandern ins markup.bcf,
 * die verorteten GlobalIds werden als Viewpoint-Selektion (Component je
 * IfcGuid) exportiert — andere BIM-Werkzeuge springen damit direkt auf die
 * betroffenen Objekte.
 */

export interface BcfTopicInput {
  issue: Issue;
  comments: IssueComment[];
  /** Betroffene IFC-GlobalIds (Viewpoint-Selektion). */
  guids: string[];
  /** Dateinamen der verknüpften Modelle (Markup-Header). */
  modelFileNames: string[];
  usersById: Map<string, User>;
}

export function buildBcfZip(topics: BcfTopicInput[]): Buffer {
  const files: Record<string, Uint8Array> = {
    "bcf.version": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<Version VersionId="2.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
        `<DetailedVersion>2.1</DetailedVersion></Version>\n`,
    ),
  };
  for (const topic of topics) {
    const guid = topic.issue.id;
    files[`${guid}/markup.bcf`] = strToU8(renderMarkup(topic));
    if (topic.guids.length) {
      files[`${guid}/viewpoint.bcfv`] = strToU8(renderViewpoint(topic));
    }
  }
  return Buffer.from(zipSync(files, { level: 6 }));
}

function renderMarkup(topic: BcfTopicInput): string {
  const { issue, comments, usersById } = topic;
  const author = usersById.get(issue.authorId)?.email ?? "unbekannt";
  const headerFiles = topic.modelFileNames
    .map(
      (name) =>
        `    <File isExternal="true"><Filename>${esc(name)}</Filename></File>`,
    )
    .join("\n");
  const commentXml = comments
    .map((comment) => {
      const commentAuthor =
        usersById.get(comment.authorId)?.email ?? "unbekannt";
      return [
        `  <Comment Guid="${esc(comment.id)}">`,
        `    <Date>${esc(comment.createdAt)}</Date>`,
        `    <Author>${esc(commentAuthor)}</Author>`,
        `    <Comment>${esc(comment.body)}</Comment>`,
        `  </Comment>`,
      ].join("\n");
    })
    .join("\n");
  const viewpointXml = topic.guids.length
    ? [
        `  <Viewpoints Guid="${esc(issue.id)}">`,
        `    <Viewpoint>viewpoint.bcfv</Viewpoint>`,
        `  </Viewpoints>`,
      ].join("\n")
    : "";
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<Markup xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`,
    `  <Header>`,
    headerFiles,
    `  </Header>`,
    `  <Topic Guid="${esc(issue.id)}" TopicType="Issue" TopicStatus="${
      issue.state === "closed" ? "Closed" : "Active"
    }">`,
    `    <Title>${esc(issue.title)}</Title>`,
    `    <CreationDate>${esc(issue.createdAt)}</CreationDate>`,
    `    <CreationAuthor>${esc(author)}</CreationAuthor>`,
    `    <ModifiedDate>${esc(issue.updatedAt)}</ModifiedDate>`,
    `    <Description>${esc(issue.body)}</Description>`,
    `  </Topic>`,
    commentXml,
    viewpointXml,
    `</Markup>`,
    ``,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function renderViewpoint(topic: BcfTopicInput): string {
  const components = topic.guids
    .map((guid) => `      <Component IfcGuid="${esc(guid)}" />`)
    .join("\n");
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<VisualizationInfo Guid="${esc(topic.issue.id)}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`,
    `  <Components>`,
    `    <Selection>`,
    components,
    `    </Selection>`,
    `  </Components>`,
    // Neutrale Standard-Kamera — der Empfänger zoomt über die Selektion.
    `  <PerspectiveCamera>`,
    `    <CameraViewPoint><X>10</X><Y>-10</Y><Z>10</Z></CameraViewPoint>`,
    `    <CameraDirection><X>-0.577</X><Y>0.577</Y><Z>-0.577</Z></CameraDirection>`,
    `    <CameraUpVector><X>0</X><Y>0</Y><Z>1</Z></CameraUpVector>`,
    `    <FieldOfView>60</FieldOfView>`,
    `  </PerspectiveCamera>`,
    `</VisualizationInfo>`,
    ``,
  ].join("\n");
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// BCF-Import: .bcfzip -> Topics (Titel, Beschreibung, Status, Kommentare,
// Viewpoint-GUIDs, referenzierte Dateinamen)
// ---------------------------------------------------------------------------

/** Minimale DOM-Sicht — passt auf Browser-Elemente und linkedom-Nodes. */
interface XmlEl {
  localName?: string;
  tagName: string;
  textContent: string | null;
  children: ArrayLike<unknown> & Iterable<unknown>;
  getAttribute(name: string): string | null;
}

export interface ParsedBcfComment {
  author: string;
  date: string;
  text: string;
}

export interface ParsedBcfTopic {
  /** Topic-Guid aus dem markup.bcf (bzw. der Ordnername). */
  guid: string;
  title: string;
  description: string;
  status: "open" | "closed";
  creationAuthor: string;
  comments: ParsedBcfComment[];
  /** IfcGuids aller Viewpoint-Komponenten des Topics. */
  guids: string[];
  /** Dateinamen aus dem Markup-Header (zum Modell-Matching). */
  fileNames: string[];
}

const TOPIC_LIMIT = 200;
const GUID_LIMIT = 500;

/**
 * Liest eine BCF-2.x-Datei (.bcf/.bcfzip). Wirft bei kaputtem Zip; einzelne
 * unlesbare Topics werden übersprungen statt den Import zu kippen.
 */
export function parseBcfZip(zip: Uint8Array): ParsedBcfTopic[] {
  const files = unzipSync(zip);
  const parser = new DOMParser();
  const topics: ParsedBcfTopic[] = [];
  for (const [path, data] of Object.entries(files)) {
    if (!/^[^/]+\/markup\.bcf$/i.test(path.replace(/\\/g, "/"))) {
      continue;
    }
    if (topics.length >= TOPIC_LIMIT) {
      break;
    }
    const folder = path.replace(/\\/g, "/").split("/")[0] ?? "";
    try {
      const topic = parseMarkup(parser, strFromU8(data), folder);
      // Alle Viewpoints des Topic-Ordners einsammeln (typisch viewpoint.bcfv).
      const guids = new Set<string>();
      for (const [vpPath, vpData] of Object.entries(files)) {
        const normalized = vpPath.replace(/\\/g, "/");
        if (
          normalized.startsWith(`${folder}/`) &&
          normalized.toLowerCase().endsWith(".bcfv")
        ) {
          for (const guid of parseViewpointGuids(parser, strFromU8(vpData))) {
            guids.add(guid);
          }
        }
      }
      topic.guids = [...guids].slice(0, GUID_LIMIT);
      topics.push(topic);
    } catch {
      // Unlesbares Topic überspringen.
    }
  }
  return topics;
}

function parseMarkup(
  parser: InstanceType<typeof DOMParser>,
  xml: string,
  folder: string,
): ParsedBcfTopic {
  const dom = parser.parseFromString(xml, "text/xml");
  const root = dom.documentElement as unknown as XmlEl | null;
  if (!root || localName(root) !== "markup") {
    throw new Error("Kein Markup");
  }
  const topicEl = childByName(root, "topic");
  const headerEl = childByName(root, "header");
  const fileNames: string[] = [];
  for (const fileEl of headerEl ? childrenByName(headerEl, "file") : []) {
    const name = childByName(fileEl, "filename")?.textContent?.trim();
    if (name) {
      fileNames.push(name);
    }
  }
  const comments: ParsedBcfComment[] = [];
  for (const commentEl of childrenByName(root, "comment")) {
    const text = childByName(commentEl, "comment")?.textContent?.trim();
    if (text) {
      comments.push({
        author: childByName(commentEl, "author")?.textContent?.trim() ?? "",
        date: childByName(commentEl, "date")?.textContent?.trim() ?? "",
        text,
      });
    }
  }
  const rawStatus = (topicEl?.getAttribute("TopicStatus") ?? "").toLowerCase();
  return {
    guid: topicEl?.getAttribute("Guid")?.trim() || folder,
    title:
      childByName(topicEl, "title")?.textContent?.trim() || "(ohne Titel)",
    description:
      childByName(topicEl, "description")?.textContent?.trim() ?? "",
    status: ["closed", "resolved"].includes(rawStatus) ? "closed" : "open",
    creationAuthor:
      childByName(topicEl, "creationauthor")?.textContent?.trim() ?? "",
    comments,
    guids: [],
    fileNames,
  };
}

function parseViewpointGuids(
  parser: InstanceType<typeof DOMParser>,
  xml: string,
): string[] {
  const guids: string[] = [];
  try {
    const dom = parser.parseFromString(xml, "text/xml");
    const walk = (element: XmlEl | null | undefined): void => {
      if (!element) return;
      if (localName(element) === "component") {
        const guid = element.getAttribute("IfcGuid")?.trim();
        if (guid) {
          guids.push(guid);
        }
      }
      for (const child of element.children ?? []) {
        walk(child as XmlEl);
      }
    };
    walk(dom.documentElement as unknown as XmlEl | null);
  } catch {
    // Viewpoint unlesbar — ohne GUIDs weiter.
  }
  return guids;
}

function localName(element: XmlEl): string {
  return (element.localName ?? element.tagName).toLowerCase();
}

function childByName(
  parent: XmlEl | null | undefined,
  name: string,
): XmlEl | undefined {
  if (!parent) return undefined;
  return [...parent.children].find(
    (child) => localName(child as XmlEl) === name,
  ) as XmlEl | undefined;
}

function childrenByName(parent: XmlEl, name: string): XmlEl[] {
  return [...parent.children].filter(
    (child) => localName(child as XmlEl) === name,
  ) as XmlEl[];
}
