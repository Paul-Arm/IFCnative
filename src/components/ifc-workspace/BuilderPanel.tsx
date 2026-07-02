import {
    Box,
    Crosshair,
    MousePointer2,
    Plus,
    Replace,
    Ruler,
    Target,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { type NativeIfcDocument, type NativeIfcEntity } from "@/ifc";

import { ENTITY_TYPES } from "./constants";
import type { BodyElementDraft, CoordinateClipboard } from "./types";
import {
    Badge,
    Button,
    DropdownField,
    LabeledInput,
    PanelHeader,
    PanelShell,
} from "./ui";

export function BuilderPanel({
  coordinateClipboard,
  document,
  selectedId,
  onAddBodyElement,
  onAssignBodyToSelected,
  onLoadSystemCoordinates,
}: {
  coordinateClipboard: CoordinateClipboard | null;
  document: NativeIfcDocument;
  selectedId: number;
  onAddBodyElement(options: BodyElementDraft): void;
  onAssignBodyToSelected(options: BodyElementDraft): void;
  onLoadSystemCoordinates(): Promise<CoordinateClipboard | undefined>;
}) {
  const [bodyAction, setBodyAction] = useState<"new" | "replace">("new");
  const [bodyType, setBodyType] = useState("IFCBUILTELEMENT");
  const [bodyName, setBodyName] = useState("Neuer 3D-Körper");
  const [bodyWidth, setBodyWidth] = useState("4");
  const [bodyDepth, setBodyDepth] = useState("2");
  const [bodyHeight, setBodyHeight] = useState("1.5");
  const [bodyProfile, setBodyProfile] = useState<"rectangle" | "cylinder">(
    "rectangle",
  );
  const [bodyPlacementMode, setBodyPlacementMode] = useState<
    "parent" | "world"
  >("world");
  const [bodyX, setBodyX] = useState("0");
  const [bodyY, setBodyY] = useState("0");
  const [bodyZ, setBodyZ] = useState("0");
  const [bodyTag, setBodyTag] = useState("IFCNATIVE-BODY");
  const selectedEntity = document.entityById.get(selectedId);
  const selectedParentId = findHierarchyParentId(document, selectedId);
  const canReplaceBody = isBodyTargetEntity(selectedEntity);

  const loadCoordinateClipboard = async () => {
    if (!coordinateClipboard) {
      const systemClipboard = await onLoadSystemCoordinates();
      if (systemClipboard) {
        const placement = coordinateClipboardToBodyPlacement(systemClipboard);
        setBodyX(placement.x);
        setBodyY(placement.y);
        setBodyZ(placement.z);
        setBodyPlacementMode("world");
      }
      return;
    }
    const placement = coordinateClipboardToBodyPlacement(coordinateClipboard);
    setBodyX(placement.x);
    setBodyY(placement.y);
    setBodyZ(placement.z);
    setBodyPlacementMode("world");
  };

  const bodyDraft: BodyElementDraft = {
    depth: bodyDepth,
    height: bodyHeight,
    name: bodyName,
    placementMode: bodyPlacementMode,
    profile: bodyProfile,
    tag: bodyTag,
    type: bodyType,
    width: bodyWidth,
    x: bodyX,
    y: bodyY,
    z: bodyZ,
  };

  return (
    <PanelShell scroll>
      <PanelHeader
        eyebrow={document.fileName}
        title="Körper Builder"
        description="Neue Fragment-Körper erstellen oder die Geometrie der aktuellen Auswahl ersetzen."
        meta={
          <Badge tone={canReplaceBody ? "success" : "neutral"}>
            #{selectedId}{" "}
            {selectedEntity?.type.replace(/^IFC/i, "") ?? "Auswahl"}
          </Badge>
        }
      />
      <section className="grid min-w-0 shrink-0 gap-3 pb-2">
        <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-2">
          <ModeButton
            active={bodyAction === "new"}
            icon={<Plus aria-hidden className="size-4" />}
            title="Neues IFC-Element"
            subtitle={`${shortIfc(bodyType)} mit eigener Fragment-Geometrie`}
            onPress={() => setBodyAction("new")}
          />
          <ModeButton
            active={bodyAction === "replace"}
            icon={<Replace aria-hidden className="size-4" />}
            title="Auswahl-Geometrie"
            subtitle={`Geometrie von #${selectedId} ersetzen`}
            onPress={() => setBodyAction("replace")}
          />
        </div>

        <BuilderStatusGrid>
          <StatusPill
            icon={<Target aria-hidden className="size-3.5" />}
            label="Ziel"
            value={`${document.fileName} / #${selectedId}`}
          />
          <StatusPill
            icon={<MousePointer2 aria-hidden className="size-3.5" />}
            label="Punktquelle"
            value={describeCoordinateSource(coordinateClipboard)}
          />
          <StatusPill
            icon={<Crosshair aria-hidden className="size-3.5" />}
            label="Position"
            value={`${bodyX}, ${bodyY}, ${bodyZ}`}
          />
        </BuilderStatusGrid>

        <FormRow compact>
          <FormField>
            <DropdownField
              label="Elementklasse"
              options={ENTITY_TYPES}
              value={bodyType}
              onChange={setBodyType}
            />
          </FormField>
          <FormField>
            <LabeledInput
              label="Name"
              value={bodyName}
              onChangeText={setBodyName}
            />
          </FormField>
          <FormField>
            <LabeledInput
              label="Kennzeichen"
              value={bodyTag}
              onChangeText={setBodyTag}
            />
          </FormField>
        </FormRow>

        <FormRow compact>
          <FormField>
            <DropdownField
              label="Profil"
              options={[
                { label: "Rechteck", value: "rectangle" },
                { label: "Zylinder", value: "cylinder" },
              ]}
              value={bodyProfile}
              onChange={(value) =>
                setBodyProfile(value as "rectangle" | "cylinder")
              }
            />
          </FormField>
          <FormField>
            <LabeledInput
              label={bodyProfile === "cylinder" ? "Durchmesser X" : "Breite X"}
              keyboardType="numeric"
              value={bodyWidth}
              onChangeText={setBodyWidth}
            />
          </FormField>
          <FormField>
            <LabeledInput
              label={bodyProfile === "cylinder" ? "Durchmesser Z" : "Tiefe Z"}
              keyboardType="numeric"
              value={bodyDepth}
              onChangeText={setBodyDepth}
            />
          </FormField>
          <FormField>
            <LabeledInput
              label="Höhe Y"
              keyboardType="numeric"
              value={bodyHeight}
              onChangeText={setBodyHeight}
            />
          </FormField>
        </FormRow>

        <FormRow compact>
          <FormField>
            <LabeledInput
              label="X"
              keyboardType="numeric"
              value={bodyX}
              onChangeText={setBodyX}
            />
          </FormField>
          <FormField>
            <LabeledInput
              label="Y (Höhe)"
              keyboardType="numeric"
              value={bodyY}
              onChangeText={setBodyY}
            />
          </FormField>
          <FormField>
            <LabeledInput
              label="Z"
              keyboardType="numeric"
              value={bodyZ}
              onChangeText={setBodyZ}
            />
          </FormField>
          <FormField>
            <DropdownField
              label="Position"
              options={[
                {
                  detail: "Absolut im Modell (Viewer-Weltpunkt)",
                  label: "Weltposition",
                  value: "world",
                },
                {
                  detail: "X/Y/Z als lokaler Versatz zum Parent",
                  label: "Relativ zum Parent",
                  value: "parent",
                },
              ]}
              value={bodyPlacementMode}
              onChange={(value) =>
                setBodyPlacementMode(value as "parent" | "world")
              }
            />
          </FormField>
        </FormRow>

        <div className="grid min-w-0 gap-2 border-t border-border/60 pt-2.5">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Crosshair aria-hidden className="size-3.5" />
              Koordinaten
            </div>
            <p className="mt-1 truncate text-sm text-foreground">
              {coordinateClipboard
                ? describeCoordinateClipboard(coordinateClipboard)
                : "0, 0, 0"}
            </p>
          </div>
          <Button
            label={coordinateClipboard ? "Punkt übernehmen" : "Clipboard lesen"}
            onPress={() => void loadCoordinateClipboard()}
          />
        </div>

        {bodyAction === "new" ? (
          <FormRow compact>
            <FormField>
              <PrimaryBodyButton
                icon={<Box aria-hidden className="size-4" />}
                label="Körper als Kind der Auswahl erstellen"
                onPress={() =>
                  onAddBodyElement({ ...bodyDraft, parentId: selectedId })
                }
              />
            </FormField>
            <FormField>
              <PrimaryBodyButton
                disabled={selectedParentId == null}
                icon={<Box aria-hidden className="size-4" />}
                label="Körper am Parent der Auswahl erstellen"
                onPress={() => {
                  if (selectedParentId == null) {
                    return;
                  }
                  onAddBodyElement({
                    ...bodyDraft,
                    parentId: selectedParentId,
                  });
                }}
              />
            </FormField>
          </FormRow>
        ) : (
          <FormRow compact>
            <FormField>
              <PrimaryBodyButton
                disabled={!canReplaceBody}
                icon={<Ruler aria-hidden className="size-4" />}
                label="Geometrie der Auswahl ersetzen"
                onPress={() => onAssignBodyToSelected(bodyDraft)}
              />
            </FormField>
          </FormRow>
        )}
        {bodyAction === "new" && selectedParentId == null ? (
          <HintLine>
            Die Auswahl hat keinen Parent in der IFC-Struktur.
          </HintLine>
        ) : null}
        {bodyAction === "replace" && !canReplaceBody ? (
          <HintLine>
            #{selectedId} ist kein geeignetes Produkt fuer eine sichtbare
            Fragment-Geometrie.
          </HintLine>
        ) : null}
      </section>

      <p className="text-sm text-muted-foreground">
        Aktuelle Auswahl: #{selectedId}{" "}
        {document.entityById.get(selectedId)?.type}
      </p>
    </PanelShell>
  );
}

function isBodyTargetEntity(entity?: NativeIfcEntity) {
  return (
    Boolean(entity) &&
    !entity?.type.startsWith("IFCREL") &&
    !entity?.type.startsWith("IFCPROPERTY") &&
    !entity?.type.startsWith("IFCQUANTITY") &&
    ![
      "IFCPROJECT",
      "IFCSITE",
      "IFCBUILDING",
      "IFCBUILDINGSTOREY",
      "IFCOWNERHISTORY",
      "IFCAPPLICATION",
      "IFCUNITASSIGNMENT",
      "IFCSIUNIT",
    ].includes(entity?.type ?? "")
  );
}

function findHierarchyParentId(document: NativeIfcDocument, entityId: number) {
  return document.relationshipsByEntity
    .get(entityId)
    ?.find(
      (relationship) =>
        isHierarchyRelationship(relationship.type) &&
        relationship.targetIds.includes(entityId) &&
        relationship.sourceIds.length > 0,
    )?.sourceIds[0];
}

function isHierarchyRelationship(type: string) {
  return (
    type === "IFCRELAGGREGATES" ||
    type === "IFCRELNESTS" ||
    type === "IFCRELCONTAINEDINSPATIALSTRUCTURE"
  );
}

function FormRow({
  children,
  compact,
}: {
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={
        compact
          ? "grid min-w-0 grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-2"
          : "grid min-w-0 grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-2"
      }
    >
      {children}
    </div>
  );
}

function FormField({ children }: { children: ReactNode }) {
  return <div className="min-w-0 max-w-full overflow-hidden">{children}</div>;
}

function HintLine({ children }: { children: ReactNode }) {
  return (
    <div className="text-xs leading-5 text-muted-foreground">{children}</div>
  );
}

function ModeButton({
  active,
  icon,
  onPress,
  subtitle,
  title,
}: {
  active: boolean;
  icon: ReactNode;
  onPress(): void;
  subtitle: string;
  title: string;
}) {
  return (
    <button
      className={`flex min-w-0 overflow-hidden items-start gap-2 rounded-md border p-2.5 text-left transition-colors ${
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border/70 bg-background hover:bg-muted/45"
      }`}
      type="button"
      onClick={onPress}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">
          {title}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {subtitle}
        </span>
      </span>
    </button>
  );
}

function BuilderStatusGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1.5 border-y border-border/60 py-2">
      {children}
    </div>
  );
}

function StatusPill({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="grid min-w-0 grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-2 text-xs">
      <span className="flex min-w-0 items-center gap-1.5 font-semibold uppercase tracking-wide text-muted-foreground">
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
      </span>
      <span className="truncate text-sm text-foreground" title={value}>
        {value}
      </span>
    </div>
  );
}

function PrimaryBodyButton({
  disabled,
  icon,
  label,
  onPress,
}: {
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onPress(): void;
}) {
  return (
    <button
      className="inline-flex h-9 min-w-0 w-full items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
      disabled={disabled}
      type="button"
      onClick={onPress}
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

function describeCoordinateClipboard(clipboard: CoordinateClipboard) {
  const source = clipboard.fileName ?? clipboard.source;
  const placement = coordinateClipboardToBodyPlacement(clipboard);
  if (clipboard.source !== "thatopen") {
    return `X ${clipboard.x}, Y ${clipboard.y}, Z ${clipboard.z} (${source}, ${clipboard.copiedAt})`;
  }
  return `Viewer X ${placement.x}, Y ${placement.y}, Z ${placement.z} (${source}, ${clipboard.copiedAt})`;
}

function describeCoordinateSource(clipboard: CoordinateClipboard | null) {
  if (!clipboard) {
    return "Kein Picker-Punkt";
  }
  if (clipboard.source === "thatopen") {
    return clipboard.fileName
      ? `${clipboard.fileName}${clipboard.entityId ? ` / #${clipboard.entityId}` : ""}`
      : "3D-Viewer";
  }
  return "System-Clipboard";
}

function coordinateClipboardToBodyPlacement(clipboard: CoordinateClipboard) {
  return {
    x: formatBodyCoordinate(readCoordinateNumber(clipboard.x)),
    y: formatBodyCoordinate(readCoordinateNumber(clipboard.y)),
    z: formatBodyCoordinate(readCoordinateNumber(clipboard.z)),
  };
}

function readCoordinateNumber(value: string) {
  const parsed = Number(value.trim().replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatBodyCoordinate(value: number) {
  const rounded = Math.round(value * 1000) / 1000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function shortIfc(value: string) {
  return value.replace(/^IFC/i, "");
}
