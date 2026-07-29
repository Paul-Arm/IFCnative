import { useEffect, useState } from "react";

import { type NativeIfcDocument } from "@/ifc";

import { Badge, PanelHeader, PanelShell } from "../ui";
import {
  CompactAddSection,
  CompactCreateButton,
  CompactResourceCard,
  CompactTextInput,
  getResourceAssociations,
  type ResourceAssociation,
  type ResourceEditCallbacks,
} from "./resource-shared";
import { EmptyBlock } from "./shared";
import {
  readOptionalStepString,
  setStepArgs,
  writeOptionalStepString,
} from "./step-values";

/* ------------------------------------------------------------------ */
/* Panel "Klassifikation & Dokumente" (eigenes Mosaic-Fenster)         */
/* ------------------------------------------------------------------ */

function EditableReferenceResource({
  association,
  onRemoveAssociation,
  onUpdateEntityArgs,
}: {
  association: ResourceAssociation;
} & ResourceEditCallbacks) {
  const { relationship, resource } = association;
  const [location, setLocation] = useState(
    readOptionalStepString(resource.args[0]),
  );
  const [identification, setIdentification] = useState(
    readOptionalStepString(resource.args[1]),
  );
  const [name, setName] = useState(readOptionalStepString(resource.args[2]));

  useEffect(() => {
    setLocation(readOptionalStepString(resource.args[0]));
    setIdentification(readOptionalStepString(resource.args[1]));
    setName(readOptionalStepString(resource.args[2]));
  }, [resource.args, resource.id]);

  // logLabel bleibt englisch, damit bestehende Log-/History-Zeilen
  // ("Update classification #…") unverändert bleiben.
  const { logLabel, uiLabel } =
    resource.type === "IFCCLASSIFICATIONREFERENCE"
      ? { logLabel: "Classification", uiLabel: "Klassifikation" }
      : resource.type === "IFCDOCUMENTREFERENCE"
        ? { logLabel: "Document", uiLabel: "Dokument" }
        : { logLabel: "Library", uiLabel: "Bibliothek" };

  return (
    <CompactResourceCard
      title={`${uiLabel} #${resource.id}`}
      relation={`#${relationship.id} ${relationship.type}`}
      onRemove={() => onRemoveAssociation(relationship.id)}
      onSave={() =>
        onUpdateEntityArgs(
          [
            {
              args: setStepArgs(resource.args, {
                0: writeOptionalStepString(location),
                1: writeOptionalStepString(identification),
                2: writeOptionalStepString(name),
              }),
              entityId: resource.id,
            },
          ],
          `Update ${logLabel.toLowerCase()} #${resource.id}`,
        )
      }
    >
      <div className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-2">
        <CompactTextInput
          label="Kennung"
          value={identification}
          onChangeText={setIdentification}
        />
        <CompactTextInput label="Name" value={name} onChangeText={setName} />
        <CompactTextInput
          label="Ort / URI"
          value={location}
          onChangeText={setLocation}
        />
      </div>
    </CompactResourceCard>
  );
}

export function ResourceReferencesPanel({
  document,
  selectedId,
  onAddClassification,
  onAddDocumentReference,
  onAddLibraryReference,
  onRemoveAssociation,
  onUpdateEntityArgs,
}: {
  document: NativeIfcDocument;
  selectedId: number;
  onAddClassification(
    identification: string,
    name: string,
    location: string,
  ): void;
  onAddDocumentReference(
    identification: string,
    name: string,
    location: string,
  ): void;
  onAddLibraryReference(
    identification: string,
    name: string,
    location: string,
  ): void;
  onRemoveAssociation(relationshipId: number): void;
  onUpdateEntityArgs(
    updates: Array<{ entityId: number; args: string[] }>,
    label: string,
  ): void;
}) {
  const referenceAssociations = getResourceAssociations(document, selectedId, [
    "IFCRELASSOCIATESCLASSIFICATION",
    "IFCRELASSOCIATESDOCUMENT",
    "IFCRELASSOCIATESLIBRARY",
  ]);
  const [classificationId, setClassificationId] = useState("");
  const [classificationName, setClassificationName] = useState("");
  const [classificationUri, setClassificationUri] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [documentName, setDocumentName] = useState("");
  const [documentUri, setDocumentUri] = useState("");
  const [libraryId, setLibraryId] = useState("");
  const [libraryName, setLibraryName] = useState("");
  const [libraryUri, setLibraryUri] = useState("");

  return (
    <PanelShell scroll>
      <PanelHeader
        eyebrow={`Auswahl #${selectedId}`}
        title="Klassifikation & Dokumente"
        description={`${referenceAssociations.length.toLocaleString("de-DE")} verknüpfte Referenzen`}
        meta={<Badge tone="neutral">IFC</Badge>}
      />
      <div className="grid gap-2">
        {referenceAssociations.length ? (
          referenceAssociations.map((association) => (
            <EditableReferenceResource
              key={`${association.relationship.id}-${association.resource.id}`}
              association={association}
              onRemoveAssociation={onRemoveAssociation}
              onUpdateEntityArgs={onUpdateEntityArgs}
            />
          ))
        ) : (
          <EmptyBlock>
            Keine Klassifikation, kein Dokument und keine Bibliothek
            zugewiesen.
          </EmptyBlock>
        )}
      </div>
      <CompactAddSection title="Klassifikation hinzufügen">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-2">
          <CompactTextInput
            label="Kennung"
            placeholder="z. B. DIN 276-1"
            value={classificationId}
            onChangeText={setClassificationId}
          />
          <CompactTextInput
            label="Name"
            placeholder="z. B. Kostengruppe"
            value={classificationName}
            onChangeText={setClassificationName}
          />
          <CompactTextInput
            label="Ort / URI"
            placeholder="https://…"
            value={classificationUri}
            onChangeText={setClassificationUri}
          />
        </div>
        <CompactCreateButton
          disabled={!classificationId.trim() && !classificationName.trim()}
          label="Klassifikation hinzufügen"
          title="Mindestens Kennung oder Name angeben"
          onClick={() =>
            onAddClassification(
              classificationId,
              classificationName,
              classificationUri,
            )
          }
        />
      </CompactAddSection>
      <CompactAddSection title="Dokument hinzufügen">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-2">
          <CompactTextInput
            label="Kennung"
            placeholder="z. B. DOC-001"
            value={documentId}
            onChangeText={setDocumentId}
          />
          <CompactTextInput
            label="Name"
            placeholder="z. B. Prüfbericht"
            value={documentName}
            onChangeText={setDocumentName}
          />
          <CompactTextInput
            label="Ort / URI"
            placeholder="https://…"
            value={documentUri}
            onChangeText={setDocumentUri}
          />
        </div>
        <CompactCreateButton
          disabled={!documentId.trim() && !documentName.trim()}
          label="Dokument hinzufügen"
          title="Mindestens Kennung oder Name angeben"
          onClick={() =>
            onAddDocumentReference(documentId, documentName, documentUri)
          }
        />
      </CompactAddSection>
      <CompactAddSection title="Bibliothek hinzufügen">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-2">
          <CompactTextInput
            label="Kennung"
            placeholder="z. B. LIB-001"
            value={libraryId}
            onChangeText={setLibraryId}
          />
          <CompactTextInput
            label="Name"
            placeholder="z. B. Objektbibliothek"
            value={libraryName}
            onChangeText={setLibraryName}
          />
          <CompactTextInput
            label="Ort / URI"
            placeholder="https://…"
            value={libraryUri}
            onChangeText={setLibraryUri}
          />
        </div>
        <CompactCreateButton
          disabled={!libraryId.trim() && !libraryName.trim()}
          label="Bibliothek hinzufügen"
          title="Mindestens Kennung oder Name angeben"
          onClick={() =>
            onAddLibraryReference(libraryId, libraryName, libraryUri)
          }
        />
      </CompactAddSection>
    </PanelShell>
  );
}
