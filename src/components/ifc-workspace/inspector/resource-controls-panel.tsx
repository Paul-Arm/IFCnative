import { useEffect, useState } from "react";

import { type NativeIfcDocument } from "@/ifc";

import { CONSTRAINT_GRADES, OBJECTIVE_QUALIFIERS } from "../constants";
import { Badge, PanelHeader, PanelShell } from "../ui";
import {
  CompactAddSection,
  CompactCreateButton,
  CompactResourceCard,
  CompactSelectInput,
  CompactTextInput,
  getResourceAssociations,
  type ResourceAssociation,
  type ResourceEditCallbacks,
} from "./resource-shared";
import { EmptyBlock } from "./shared";
import {
  readOptionalStepString,
  readStepEnum,
  setStepArgs,
  writeOptionalStepString,
  writeStepEnum,
} from "./step-values";

/* ------------------------------------------------------------------ */
/* Panel "Freigaben & Constraints" (eigenes Mosaic-Fenster)            */
/* ------------------------------------------------------------------ */

function EditableApprovalResource({
  association,
  onRemoveAssociation,
  onUpdateEntityArgs,
}: {
  association: ResourceAssociation;
} & ResourceEditCallbacks) {
  const { relationship, resource } = association;
  const [identifier, setIdentifier] = useState(
    readOptionalStepString(resource.args[0]),
  );
  const [name, setName] = useState(readOptionalStepString(resource.args[1]));
  const [status, setStatus] = useState(
    readOptionalStepString(resource.args[4]),
  );

  useEffect(() => {
    setIdentifier(readOptionalStepString(resource.args[0]));
    setName(readOptionalStepString(resource.args[1]));
    setStatus(readOptionalStepString(resource.args[4]));
  }, [resource.args, resource.id]);

  return (
    <CompactResourceCard
      title={`Freigabe #${resource.id}`}
      relation={`#${relationship.id} ${relationship.type}`}
      onRemove={() => onRemoveAssociation(relationship.id)}
      onSave={() =>
        onUpdateEntityArgs(
          [
            {
              args: setStepArgs(resource.args, {
                0: writeOptionalStepString(identifier),
                1: writeOptionalStepString(name),
                4: writeOptionalStepString(status),
              }),
              entityId: resource.id,
            },
          ],
          `Update approval #${resource.id}`,
        )
      }
    >
      <div className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-2">
        <CompactTextInput
          label="Kennung"
          value={identifier}
          onChangeText={setIdentifier}
        />
        <CompactTextInput label="Name" value={name} onChangeText={setName} />
        <CompactTextInput
          label="Status"
          value={status}
          onChangeText={setStatus}
        />
      </div>
    </CompactResourceCard>
  );
}

function EditableConstraintResource({
  association,
  onRemoveAssociation,
  onUpdateEntityArgs,
}: {
  association: ResourceAssociation;
} & ResourceEditCallbacks) {
  const { relationship, relationshipEntity, resource } = association;
  const [name, setName] = useState(readOptionalStepString(resource.args[0]));
  const [grade, setGrade] = useState(readStepEnum(resource.args[2]));
  const [source, setSource] = useState(
    readOptionalStepString(resource.args[3]),
  );
  const [qualifier, setQualifier] = useState(readStepEnum(resource.args[9]));
  const [intent, setIntent] = useState(
    readOptionalStepString(relationshipEntity.args[5]),
  );

  useEffect(() => {
    setName(readOptionalStepString(resource.args[0]));
    setGrade(readStepEnum(resource.args[2]));
    setSource(readOptionalStepString(resource.args[3]));
    setQualifier(readStepEnum(resource.args[9]));
    setIntent(readOptionalStepString(relationshipEntity.args[5]));
  }, [
    relationshipEntity.args,
    relationshipEntity.id,
    resource.args,
    resource.id,
  ]);

  return (
    <CompactResourceCard
      title={`Constraint #${resource.id}`}
      relation={`#${relationship.id} ${relationship.type}`}
      onRemove={() => onRemoveAssociation(relationship.id)}
      onSave={() => {
        const cleanGrade = grade || "NOTDEFINED";
        onUpdateEntityArgs(
          [
            {
              args: setStepArgs(resource.args, {
                0: writeOptionalStepString(name),
                2: writeStepEnum(cleanGrade),
                3: writeOptionalStepString(source),
                6:
                  cleanGrade.toUpperCase() === "USERDEFINED"
                    ? writeOptionalStepString("User defined")
                    : "$",
                9: writeStepEnum(qualifier || "REQUIREMENT"),
              }),
              entityId: resource.id,
            },
            {
              args: setStepArgs(relationshipEntity.args, {
                5: writeOptionalStepString(intent),
              }),
              entityId: relationship.id,
            },
          ],
          `Update constraint #${resource.id}`,
        );
      }}
    >
      <div className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-2">
        <CompactTextInput label="Name" value={name} onChangeText={setName} />
        <CompactSelectInput
          label="Grad"
          options={CONSTRAINT_GRADES}
          value={grade || "NOTDEFINED"}
          onChange={setGrade}
        />
        <CompactSelectInput
          label="Qualifier"
          options={OBJECTIVE_QUALIFIERS}
          value={qualifier || "REQUIREMENT"}
          onChange={setQualifier}
        />
        <CompactTextInput
          label="Quelle"
          value={source}
          onChangeText={setSource}
        />
        <CompactTextInput
          label="Zweck"
          value={intent}
          onChangeText={setIntent}
        />
      </div>
    </CompactResourceCard>
  );
}

export function ResourceControlsPanel({
  document,
  selectedId,
  onAddApproval,
  onAddConstraint,
  onRemoveAssociation,
  onUpdateEntityArgs,
}: {
  document: NativeIfcDocument;
  selectedId: number;
  onAddApproval(identifier: string, name: string, status: string): void;
  onAddConstraint(
    name: string,
    grade: string,
    source: string,
    qualifier: string,
    intent: string,
  ): void;
  onRemoveAssociation(relationshipId: number): void;
  onUpdateEntityArgs(
    updates: Array<{ entityId: number; args: string[] }>,
    label: string,
  ): void;
}) {
  const controlAssociations = getResourceAssociations(document, selectedId, [
    "IFCRELASSOCIATESAPPROVAL",
    "IFCRELASSOCIATESCONSTRAINT",
  ]);
  const [approvalId, setApprovalId] = useState("");
  const [approvalName, setApprovalName] = useState("");
  const [approvalStatus, setApprovalStatus] = useState("");
  const [constraintName, setConstraintName] = useState("");
  const [constraintGrade, setConstraintGrade] = useState("HARD");
  const [constraintSource, setConstraintSource] = useState("");
  const [constraintQualifier, setConstraintQualifier] = useState("REQUIREMENT");
  const [constraintIntent, setConstraintIntent] = useState("");

  return (
    <PanelShell scroll>
      <PanelHeader
        eyebrow={`Auswahl #${selectedId}`}
        title="Freigaben & Constraints"
        description={`${controlAssociations.length.toLocaleString("de-DE")} verknüpfte Kontrollressourcen`}
        meta={<Badge tone="neutral">IFC</Badge>}
      />
      <div className="grid gap-2">
        {controlAssociations.length ? (
          controlAssociations.map((association) =>
            association.resource.type === "IFCAPPROVAL" ? (
              <EditableApprovalResource
                key={`${association.relationship.id}-${association.resource.id}`}
                association={association}
                onRemoveAssociation={onRemoveAssociation}
                onUpdateEntityArgs={onUpdateEntityArgs}
              />
            ) : (
              <EditableConstraintResource
                key={`${association.relationship.id}-${association.resource.id}`}
                association={association}
                onRemoveAssociation={onRemoveAssociation}
                onUpdateEntityArgs={onUpdateEntityArgs}
              />
            ),
          )
        ) : (
          <EmptyBlock>
            Keine Freigabe und kein Constraint zugewiesen.
          </EmptyBlock>
        )}
      </div>
      <CompactAddSection title="Freigabe hinzufügen">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-2">
          <CompactTextInput
            label="Kennung"
            placeholder="z. B. APP-001"
            value={approvalId}
            onChangeText={setApprovalId}
          />
          <CompactTextInput
            label="Name"
            placeholder="z. B. Freigabe Entwurf"
            value={approvalName}
            onChangeText={setApprovalName}
          />
          <CompactTextInput
            label="Status"
            placeholder="z. B. Approved"
            value={approvalStatus}
            onChangeText={setApprovalStatus}
          />
        </div>
        <CompactCreateButton
          disabled={!approvalId.trim() && !approvalName.trim()}
          label="Freigabe hinzufügen"
          title="Mindestens Kennung oder Name angeben"
          onClick={() =>
            onAddApproval(approvalId, approvalName, approvalStatus)
          }
        />
      </CompactAddSection>
      <CompactAddSection title="Constraint hinzufügen">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-2">
          <CompactTextInput
            label="Name"
            placeholder="z. B. Anforderung erfüllen"
            value={constraintName}
            onChangeText={setConstraintName}
          />
          <CompactSelectInput
            label="Grad"
            options={CONSTRAINT_GRADES}
            value={constraintGrade}
            onChange={setConstraintGrade}
          />
          <CompactSelectInput
            label="Qualifier"
            options={OBJECTIVE_QUALIFIERS}
            value={constraintQualifier}
            onChange={setConstraintQualifier}
          />
          <CompactTextInput
            label="Quelle"
            placeholder="z. B. Bauherr"
            value={constraintSource}
            onChangeText={setConstraintSource}
          />
          <CompactTextInput
            label="Zweck"
            placeholder="z. B. EXPECTED PERFORMANCE"
            value={constraintIntent}
            onChangeText={setConstraintIntent}
          />
        </div>
        <CompactCreateButton
          label="Constraint hinzufügen"
          onClick={() =>
            onAddConstraint(
              constraintName,
              constraintGrade,
              constraintSource,
              constraintQualifier,
              constraintIntent,
            )
          }
        />
      </CompactAddSection>
    </PanelShell>
  );
}
