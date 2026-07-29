import {
  applyCatalogQuickFix,
  applyDiagnosticObjectInfo,
  applyDiagnosticProcedureFromCatalog,
  setDiagnosticObjectiveReferences as setNativeDiagnosticObjectiveReferences,
  type CatalogObjectType,
  type CatalogValidationFinding,
  type DiagnosticObjectInfoDraft,
} from "@/ifc";

import type { WorkspaceEditContext } from "./context";

/**
 * Katalog-Quick-Fixes und Diagnostik-Assistent: wendet Findings, Objekt-
 * Informationen und Untersuchungs-Prozeduren aus dem Objektkatalog auf das
 * aktive Element an.
 */
export function useCatalogActions(
  context: WorkspaceEditContext & {
    setSelectedCatalogObjectId: (id: string) => void;
  },
) {
  const { commitDocument, document, selectedId, setSelectedCatalogObjectId } =
    context;

  const applyCatalogFinding = (finding: CatalogValidationFinding) => {
    const sourceDocument = document;
    const next = applyCatalogQuickFix(sourceDocument, selectedId, finding);
    if (next === sourceDocument) {
      return;
    }
    commitDocument(
      next,
      selectedId,
      `Catalog quick fix: ${finding.quickFix?.label ?? finding.kind}`,
      `catalog.quickFix({ id: ${selectedId}, kind: '${finding.kind}' });`,
    );
  };

  const applyCatalogFindings = (findings: CatalogValidationFinding[]) => {
    const fixes = findings.filter((finding) => finding.quickFix);
    if (!fixes.length) {
      return;
    }
    const sourceDocument = document;
    const next = fixes.reduce(
      (currentDocument, finding) =>
        applyCatalogQuickFix(currentDocument, selectedId, finding),
      sourceDocument,
    );
    if (next === sourceDocument) {
      return;
    }
    commitDocument(
      next,
      selectedId,
      `Apply ${fixes.length.toLocaleString()} catalog quick fixes to #${selectedId}`,
      `catalog.quickFixAll({ id: ${selectedId}, fixes: ${fixes.length} });`,
    );
  };

  const applyDiagnosticObjectInfoDraft = (draft: DiagnosticObjectInfoDraft) => {
    const next = applyDiagnosticObjectInfo(document, selectedId, draft);
    if (next === document) {
      return;
    }
    commitDocument(
      next,
      selectedId,
      `Apply diagnostics object information to #${selectedId}`,
      `diagnostics.objectInfo({ id: ${selectedId}, role: '${draft.role}' });`,
    );
  };

  const applyDiagnosticProcedure = (objectType: CatalogObjectType) => {
    const next = applyDiagnosticProcedureFromCatalog(
      document,
      selectedId,
      objectType,
    );
    if (next === document) {
      return;
    }
    setSelectedCatalogObjectId(objectType.id);
    commitDocument(
      next,
      selectedId,
      `Apply diagnostics procedure ${objectType.code || objectType.name} to #${selectedId}`,
      `diagnostics.procedure({ id: ${selectedId}, catalogObject: '${objectType.id}' });`,
    );
  };

  const setDiagnosticObjectiveReferences = (
    setId: number,
    objectiveIds: string[],
  ) => {
    const next = setNativeDiagnosticObjectiveReferences(
      document,
      selectedId,
      setId,
      objectiveIds,
    );
    if (next === document) {
      return;
    }
    commitDocument(
      next,
      selectedId,
      `Set investigation objectives on #${setId}`,
      `diagnostics.objectives({ setId: ${setId}, values: ${JSON.stringify(objectiveIds)} });`,
    );
  };

  return {
    applyCatalogFinding,
    applyCatalogFindings,
    applyDiagnosticObjectInfoDraft,
    applyDiagnosticProcedure,
    setDiagnosticObjectiveReferences,
  };
}
