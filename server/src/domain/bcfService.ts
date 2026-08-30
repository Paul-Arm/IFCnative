import { strToU8, zipSync } from "fflate";

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
