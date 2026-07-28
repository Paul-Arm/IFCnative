/**
 * Katalog-Quick-Fixes und Massenaktionen als EditorCommands (M3).
 *
 * Alle Änderungen laufen über die bestehenden Command-Familien
 * (`cmdCreatePset`, `cmdSetProperty`) und damit über `execute()` — jede
 * Aktion ist ein einziger, undo-barer Schritt.
 */
import type { ModelSession } from "../../core/session";
import type { EditorCommand } from "../../commands/pipeline";
import { cmdSetProperty } from "../../commands/propertyCommands";
import { cmdCreatePset, type PsetProperty } from "../../commands/psetCommands";
import {
  catalogObjectLabel,
  catalogValueTypeToPropertyType,
  defaultCatalogValue,
  groupCatalogRulesByPset,
  type CatalogObjectType,
  type CatalogPropertyRule,
  type CatalogValidationFinding,
} from "./model";

/** Mehrere Commands zu einem Undo-Schritt bündeln. */
export function composeCommands(
  label: string,
  commands: readonly EditorCommand[],
): EditorCommand {
  return {
    label,
    run() {
      for (const command of commands) command.run();
    },
    undo() {
      for (const command of [...commands].reverse()) command.undo();
    },
  };
}

function psetPropertyOf(rule: CatalogPropertyRule): PsetProperty {
  return {
    name: rule.propertyName,
    value: defaultCatalogValue(rule),
    type: catalogValueTypeToPropertyType(rule.valueType),
    unit: rule.unit || undefined,
  };
}

/**
 * Quick-Fix eines Befunds. `null`, wenn der Befund nicht automatisch behebbar
 * ist (`class-mismatch`, `missing-classification`, `empty-required-value` —
 * siehe Entscheidung in validation.ts).
 */
export function cmdCatalogQuickFix(
  session: ModelSession,
  finding: CatalogValidationFinding,
): EditorCommand | null {
  const fix = finding.quickFix;
  if (!fix || fix.kind !== "add-pset-properties") return null;
  const psetName = fix.psetName ?? finding.psetName;
  const rules = fix.properties ?? [];
  if (!psetName || rules.length === 0) return null;

  if (finding.kind === "missing-pset") {
    return cmdCreatePset(
      session,
      finding.entityId,
      psetName,
      rules.map(psetPropertyOf),
    );
  }
  // Das Pset existiert bereits — nur die fehlenden Merkmale nachtragen.
  return composeCommands(
    `${rules.length} Merkmale in „${psetName}" ergänzt (#${finding.entityId})`,
    rules.map((rule) =>
      cmdSetProperty(
        session,
        finding.entityId,
        psetName,
        rule.propertyName,
        defaultCatalogValue(rule),
        catalogValueTypeToPropertyType(rule.valueType),
      ),
    ),
  );
}

/** Alle behebbaren Befunde einer Prüfung in einem Undo-Schritt. */
export function cmdCatalogQuickFixAll(
  session: ModelSession,
  findings: readonly CatalogValidationFinding[],
): EditorCommand | null {
  const commands = findings
    .map((entry) => cmdCatalogQuickFix(session, entry))
    .filter((command): command is EditorCommand => command !== null);
  if (commands.length === 0) return null;
  return composeCommands(
    `${commands.length} Katalog-Quick-Fixes angewendet`,
    commands,
  );
}

/**
 * Alle Merkmalsgruppen einer Katalogklasse als Psets mit Katalog-Typen und
 * neutralen Startwerten auf die übergebenen Objekte legen — ein Undo-Schritt.
 * Bereits vorhandene Merkmalsgruppen werden übersprungen.
 */
export function cmdApplyCatalogPsets(
  session: ModelSession,
  expressIds: readonly number[],
  objectType: CatalogObjectType,
): EditorCommand | null {
  const groups = [...groupCatalogRulesByPset(objectType.propertyRules)];
  if (groups.length === 0 || expressIds.length === 0) return null;

  const commands: EditorCommand[] = [];
  for (const expressId of expressIds) {
    const existing = new Set(
      session.view.getForEntity(expressId).map((set) => set.name),
    );
    for (const [psetName, rules] of groups) {
      if (existing.has(psetName)) continue;
      commands.push(
        cmdCreatePset(session, expressId, psetName, rules.map(psetPropertyOf)),
      );
    }
  }
  if (commands.length === 0) return null;

  return composeCommands(
    `Katalogklasse „${catalogObjectLabel(objectType)}": ${commands.length} Merkmalsgruppen auf ${expressIds.length} Objekte`,
    commands,
  );
}
