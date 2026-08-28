import { useState } from "react";

import {
    type IdsDocumentModel,
    type NativeIfcDocument,
    type ObjectInfoIndex,
    type ObjectInfoValidationFinding,
} from "@/ifc";

import { IdsPanel } from "./IdsPanel";
import { ObjectInfoPanel } from "./ObjectInfoPanel";
import { PanelShell, SegmentedControl } from "./ui";

const CHECK_TABS = [
  { label: "IDs", value: "object-info" },
  { label: "IDS", value: "ids" },
];

/**
 * Kombiniertes Prüf-Panel: Tab „IDs“ prüft die Objektinfo-IDs des Modells
 * (Eindeutigkeit, Referenzen), Tab „IDS“ validiert gegen eine geladene
 * Information Delivery Specification (buildingSMART).
 */
export function CheckPanel({
  document,
  ids,
  idsImporting,
  objectInfoFindings,
  objectInfoIndex,
  selectedId,
  onImportIds,
  onRemoveIds,
  onSelectEntity,
}: {
  document: NativeIfcDocument;
  ids: IdsDocumentModel | null;
  idsImporting: boolean;
  objectInfoFindings: ObjectInfoValidationFinding[];
  objectInfoIndex: ObjectInfoIndex;
  selectedId: number;
  onImportIds(): void;
  onRemoveIds(): void;
  onSelectEntity(id: number): void;
}) {
  const [tab, setTab] = useState("object-info");

  return (
    <PanelShell>
      <div className="shrink-0">
        <SegmentedControl options={CHECK_TABS} value={tab} onChange={setTab} />
      </div>
      <div className="min-h-0 flex-1">
        {tab === "ids" ? (
          <IdsPanel
            document={document}
            ids={ids}
            importing={idsImporting}
            objectInfoIndex={objectInfoIndex}
            selectedId={selectedId}
            onImportIds={onImportIds}
            onRemoveIds={onRemoveIds}
            onSelectEntity={onSelectEntity}
          />
        ) : (
          <ObjectInfoPanel
            document={document}
            findings={objectInfoFindings}
            index={objectInfoIndex}
            selectedId={selectedId}
            onSelectEntity={onSelectEntity}
          />
        )}
      </div>
    </PanelShell>
  );
}
