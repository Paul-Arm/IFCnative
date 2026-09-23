/**
 * Dateiendung -> Content-Type für Modelle der Art "file" (beliebige Dateien
 * ohne Objekt-Diff). Unbekannte Endungen werden als octet-stream geliefert.
 */
const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  dwg: "image/vnd.dwg",
  dxf: "image/vnd.dxf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  json: "application/json",
  xml: "application/xml",
  ids: "application/xml",
  md: "text/markdown; charset=utf-8",
  ifc: "application/x-step",
  zip: "application/zip",
  bcf: "application/zip",
  bcfzip: "application/zip",
};

export function fileExtension(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx === -1 ? "" : name.slice(idx + 1).toLowerCase();
}

export function contentTypeForFileName(name: string): string {
  return CONTENT_TYPES[fileExtension(name)] ?? "application/octet-stream";
}

/** Commits ohne IFC-Inhalt (Markdown, beliebige Dateien) haben keinen Objekt-Diff. */
export function isNonIfcSchema(schema: string): boolean {
  return schema === "markdown" || schema === "file";
}
