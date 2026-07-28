/**
 * „SVG exportieren": die Papierausgabe des Pakets (`exportToSVG`) — Blattgröße
 * A3 quer, automatisch passender Regelmaßstab, Schraffur nach IFC-Typ. Bewusst
 * NICHT die Pane-Darstellung: die ist auf Bildschirm, Zoom und Auswahl
 * ausgelegt, der Export auf Plandruck.
 */
import {
  PAPER_SIZES,
  exportToSVG,
  getRecommendedScale,
  type Drawing2D,
} from "@ifc-lite/drawing-2d";

const PAPER = PAPER_SIZES.A3_LANDSCAPE;

/** Dateiname aus Modellname und Zeichnungstitel, ohne Sonderzeichen. */
export function svgFileName(modelName: string, title: string): string {
  const base = `${modelName.replace(/\.[^.]+$/, "")}-${title}`;
  return `${base.replace(/[^\w\-]+/g, "_")}.svg`;
}

export function drawingToSvg(
  drawing: Drawing2D,
  title: string,
  projectName: string,
): string {
  const width = drawing.bounds.max.x - drawing.bounds.min.x;
  const height = drawing.bounds.max.y - drawing.bounds.min.y;
  const scale = getRecommendedScale(
    Number.isFinite(width) ? width : 1,
    Number.isFinite(height) ? height : 1,
    PAPER.width,
    PAPER.height,
  );
  return exportToSVG(drawing, {
    paperSize: PAPER,
    scale,
    title,
    projectName,
    showHatching: true,
    showHiddenLines: true,
    showTitleBlock: true,
    units: "m",
  });
}

/** SVG als Download anbieten (gleiches Muster wie CSV-/BCF-Export). */
export function downloadSvg(fileName: string, svg: string): void {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
