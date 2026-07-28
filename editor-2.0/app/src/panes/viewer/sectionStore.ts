/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Schnitt-Store (M9): Schnittebene + Clip-Box des Viewers als zustand-Store,
 * damit neben der Viewer-Toolbar auch das Ribbon (Ansicht → Schnitt) denselben
 * Zustand schaltet. Der ViewerPane konsumiert den Store und speist ihn in
 * `ViewerHandle.apply` ein.
 *
 * Bedienlogik nach dem Section-Werkzeug des ifc-lite-Viewers (LTplus-AG/
 * ifc-lite, `apps/viewer/src/components/viewer/tools/SectionPanel.tsx`,
 * MPL-2.0): Achsenwahl, Position 0–100 %, Flip, Clipping an/aus. Eigenständig
 * implementiert — das Original hängt an Tailwind/shadcn und einem
 * Viewer-Store-Slice, die es hier nicht gibt.
 *
 * Die Clip-Box liegt in IFC-Modellkoordinaten (Z-up, Meter); erst der
 * ViewerPane rechnet sie mit dem RTC-`originShift` in den Renderer-Rahmen um
 * (`sliceMath.toClipBox`). „Box auf Auswahl" läuft als Nonce-Anforderung:
 * das Ribbon kennt weder Szene noch Auswahl-Bounds — der ViewerPane bedient
 * die Anforderung, sobald er sie sieht.
 */
import { create } from "zustand";
import { DEFAULT_SECTION, type SectionState } from "./section";
import type { AxisBox, BoxAxis, BoxSide } from "./sliceMath";
import { clampPercent, patchBoxSide } from "./sliceMath";

interface SectionStore {
  /** Schnittebene (eine — der Renderer unterstützt genau EINE Ebene). */
  section: SectionState;
  /** Clip-Box in IFC-Koordinaten (Meter) oder null (keine Box gesetzt). */
  boxIfc: AxisBox | null;
  boxEnabled: boolean;
  /** Nonce: „Box auf Auswahl" angefordert (Ribbon/Toolbar → ViewerPane). */
  boxRequest: number;
  /** true, sobald ein Viewer läuft — schaltet die Ribbon-Gruppe frei. */
  viewerReady: boolean;

  patchSection(patch: Partial<SectionState>): void;
  toggleSection(): void;
  flipSection(): void;
  /** Position setzen, geklemmt auf 0–100. */
  setPosition(value: number): void;
  /** Position relativ ändern (Canvas-Drag/Mausrad), geklemmt auf 0–100. */
  nudgePosition(delta: number): void;

  setBox(box: AxisBox | null): void;
  patchBox(axis: BoxAxis, side: BoxSide, value: number): void;
  setBoxEnabled(enabled: boolean): void;
  requestBoxOnSelection(): void;

  setViewerReady(ready: boolean): void;
  /** Alles zurück auf Standard (Dokumentwechsel, Ribbon „Zurücksetzen"). */
  reset(): void;
}

export const useSectionStore = create<SectionStore>((set) => ({
  section: DEFAULT_SECTION,
  boxIfc: null,
  boxEnabled: false,
  boxRequest: 0,
  viewerReady: false,

  patchSection(patch) {
    set((s) => ({ section: { ...s.section, ...patch } }));
  },

  toggleSection() {
    set((s) => ({ section: { ...s.section, enabled: !s.section.enabled } }));
  },

  flipSection() {
    set((s) => ({ section: { ...s.section, flipped: !s.section.flipped } }));
  },

  setPosition(value) {
    set((s) => ({ section: { ...s.section, position: clampPercent(value) } }));
  },

  nudgePosition(delta) {
    set((s) => ({
      section: {
        ...s.section,
        position: clampPercent(s.section.position + delta),
      },
    }));
  },

  setBox(box) {
    set({ boxIfc: box, boxEnabled: box !== null });
  },

  patchBox(axis, side, value) {
    set((s) =>
      s.boxIfc ? { boxIfc: patchBoxSide(s.boxIfc, axis, side, value) } : s,
    );
  },

  setBoxEnabled(enabled) {
    set({ boxEnabled: enabled });
  },

  requestBoxOnSelection() {
    set((s) => ({ boxRequest: s.boxRequest + 1 }));
  },

  setViewerReady(ready) {
    set({ viewerReady: ready });
  },

  reset() {
    set({ section: DEFAULT_SECTION, boxIfc: null, boxEnabled: false });
  },
}));
