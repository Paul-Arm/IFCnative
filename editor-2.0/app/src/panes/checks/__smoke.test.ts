/** Temporärer Rauchtest (wird nach der Verifikation gelöscht). */
import { describe, expect, it } from "vitest";
import { IfcCreator } from "@ifc-lite/create";

import { ModelSession } from "../../core/session";
import { cmdSetProperty } from "../../commands/propertyCommands";
import { buildBcf } from "../../domain/checks/bcf";
import { runIdsChecks, useIdsDocuments } from "../../domain/checks/idsSource";
import {
  allFindings,
  registeredCheckSources,
  useChecks,
} from "../../domain/checks/store";

const IDS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<ids xmlns="http://standards.buildingsmart.org/IDS" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://standards.buildingsmart.org/IDS http://standards.buildingsmart.org/IDS/1.0/ids.xsd">
  <info><title>Rauchtest</title></info>
  <specifications>
    <specification name="Waende brauchen FireRating" ifcVersion="IFC4">
      <applicability minOccurs="0" maxOccurs="unbounded">
        <entity><name><simpleValue>IFCWALL</simpleValue></name></entity>
      </applicability>
      <requirements>
        <property dataType="IFCLABEL" cardinality="required">
          <propertySet><simpleValue>Pset_WallCommon</simpleValue></propertySet>
          <baseName><simpleValue>FireRating</simpleValue></baseName>
        </property>
      </requirements>
    </specification>
  </specifications>
</ids>`;

async function wallSession(): Promise<{ session: ModelSession; wallId: number }> {
  const creator = new IfcCreator({ Name: "M5-Pruefprobe" });
  const storey = creator.addIfcBuildingStorey({ Name: "EG", Elevation: 0 });
  creator.addIfcWall(storey, {
    Name: "Testwand",
    Start: [0, 0, 0],
    End: [5, 0, 0],
    Thickness: 0.2,
    Height: 3,
  });
  const bytes = new TextEncoder().encode(creator.toIfc().content);
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const session = await ModelSession.open("m5.ifc", buffer);
  const wallId = (session.store.entityIndex.byType.get("IFCWALL") ?? [])[0];
  return { session, wallId };
}

describe("Rauchtest Prüfzentrum", () => {
  it("IDS-Quelle meldet Fehlschlag und sieht Sitzungsänderungen", async () => {
    const { session, wallId } = await wallSession();
    expect(wallId).toBeGreaterThan(0);
    useIdsDocuments.getState().clear();
    expect(useIdsDocuments.getState().addFromXml("rauch.ids", IDS_XML)).toBe(true);

    const first = await runIdsChecks(session);
    console.log(JSON.stringify(first.findings.slice(0, 3), null, 1));
    expect(first.checkedCount).toBeGreaterThan(0);
    expect(first.findings.length).toBeGreaterThan(0);
    expect(first.findings[0].severity).toBe("error");
    expect(first.findings[0].message).toContain("nicht erfüllt");

    // Sitzungsänderung: Property setzen → Befund muss verschwinden.
    cmdSetProperty(session, wallId, "Pset_WallCommon", "FireRating", "F90").run();
    const second = await runIdsChecks(session);
    console.log("nach Edit:", second.findings.length);
    expect(second.findings.length).toBe(0);

    // BCF-Export der ersten Befunde
    const blob = await buildBcf(session, first.findings);
    expect(blob.size).toBeGreaterThan(100);

    // Store-Lauf über die Registry
    expect(registeredCheckSources()).toContain("ids");
    await useChecks.getState().runChecks("doc-smoke", session);
    const state = useChecks.getState().byDocument["doc-smoke"];
    console.log("Quellenstatus", state.status, "Revision", state.ranAtRevision);
    expect(state.running).toBe(false);
    console.log("Befunde gesamt", allFindings(state).length);
  });

  it("fängt Fehler einer Quelle als eigenen Befund", async () => {
    const { session } = await wallSession();
    const { registerCheckSource } = await import("../../domain/checks/store");
    registerCheckSource("clash", async () => {
      throw new Error("Testfehler");
    });
    await useChecks.getState().runChecks("doc-fehler", session);
    const state = useChecks.getState().byDocument["doc-fehler"];
    const finding = allFindings(state).find((f) => f.kind === "source-error");
    console.log(finding);
    expect(finding?.severity).toBe("error");
    expect(state.status.clash).toBe("error");
  });
});
