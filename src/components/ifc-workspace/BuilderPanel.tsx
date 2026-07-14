import {
  Box,
  ClipboardPaste,
  Crosshair,
  MousePointer2,
  Ruler,
  Target,
  Trash2,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import {
  getNativeBodyRepresentation,
  getNativeLengthUnitScale,
  type NativeBodyProfile,
  type NativeIfcDocument,
} from "@/ifc";

import { ENTITY_TYPES } from "./constants";
import type { BodyElementDraft, CoordinateClipboard } from "./types";
import {
  Badge,
  Button,
  DropdownField,
  InlineAlert,
  LabeledInput,
  PanelHeader,
  PanelShell,
  shortType,
} from "./ui";

const BODY_PROFILE_OPTIONS: {
  detail: string;
  label: string;
  value: NativeBodyProfile;
}[] = [
  { detail: "Extrudiertes Rechteck", label: "Rechteck", value: "rectangle" },
  { detail: "Extrudierter Kreis", label: "Zylinder", value: "cylinder" },
  { detail: "Extrudierte Ellipse", label: "Ellipse", value: "ellipse" },
  {
    detail: "Extrudiertes Dreieck (Keil)",
    label: "Dreieck",
    value: "triangle",
  },
  {
    detail: "Aufrechter, flacher Karten-Pin",
    label: "Positionsmarker",
    value: "marker",
  },
];

const ROUND_PROFILES: ReadonlySet<NativeBodyProfile> = new Set([
  "cylinder",
  "ellipse",
]);

export function BuilderPanel({
  coordinateClipboard,
  document,
  selectedId,
  onAddBodyElement,
  onLoadSystemCoordinates,
  onRemoveBodyFromSelected,
}: {
  coordinateClipboard: CoordinateClipboard | null;
  document: NativeIfcDocument;
  selectedId: number;
  onAddBodyElement(options: BodyElementDraft): void;
  onLoadSystemCoordinates(): Promise<CoordinateClipboard | undefined>;
  onRemoveBodyFromSelected(): void;
}) {
  const [bodyType, setBodyType] = useState("IFCBUILTELEMENT");
  const [bodyName, setBodyName] = useState("Neuer 3D-Körper");
  const [bodyWidth, setBodyWidth] = useState("4");
  const [bodyDepth, setBodyDepth] = useState("2");
  const [bodyHeight, setBodyHeight] = useState("1.5");
  const [bodyProfile, setBodyProfile] =
    useState<NativeBodyProfile>("rectangle");
  const [bodyPlacementMode, setBodyPlacementMode] = useState<
    "parent" | "world"
  >("world");
  const [bodyX, setBodyX] = useState("0");
  const [bodyY, setBodyY] = useState("0");
  const [bodyZ, setBodyZ] = useState("0");
  const [bodyTag, setBodyTag] = useState("IFCNATIVE-BODY");
  const selectedEntity = document.entityById.get(selectedId);
  const selectedParentId = findHierarchyParentId(document, selectedId);
  const selectedBody = getNativeBodyRepresentation(document, selectedId);
  const unitScale = getNativeLengthUnitScale(document);
  const unitLabel = describeLengthUnit(unitScale);

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

  const coordinateSummary = coordinateClipboard
    ? describeCoordinateClipboard(coordinateClipboard)
    : "0, 0, 0";

  return (
    <PanelShell scroll>
      <PanelHeader
        title="Körper-Builder"
        meta={
          <Badge tone={selectedBody.hasRepresentation ? "success" : "neutral"}>
            #{selectedId}{" "}
            {selectedEntity ? shortType(selectedEntity.type) : "Auswahl"}
          </Badge>
        }
      />
      <section className="grid min-w-0 shrink-0 gap-2.5 pb-2">
        <div className="grid min-w-0 gap-1.5 border-y border-border/60 py-2">
          <StatusPill
            icon={<Target aria-hidden className="size-3.5" />}
            label="Ziel"
            value={`#${selectedId}${selectedEntity ? ` · ${shortType(selectedEntity.type)}` : ""}`}
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
          <StatusPill
            icon={<Ruler aria-hidden className="size-3.5" />}
            label="Modelleinheit"
            value={unitLabel}
          />
        </div>

        <FormGrid>
          <DropdownField
            label="Elementklasse"
            options={ENTITY_TYPES}
            value={bodyType}
            onChange={setBodyType}
          />
          <LabeledInput
            label="Name"
            value={bodyName}
            onChangeText={setBodyName}
          />
          <LabeledInput
            label="Kennzeichen"
            value={bodyTag}
            onChangeText={setBodyTag}
          />
        </FormGrid>

        <FormGrid>
          <DropdownField
            label="Profil"
            options={BODY_PROFILE_OPTIONS}
            value={bodyProfile}
            onChange={(value) => setBodyProfile(value as NativeBodyProfile)}
          />
          <LabeledInput
            label={
              ROUND_PROFILES.has(bodyProfile)
                ? "Durchmesser X (m)"
                : "Breite X (m)"
            }
            keyboardType="numeric"
            value={bodyWidth}
            onChangeText={setBodyWidth}
          />
          <LabeledInput
            label={
              ROUND_PROFILES.has(bodyProfile)
                ? "Durchmesser Z (m)"
                : "Tiefe Z (m)"
            }
            keyboardType="numeric"
            value={bodyDepth}
            onChangeText={setBodyDepth}
          />
          <LabeledInput
            label="Höhe Y (m)"
            keyboardType="numeric"
            value={bodyHeight}
            onChangeText={setBodyHeight}
          />
        </FormGrid>

        <FormGrid>
          <LabeledInput
            label="X (m)"
            keyboardType="numeric"
            value={bodyX}
            onChangeText={setBodyX}
          />
          <LabeledInput
            label="Y (m, Höhe)"
            keyboardType="numeric"
            value={bodyY}
            onChangeText={setBodyY}
          />
          <LabeledInput
            label="Z (m)"
            keyboardType="numeric"
            value={bodyZ}
            onChangeText={setBodyZ}
          />
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
        </FormGrid>

        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/30 px-2.5 py-2">
          <div className="min-w-0 flex-1 basis-40">
            <div className="flex items-center gap-1.5 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
              <Crosshair aria-hidden className="size-3.5 shrink-0" />
              Koordinaten
            </div>
            <p
              className="mt-0.5 truncate text-xs text-foreground"
              title={coordinateSummary}
            >
              {coordinateSummary}
            </p>
          </div>
          <Button
            title={
              coordinateClipboard
                ? "Gemerkten Punkt in die Positionsfelder übernehmen"
                : "Koordinaten aus dem System-Clipboard lesen"
            }
            variant="outline"
            onClick={() => void loadCoordinateClipboard()}
          >
            <ClipboardPaste aria-hidden className="size-3.5" />
            {coordinateClipboard ? "Punkt übernehmen" : "Clipboard lesen"}
          </Button>
        </div>

        <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-2">
          <Button
            className="w-full min-w-0"
            title="Körper als Kind der Auswahl erstellen"
            variant="default"
            onClick={() =>
              onAddBodyElement({ ...bodyDraft, parentId: selectedId })
            }
          >
            <Box aria-hidden className="size-3.5" />
            <span className="truncate">Als Kind der Auswahl erstellen</span>
          </Button>
          <Button
            className="w-full min-w-0"
            disabled={selectedParentId == null}
            title="Körper am Parent der Auswahl erstellen"
            variant="default"
            onClick={() => {
              if (selectedParentId == null) {
                return;
              }
              onAddBodyElement({
                ...bodyDraft,
                parentId: selectedParentId,
              });
            }}
          >
            <Box aria-hidden className="size-3.5" />
            <span className="truncate">Am Parent der Auswahl erstellen</span>
          </Button>
        </div>
        {selectedParentId == null ? (
          <InlineAlert tone="warning">
            Die Auswahl hat keinen Parent in der IFC-Struktur.
          </InlineAlert>
        ) : null}

        <div className="border-t border-border/60 pt-2.5">
          <Button
            className="w-full min-w-0 border-destructive/40 text-destructive hover:border-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={!selectedBody.hasRepresentation}
            title={
              selectedBody.hasRepresentation
                ? `Geometrie von #${selectedId} entfernen (Element, Platzierung und Psets bleiben erhalten)`
                : `#${selectedId} hat keine Körper-Geometrie`
            }
            variant="outline"
            onClick={onRemoveBodyFromSelected}
          >
            <Trash2 aria-hidden className="size-3.5" />
            <span className="truncate">Ausgewählte Geometrie löschen</span>
          </Button>
        </div>
      </section>
    </PanelShell>
  );
}

function describeLengthUnit(metersPerUnit: number) {
  if (Math.abs(metersPerUnit - 1) < 1e-9) {
    return "Meter (×1)";
  }
  if (Math.abs(metersPerUnit - 0.001) < 1e-9) {
    return "Millimeter (×0,001)";
  }
  if (Math.abs(metersPerUnit - 0.01) < 1e-9) {
    return "Zentimeter (×0,01)";
  }
  if (Math.abs(metersPerUnit - 0.3048) < 1e-6) {
    return "Fuß (×0,3048)";
  }
  return `×${metersPerUnit}`;
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

function FormGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-2">
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
    <div className="grid min-w-0 grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-2">
      <span className="flex min-w-0 items-center gap-1.5 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
      </span>
      <span className="truncate text-xs text-foreground" title={value}>
        {value}
      </span>
    </div>
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
