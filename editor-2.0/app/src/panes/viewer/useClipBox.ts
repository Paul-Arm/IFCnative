/**
 * Clip-Box-Anbindung des ViewerPane (M9).
 *
 * Bedient die „Box auf Auswahl"-Anforderungen aus dem sectionStore (Nonce —
 * Ribbon und Toolbar kennen weder Szene noch Bounds): Bounding-Box der
 * Auswahl (Vereinigung, Batch- oder Instanz-Bounds) bzw. ohne Auswahl die
 * Modell-Bounds, plus 10 % Rand. Liefert außerdem die fertige
 * `RenderOptions.clipBox` (Renderer-Rahmen) und den Reglerbereich des Panels
 * (IFC-Meter).
 */
import { useEffect, useMemo, useRef } from "react";
import type { ClipBox } from "@ifc-lite/renderer";
import type { ViewerHandle, ViewerOverlayAccess } from "../../core/viewer";
import { useSectionStore } from "./sectionStore";
import {
  expandBox,
  rendererBoxToIfc,
  toClipBox,
  unionBounds,
  type AxisBox,
} from "./sliceMath";

export interface ClipBoxWiring {
  /** Aktive Box (IFC-Meter) oder null. */
  boxIfc: AxisBox | null;
  /** In den Renderer gespeiste Box; null = aus. */
  clipBox: ClipBox | null;
  /** Reglerbereich des Panels (Modell-Bounds + Rand, IFC) oder null. */
  rangeIfc: AxisBox | null;
  /** Box wieder auf den vollen Modellumfang setzen. */
  resetToModel(): void;
}

export function useClipBox(
  handle: ViewerHandle | null,
  access: ViewerOverlayAccess | null,
  selection: readonly number[],
): ClipBoxWiring {
  const boxIfc = useSectionStore((s) => s.boxIfc);
  const boxEnabled = useSectionStore((s) => s.boxEnabled);
  const boxRequest = useSectionStore((s) => s.boxRequest);
  const setBox = useSectionStore((s) => s.setBox);

  /** Modell-Bounds + Rand in IFC-Metern (null ohne Geometrie). */
  const modelRangeIfc = (): AxisBox | null => {
    const bounds = handle?.modelBounds();
    if (!bounds || !access) return null;
    return expandBox(rendererBoxToIfc(bounds, access.originShift()));
  };

  /** Auswahl-Bounds (Renderer-Rahmen) oder null, wenn keine Box auffindbar. */
  const selectionBounds = (): AxisBox | null => {
    if (!access || selection.length === 0) return null;
    const scene = access.renderer.getScene();
    const boxes: AxisBox[] = [];
    for (const id of selection) {
      const box =
        scene.getEntityBoundingBox(id) ?? scene.getInstancedEntityBounds(id);
      if (box) boxes.push(box);
    }
    return unionBounds(boxes);
  };

  // — „Box auf Auswahl": Nonce aus dem Store bedienen —
  const served = useRef(boxRequest);
  useEffect(() => {
    if (boxRequest === served.current) return;
    served.current = boxRequest;
    if (!access) return;
    const picked = selectionBounds();
    const next = picked
      ? expandBox(rendererBoxToIfc(picked, access.originShift()))
      : modelRangeIfc();
    if (next) setBox(next);
    // selectionBounds/modelRangeIfc lesen access/handle/selection direkt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxRequest, access, handle, selection, setBox]);

  const clipBox = useMemo(
    () =>
      boxEnabled && boxIfc && access
        ? toClipBox(boxIfc, access.originShift())
        : null,
    [boxEnabled, boxIfc, access],
  );

  const rangeIfc = useMemo(
    () => (boxIfc && access ? modelRangeIfc() : null),
    // Bewusst grob: neu rechnen, sobald Panel sichtbar wird oder Box wechselt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boxIfc, access, handle],
  );

  return {
    boxIfc,
    clipBox,
    rangeIfc,
    resetToModel() {
      const range = modelRangeIfc();
      if (range) setBox(range);
    },
  };
}
