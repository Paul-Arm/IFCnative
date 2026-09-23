/** Lesbare Textfarbe (dunkel/weiß) für eine Hex-Hintergrundfarbe. */
export function labelTextColor(hex: string): string {
  const value = hex.replace("#", "");
  if (value.length !== 6) return "#ffffff";
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#1f2328" : "#ffffff";
}

/** Vorschläge für neue Labels (GitHub-nahe Palette). */
export const LABEL_COLORS = [
  "#d73a4a",
  "#e99695",
  "#f9d0c4",
  "#fbca04",
  "#fef2c0",
  "#0e8a16",
  "#c2e0c6",
  "#006b75",
  "#bfdadc",
  "#1d76db",
  "#c5def5",
  "#0052cc",
  "#5319e7",
  "#d4c5f9",
  "#b60205",
  "#ededed",
];

export function randomLabelColor(): string {
  return LABEL_COLORS[Math.floor(Math.random() * LABEL_COLORS.length)]!;
}

/**
 * Farbe je Dateiart für Dateityp-Leiste und Icons (wie GitHubs
 * Sprachen-Leiste): IFC = Akzent, Markdown = grau, Dokumente/CAD eigen.
 */
const KIND_COLORS: Record<string, string> = {
  ifc: "#2f81f7",
  md: "#6e7781",
  pdf: "#e5534b",
  docx: "#4c8eda",
  doc: "#4c8eda",
  dwg: "#d4a72c",
  dxf: "#c69026",
  png: "#8957e5",
  jpg: "#8957e5",
  jpeg: "#8957e5",
  svg: "#e3752b",
  xlsx: "#2da44e",
  csv: "#3fb950",
  ids: "#1f9eaf",
  json: "#bf8700",
  xml: "#1f9eaf",
  txt: "#8b949e",
};

export function kindColor(extension: string): string {
  const key = extension.toLowerCase();
  if (KIND_COLORS[key]) return KIND_COLORS[key]!;
  const hue = hashString(key || "?") % 360;
  return `hsl(${hue} 45% 55%)`;
}

export const KIND_NAMES: Record<string, string> = {
  ifc: "IFC",
  md: "Markdown",
  pdf: "PDF",
  docx: "Word",
  doc: "Word",
  dwg: "DWG",
  dxf: "DXF",
  png: "PNG",
  jpg: "JPEG",
  jpeg: "JPEG",
  svg: "SVG",
  xlsx: "Excel",
  csv: "CSV",
  ids: "IDS",
  json: "JSON",
  xml: "XML",
  txt: "Text",
};

export function kindName(extension: string): string {
  return KIND_NAMES[extension.toLowerCase()] ?? (extension ? extension.toUpperCase() : "Datei");
}
