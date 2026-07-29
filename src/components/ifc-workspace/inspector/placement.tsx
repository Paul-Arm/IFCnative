import { useEffect, useMemo, useState } from "react";

import {
  getNativeBodyRepresentation,
  getNativeLengthUnitScale,
  getNativePlacementWorld,
  ifcPlacementPointToViewerWorldPoint,
  nativeWorldToLocalPlacementPoint,
  viewerWorldPointToIfcPlacementPoint,
  type NativeBodyProfile,
  type NativeIfcDocument,
  type NativeIfcEntity,
} from "@/ifc";

import type { BodyElementDraft } from "../types";
import {
  Badge,
  Button,
  CollapsibleSection,
  DropdownField,
  InfoSection,
  LabeledInput,
  PanelHeader,
  PanelShell,
  SegmentedControl,
} from "../ui";
import {
  EmptyBlock,
  EntityChip,
  ResponsiveField,
  ResponsiveRow,
  TextLine,
} from "./shared";

/* ------------------------------------------------------------------ */
/* Tab "Platzierung"                                                   */
/* ------------------------------------------------------------------ */

type PlacementCoordinateSpace = "welt" | "viewer";

function formatPlacementCoordinate(value: number) {
  if (!Number.isFinite(value)) {
    return "0";
  }
  const rounded = Math.round(value * 1e6) / 1e6;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function readPlacementCoordinate(value: string) {
  const parsed = Number(value.trim().replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function PlacementGeometryPanel({
  document,
  entity,
  selectedId,
  onAssignBodyToSelected,
  onMove,
  onSelectEntity,
}: {
  document: NativeIfcDocument;
  entity: NativeIfcEntity;
  selectedId: number;
  onAssignBodyToSelected(options: BodyElementDraft): void;
  onMove(x: string, y: string, z: string): void;
  onSelectEntity(entityId: number): void;
}) {
  const placement = getNativePlacementWorld(document, selectedId);
  const body = getNativeBodyRepresentation(document, selectedId);
  const [space, setSpace] = useState<PlacementCoordinateSpace>("welt");
  const [x, setX] = useState("0");
  const [y, setY] = useState("0");
  const [z, setZ] = useState("0");
  const [profile, setProfile] = useState<NativeBodyProfile>(
    body.profile ?? "rectangle",
  );
  const [width, setWidth] = useState(formatEditableNumber(body.width, "1"));
  const [depth, setDepth] = useState(formatEditableNumber(body.depth, "1"));
  const [height, setHeight] = useState(formatEditableNumber(body.height, "1"));

  // Viewer-Raum ist Meter, IFC-Raum ist Modelleinheit (mm-Modelle!).
  const metersPerUnit = getNativeLengthUnitScale(document);

  const displayPoint = useMemo(() => {
    if (!placement) {
      return { x: 0, y: 0, z: 0 };
    }
    const world = {
      x: placement.worldX,
      y: placement.worldY,
      z: placement.worldZ,
    };
    return space === "viewer"
      ? ifcPlacementPointToViewerWorldPoint(world, metersPerUnit)
      : world;
  }, [
    metersPerUnit,
    placement?.worldX,
    placement?.worldY,
    placement?.worldZ,
    space,
  ]);

  useEffect(() => {
    setX(formatPlacementCoordinate(displayPoint.x));
    setY(formatPlacementCoordinate(displayPoint.y));
    setZ(formatPlacementCoordinate(displayPoint.z));
  }, [placement?.pointId, displayPoint.x, displayPoint.y, displayPoint.z]);

  useEffect(() => {
    setProfile(body.profile ?? "rectangle");
    setWidth(formatEditableNumber(body.width, "1"));
    setDepth(formatEditableNumber(body.depth ?? body.width, "1"));
    setHeight(formatEditableNumber(body.height, "1"));
  }, [
    body.bodyRepresentationId,
    body.depth,
    body.height,
    body.profile,
    body.profileId,
    body.solidId,
    body.width,
  ]);

  const applyMove = () => {
    if (!placement) {
      return;
    }
    const input = {
      x: readPlacementCoordinate(x),
      y: readPlacementCoordinate(y),
      z: readPlacementCoordinate(z),
    };
    const worldTarget =
      space === "viewer"
        ? viewerWorldPointToIfcPlacementPoint(input, metersPerUnit)
        : input;
    const local = nativeWorldToLocalPlacementPoint(
      document,
      selectedId,
      worldTarget,
    );
    if (!local) {
      return;
    }
    onMove(
      formatPlacementCoordinate(local.x),
      formatPlacementCoordinate(local.y),
      formatPlacementCoordinate(local.z),
    );
  };

  const bodyDraft: BodyElementDraft = {
    depth,
    height,
    name: entity.name || "Assigned Body",
    profile,
    type: entity.type,
    width,
    x: "0",
    y: "0",
    z: "0",
  };

  return (
    <PanelShell scroll>
      <PanelHeader
        eyebrow={`Auswahl #${selectedId}`}
        title="Platzierung & Geometrie"
        description={
          placement
            ? `Welt: ${formatPlacementCoordinate(placement.worldX)}, ${formatPlacementCoordinate(placement.worldY)}, ${formatPlacementCoordinate(placement.worldZ)}`
            : "Keine editierbare Platzierung"
        }
        meta={
          <Badge
            tone={
              body.canEdit ? "success" : body.canAssign ? "info" : "neutral"
            }
          >
            {body.canEdit
              ? "Bearbeitbar"
              : body.canAssign
                ? "Zuweisbar"
                : "Schreibgeschützt"}
          </Badge>
        }
      />

      {placement ? (
        <InfoSection title="Position">
          <SegmentedControl
            options={[
              { label: "Welt (IFC)", value: "welt" },
              { label: "Viewer", value: "viewer" },
            ]}
            value={space}
            onChange={(value) => setSpace(value as PlacementCoordinateSpace)}
          />
          <TextLine>
            {space === "viewer"
              ? "Viewer-Koordinaten (Y = Höhe), wie im 3D-Fenster gepickt."
              : "IFC-Weltkoordinaten (Z = Höhe), absolut im Modell."}
          </TextLine>
          <ResponsiveRow>
            <ResponsiveField>
              <LabeledInput
                label="X"
                keyboardType="numeric"
                value={x}
                onChangeText={setX}
              />
            </ResponsiveField>
            <ResponsiveField>
              <LabeledInput
                label={space === "viewer" ? "Y (Höhe)" : "Y"}
                keyboardType="numeric"
                value={y}
                onChangeText={setY}
              />
            </ResponsiveField>
            <ResponsiveField>
              <LabeledInput
                label={space === "viewer" ? "Z" : "Z (Höhe)"}
                keyboardType="numeric"
                value={z}
                onChangeText={setZ}
              />
            </ResponsiveField>
          </ResponsiveRow>
          <TextLine>
            Lokal
            {placement.relativeTo
              ? ` (relativ zu #${placement.relativeTo})`
              : ""}
            : {formatPlacementCoordinate(placement.x)},{" "}
            {formatPlacementCoordinate(placement.y)},{" "}
            {formatPlacementCoordinate(placement.z)}
          </TextLine>
          <Button variant="default" onClick={applyMove}>
            Position übernehmen
          </Button>
        </InfoSection>
      ) : (
        <EmptyBlock title="Keine editierbare Platzierung">
          Produkt mit IFCLOCALPLACEMENT → IFCAXIS2PLACEMENT3D →
          IFCCARTESIANPOINT auswählen, um die Position zu bearbeiten.
        </EmptyBlock>
      )}

      <InfoSection title="Abmessungen">
        <ResponsiveRow>
          <ResponsiveField>
            <DropdownField
              label="Profil"
              options={[
                { label: "Rechteck", value: "rectangle" },
                { label: "Zylinder", value: "cylinder" },
              ]}
              value={profile}
              onChange={(value) => setProfile(value as NativeBodyProfile)}
            />
          </ResponsiveField>
          <ResponsiveField>
            <LabeledInput
              label={profile === "cylinder" ? "Durchmesser X" : "Breite X"}
              keyboardType="numeric"
              value={width}
              onChangeText={setWidth}
            />
          </ResponsiveField>
          <ResponsiveField>
            <LabeledInput
              label={profile === "cylinder" ? "Durchmesser Y" : "Tiefe Y"}
              keyboardType="numeric"
              value={depth}
              onChangeText={setDepth}
            />
          </ResponsiveField>
          <ResponsiveField>
            <LabeledInput
              label="Höhe Z"
              keyboardType="numeric"
              value={height}
              onChangeText={setHeight}
            />
          </ResponsiveField>
        </ResponsiveRow>
        {body.message ? <TextLine>{body.message}</TextLine> : null}
        <Button
          disabled={!body.canAssign}
          variant="default"
          onClick={() => onAssignBodyToSelected(bodyDraft)}
        >
          {body.hasRepresentation
            ? "Geometrie aktualisieren"
            : "Geometrie zuweisen"}
        </Button>
      </InfoSection>

      <CollapsibleSection
        title="IFC-Referenzen"
        meta={`Produkt #${selectedId} ${entity.type}`}
      >
        {placement ? (
          <>
            <ReferenceIdRow
              document={document}
              id={placement.placementId}
              label="Placement"
              onSelectEntity={onSelectEntity}
            />
            <ReferenceIdRow
              document={document}
              id={placement.axisPlacementId}
              label="Axis"
              onSelectEntity={onSelectEntity}
            />
            <ReferenceIdRow
              document={document}
              id={placement.pointId}
              label="Point"
              onSelectEntity={onSelectEntity}
            />
            <ReferenceIdRow
              document={document}
              id={placement.relativeTo}
              label="Relativ zu"
              onSelectEntity={onSelectEntity}
            />
          </>
        ) : (
          <ReferenceIdRow
            document={document}
            label="Placement"
            onSelectEntity={onSelectEntity}
          />
        )}
        <ReferenceIdRow
          document={document}
          id={body.shapeId}
          label="Shape"
          onSelectEntity={onSelectEntity}
        />
        <ReferenceIdRow
          document={document}
          id={body.bodyRepresentationId}
          label="Body"
          onSelectEntity={onSelectEntity}
        />
        <ReferenceIdRow
          document={document}
          id={body.solidId}
          label="Solid"
          onSelectEntity={onSelectEntity}
        />
        <ReferenceIdRow
          document={document}
          detail={body.profileType ?? undefined}
          id={body.profileId}
          label="Profil"
          onSelectEntity={onSelectEntity}
        />
      </CollapsibleSection>
    </PanelShell>
  );
}

function ReferenceIdRow({
  detail,
  document,
  id,
  label,
  onSelectEntity,
}: {
  detail?: string;
  document: NativeIfcDocument;
  id?: number;
  label: string;
  onSelectEntity(entityId: number): void;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-md bg-muted/30 px-2.5 py-1.5">
      <span className="text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {id ? (
        <span className="flex min-w-0 items-center gap-1.5">
          {detail ? (
            <span className="truncate text-xs text-muted-foreground">
              {detail}
            </span>
          ) : null}
          <EntityChip document={document} id={id} onSelect={onSelectEntity} />
        </span>
      ) : (
        <span className="font-mono text-xs text-muted-foreground">$</span>
      )}
    </div>
  );
}

function formatEditableNumber(value: number | undefined, fallback: string) {
  return value === undefined || !Number.isFinite(value)
    ? fallback
    : String(value);
}
