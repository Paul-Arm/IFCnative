/**
 * Service-Ebene: Katalog (Projekte → Modelle → Stände), Dedup der Blobs,
 * Reihenfolge der Historie und byte-genauer Datei-Roundtrip.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FilesystemStore } from "../src/storage/filesystem.js";
import { hashBytes, HubService } from "../src/service.js";
import { HubError } from "../src/errors.js";
import { buildModel, tempDataDir, toBytes, withChangedProperty } from "./helpers.js";

let dir: string;
let cleanup: () => Promise<void>;
let service: HubService;

beforeEach(async () => {
  ({ dir, cleanup } = await tempDataDir());
  service = new HubService(new FilesystemStore(dir));
  await service.init();
});

afterEach(async () => {
  await cleanup();
});

async function blobFiles(): Promise<string[]> {
  return (await readdir(path.join(dir, "blobs"))).sort();
}

describe("Katalogschicht", () => {
  it("legt Projekt und Modell an und listet sie", async () => {
    expect(await service.listProjects()).toEqual([]);

    const project = await service.createProject("Bürogebäude Nord");
    expect(project.name).toBe("Bürogebäude Nord");
    expect(project.id).not.toBe("");
    expect(project.modelCount).toBe(0);

    const model = await service.createModel(project.id, "Architektur");
    expect(model.name).toBe("Architektur");

    expect(await service.listProjects()).toEqual([
      { ...project, modelCount: 1 },
    ]);
    expect(await service.listModels(project.id)).toEqual([model]);
  });

  it("weist leere Namen zurück und meldet unbekannte Ids mit 404", async () => {
    await expect(service.createProject("   ")).rejects.toBeInstanceOf(HubError);
    await expect(service.createProject(undefined)).rejects.toMatchObject({
      status: 400,
    });
    await expect(service.listModels("gibt-es-nicht")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("schreibt catalog.json atomar und lesbar", async () => {
    const project = await service.createProject("Projekt");
    await service.createModel(project.id, "Modell");

    const raw = await readFile(path.join(dir, "catalog.json"), "utf8");
    const catalog = JSON.parse(raw) as { catalogVersion: number };
    expect(catalog.catalogVersion).toBe(1);
    // Keine liegengebliebenen tmp-Dateien.
    const entries = await readdir(dir);
    expect(entries.filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });
});

describe("Versionsstände", () => {
  it("committet zwei Stände, dedupliziert gleiche Bytes und listet neueste zuerst", async () => {
    const project = await service.createProject("Projekt");
    const model = await service.createModel(project.id, "Modell");
    const bytes = toBytes(buildModel());

    const first = await service.createVersion(project.id, model.id, bytes, {
      message: "Erster Stand",
      author: "Paul",
    });
    expect(first.schema).toBe("IFC4");
    expect(first.entityCount).toBeGreaterThan(0);
    expect(first.byteSize).toBe(bytes.byteLength);
    expect(first.blobHash).toBe(hashBytes(bytes));
    expect(first.message).toBe("Erster Stand");
    expect(first.author).toBe("Paul");

    expect(await blobFiles()).toHaveLength(1);

    // Zweiter Commit mit IDENTISCHEN Bytes: eigener Stand, aber kein zweiter Blob.
    const second = await service.createVersion(project.id, model.id, bytes, {
      message: "Nochmal dasselbe",
      author: "Paul",
    });
    expect(second.id).not.toBe(first.id);
    expect(second.blobHash).toBe(first.blobHash);
    expect(await blobFiles()).toEqual([first.blobHash]);

    // Ein inhaltlich anderer Stand legt sehr wohl einen zweiten Blob an.
    const changed = toBytes(withChangedProperty(buildModel()));
    const third = await service.createVersion(project.id, model.id, changed);
    expect(third.blobHash).not.toBe(first.blobHash);
    expect(await blobFiles()).toHaveLength(2);

    const versions = await service.listVersions(project.id, model.id);
    expect(versions.map((entry) => entry.id)).toEqual([
      third.id,
      second.id,
      first.id,
    ]);
    expect(versions[0]?.message).toBe("");
  });

  it("liefert die Datei byte-identisch zurück", async () => {
    const project = await service.createProject("Projekt");
    const model = await service.createModel(project.id, "Modell");
    const bytes = toBytes(buildModel());
    const version = await service.createVersion(project.id, model.id, bytes);

    const { bytes: roundtrip } = await service.readVersionFile(
      project.id,
      model.id,
      version.id,
    );
    expect(roundtrip.byteLength).toBe(bytes.byteLength);
    expect(Buffer.compare(Buffer.from(roundtrip), Buffer.from(bytes))).toBe(0);
    expect(hashBytes(roundtrip)).toBe(version.blobHash);
  });

  it("lehnt kaputte IFC-Bytes ab, ohne einen Stand anzulegen", async () => {
    const project = await service.createProject("Projekt");
    const model = await service.createModel(project.id, "Modell");

    await expect(
      service.createVersion(project.id, model.id, new Uint8Array()),
    ).rejects.toMatchObject({ status: 422 });
    expect(await service.listVersions(project.id, model.id)).toEqual([]);
  });

  it("verliert bei parallelen Commits keinen Stand", async () => {
    const project = await service.createProject("Projekt");
    const model = await service.createModel(project.id, "Modell");
    const base = buildModel();
    const variants = [base, withChangedProperty(base), `${base}\n`];

    await Promise.all(
      variants.map((text, index) =>
        service.createVersion(project.id, model.id, toBytes(text), {
          message: `Stand ${index}`,
        }),
      ),
    );
    expect(await service.listVersions(project.id, model.id)).toHaveLength(3);
  });
});
