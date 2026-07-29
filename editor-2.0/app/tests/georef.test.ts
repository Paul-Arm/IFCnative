/**
 * Großkoordinaten-Vorbehandlung (core/georef).
 *
 * Hintergrund und Messwerte stehen im Kopf von core/georef.ts: die
 * WASM-Tessellierung setzt die Platzierungskette in f32 zusammen, bevor sie
 * ihren RTC-Offset abzieht — bei einer Site auf 3,3e7 beträgt die
 * f32-Auflösung dort rund 4 m, und Bauteile unterhalb dieser Größe fallen in
 * sich zusammen.
 */
import { describe, expect, it } from "vitest";
import { composeOriginShift, rebaseGeoreference } from "../src/core/georef";
import {
  ifcToRendererPoint,
  rendererToIfcPoint,
} from "../src/panes/viewer/worldCoords";

const encode = (step: string): Uint8Array => {
  const out = new Uint8Array(step.length);
  for (let i = 0; i < step.length; i++) out[i] = step.charCodeAt(i);
  return out;
};
const decode = (bytes: Uint8Array): string =>
  String.fromCharCode(...bytes);

/** Minimalmodell nach dem Muster der Nibelungenbrücke. */
const model = (x: number, y: number, z: number): string =>
  `ISO-10303-21;
HEADER;
FILE_SCHEMA (('IFC4'));
ENDSEC;
DATA;
#25= IFCDIRECTION((1., 0., 0.));
#26= IFCDIRECTION((0., 0., 1.));
#27= IFCCARTESIANPOINT((${x}, ${y}, ${z}));
#28= IFCAXIS2PLACEMENT3D(#27,#26,#25);
#29= IFCLOCALPLACEMENT($,#28);
#30= IFCSITE('0I3J0Cb7LAOexDeOR2tYg_',#5,'Strombr',$,$,#29,$,$,$,$,$,$,$,$);
ENDSEC;
END-ISO-10303-21;
`;

describe("rebaseGeoreference", () => {
  it("nullt eine echte Georeferenz und meldet den entfernten Betrag", () => {
    const site = { x: 32555405.3646157, y: 5792521.48721566, z: 0 };
    const result = rebaseGeoreference(
      encode(model(site.x, site.y, site.z)),
    );

    expect(result.removed).toEqual(site);
    const patched = decode(result.bytes);
    expect(patched).toContain("#27= IFCCARTESIANPOINT((0.,0.,0.))");
    expect(patched).not.toContain("32555405");
    // Nur der eine Punkt darf sich geändert haben.
    expect(patched).toContain("#28= IFCAXIS2PLACEMENT3D(#27,#26,#25)");
    expect(patched).toContain("#26= IFCDIRECTION((0., 0., 1.))");
  });

  it("lässt gesunde Koordinaten unangetastet", () => {
    const bytes = encode(model(12.5, -30, 0));
    const result = rebaseGeoreference(bytes);
    expect(result.removed).toBeNull();
    expect(result.bytes).toBe(bytes);
  });

  it("lässt ein Modell ohne IfcSite unangetastet", () => {
    const bytes = encode("ISO-10303-21;\nDATA;\nENDSEC;\n");
    const result = rebaseGeoreference(bytes);
    expect(result.removed).toBeNull();
    expect(result.bytes).toBe(bytes);
  });

  it("arbeitet byteweise korrekt (Umlaute im Modell bleiben heil)", () => {
    // 'ü' als ISO-8859-1 (0xFC) — ein Byte, das kein gültiges UTF-8 ist.
    const step = model(4e7, 5e6, 0).replace("'Strombr'", "'Strombrücke'");
    const result = rebaseGeoreference(encode(step));
    expect(decode(result.bytes)).toContain("'Strombrücke'");
  });
});

describe("composeOriginShift", () => {
  it("hält IFC-Koordinaten stabil, egal wie verschoben wurde", () => {
    const georef = { x: 32555405.3646157, y: 5792521.48721566, z: 0 };
    const extra = { x: -100004, y: 87, z: 294645 }; // Renderer-Rahmen (Y-up)
    const base = { x: 0, y: 0, z: 0 };

    // Ein echter Punkt des Modells in IFC-Koordinaten.
    const ifcPoint = { x: 32455230.5, y: 5497831.25, z: 104.829 };

    // Weil wir die Georeferenz aus der Datei genommen haben, tesselliert der
    // Geometrielauf den Punkt bereits um `georef` versetzt …
    const rendererUnshifted = ifcToRendererPoint(
      {
        x: ifcPoint.x - georef.x,
        y: ifcPoint.y - georef.y,
        z: ifcPoint.z - georef.z,
      },
      base,
    );
    // … und die nachgelagerte Modellverschiebung holt ihn vollends an den
    // Ursprung (Renderer-Rahmen, deshalb komponentenweise auf Y-up-Achsen).
    const rendererShifted = {
      x: rendererUnshifted.x - extra.x,
      y: rendererUnshifted.y - extra.y,
      z: rendererUnshifted.z - extra.z,
    };

    const shift = composeOriginShift(base, georef, extra);
    const back = rendererToIfcPoint(rendererShifted, shift);

    expect(back.x).toBeCloseTo(ifcPoint.x, 6);
    expect(back.y).toBeCloseTo(ifcPoint.y, 6);
    expect(back.z).toBeCloseTo(ifcPoint.z, 6);
  });

  it("ist ohne Verschiebungen die Identität", () => {
    const base = { x: 1, y: 2, z: 3 };
    expect(composeOriginShift(base, null, null)).toEqual(base);
  });
});
