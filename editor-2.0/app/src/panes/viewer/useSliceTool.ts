/**
 * Werkzeug „Schneiden" (M9): liefert die Canvas-Callbacks für
 * `attachViewerControls` — Links-Drag verschiebt die Schnittebene
 * (Mausdelta → Δ-Position 0–100 entlang der aktiven Achse), Umschalt+Rad
 * justiert in 1-%-, Alt+Rad in 0,1-%-Schritten. Beim Aktivieren des
 * Werkzeugs wird die Schnittebene automatisch eingeschaltet.
 *
 * Hinweis Mehrfach-Ebenen: `RenderOptions` des Renderers kennt genau EINE
 * `sectionPlane` (plus die unabhängige `clipBox`) — eine zweite kombinierte
 * Ebene ist mit der aktuellen API nicht darstellbar; als Gegenschnitt dient
 * Flip bzw. die Clip-Box.
 */
import { useEffect, useMemo } from "react";
import type { ControlCallbacks } from "./controls";
import type { ViewerTool } from "./ViewerToolbar";
import { useSectionStore } from "./sectionStore";
import { dragPositionDelta, wheelPositionStep } from "./sliceMath";

export function useSliceTool(tool: ViewerTool): ControlCallbacks["slice"] {
  const nudgePosition = useSectionStore((s) => s.nudgePosition);
  const patchSection = useSectionStore((s) => s.patchSection);

  // Werkzeug an ⇒ Schnittebene an (sonst zöge der Drag ins Leere).
  useEffect(() => {
    if (tool === "slice" && !useSectionStore.getState().section.enabled)
      patchSection({ enabled: true });
  }, [tool, patchSection]);

  return useMemo(() => {
    if (tool !== "slice") return undefined;
    return {
      onDrag(dx, dy, width, height) {
        nudgePosition(dragPositionDelta(dx, dy, width, height));
      },
      onWheel(deltaY, fine) {
        nudgePosition(wheelPositionStep(deltaY, fine));
      },
    };
  }, [tool, nudgePosition]);
}
