import {
  Box,
  ClipboardPaste,
  Combine,
  Crosshair,
  Scissors,
  Target,
  Trash2,
} from "lucide-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    getNativeBodyRepresentation,
    getNativeLengthUnitScale,
    getNativePlacement,
    type NativeBodyProfile,
    type NativeIfcDocument,
} from "@/ifc/nativeDocument";

import { ENTITY_TYPES } from "./constants";
import type { BodyElementDraft, CoordinateClipboard } from "./types";
import type {
  ViewerCutPlaneMode,
  ViewerCutPlaneState,
} from "../that-open-viewer.types";
import {
  Badge,
  Button,
  CheckboxField,
  CollapsibleSection,
  DropdownField,
  InlineAlert,
  LabeledInput,
  PanelHeader,
  PanelShell,
  parseDecimalInput,
  SegmentedControl,
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

const PLACEMENT_MODE_OPTIONS = [
  { label: "Welt", value: "world" },
  { label: "Relativ zum Parent", value: "parent" },
];

const CUT_PLANE_AXIS_OPTIONS = [
  { label: "X", value: "x" },
  { label: "Y (Höhe)", value: "y" },
  { label: "Z", value: "z" },
];

type BuilderTool = "combine" | "remove" | "split";

export function BuilderPanel({
  coordinateClipboard,
  cutPlane,
  document,
  selectedId,
  selectedIds,
  onAddBodyElement,
  onCombineSelected,
  onCutPlaneActiveChange,
  onCutPlaneChange,
  onCutPlaneModeChange,
  onCutPlaneReset,
  onLoadSystemCoordinates,
  onOrthogonalSpawnChange,
  onRemoveBodyFromSelected,
  onSplitSelected,
  onSurfacePlacementChange,
  orthogonalSpawn,
  surfacePlacementActive,
}: {
  coordinateClipboard: CoordinateClipboard | null;
  cutPlane: ViewerCutPlaneState;
  document: NativeIfcDocument;
  selectedId: number;
  selectedIds: number[];
  onAddBodyElement(options: BodyElementDraft): void;
  onCombineSelected(name: string, removeSources: boolean): void;
  onCutPlaneActiveChange(active: boolean): void;
  onCutPlaneChange(
    change: Pick<ViewerCutPlaneState, "normal" | "position">,
  ): void;
  onCutPlaneModeChange(mode: ViewerCutPlaneMode): void;
  onCutPlaneReset(): void;
  onLoadSystemCoordinates(): Promise<CoordinateClipboard | undefined>;
  /** Neue Körper (Rotary/„Auf Fläche setzen“) orthogonal zur Fläche drehen. */
  onOrthogonalSpawnChange(enabled: boolean): void;
  onRemoveBodyFromSelected(): void;
  onSplitSelected(): void;
  /** Platzierungsmodus im Viewer starten (Entwurf) bzw. beenden (null). */
  onSurfacePlacementChange(draft: BodyElementDraft | null): void;
  orthogonalSpawn: boolean;
  surfacePlacementActive: boolean;
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
  const [planeX, setPlaneX] = useState("0");
  const [planeY, setPlaneY] = useState("0");
  const [planeZ, setPlaneZ] = useState("0");
  const [normalX, setNormalX] = useState("0");
  const [normalY, setNormalY] = useState("1");
  const [normalZ, setNormalZ] = useState("0");
  const [planeBaseAxis, setPlaneBaseAxis] = useState("y");
  const [planeRotationAxis, setPlaneRotationAxis] = useState("x");
  const [planeAngle, setPlaneAngle] = useState("0");
  const [combinedName, setCombinedName] = useState("Kombiniertes Teil");
  const [keepCombineSources, setKeepCombineSources] = useState(false);
  const [tool, setTool] = useState<BuilderTool>("split");
  const selectedEntity = document.entityById.get(selectedId);
  const selectedParentId = findHierarchyParentId(document, selectedId);
  const selectedBody = getNativeBodyRepresentation(document, selectedId);
  const unitScale = getNativeLengthUnitScale(document);
  const splitSupported =
    selectedBody.hasRepresentation &&
    Boolean(getNativePlacement(document, selectedId));
  const combineSupported =
    selectedIds.length >= 2 &&
    selectedIds.every(
      (id) =>
        getNativeBodyRepresentation(document, id).hasRepresentation &&
        Boolean(getNativePlacement(document, id)),
    );
  const roundProfile = ROUND_PROFILES.has(bodyProfile);

  useEffect(() => {
    if (cutPlane.position) {
      setPlaneX(formatCutPlaneNumber(cutPlane.position.x));
      setPlaneY(formatCutPlaneNumber(cutPlane.position.y));
      setPlaneZ(formatCutPlaneNumber(cutPlane.position.z));
    }
    setNormalX(formatCutPlaneNumber(cutPlane.normal.x));
    setNormalY(formatCutPlaneNumber(cutPlane.normal.y));
    setNormalZ(formatCutPlaneNumber(cutPlane.normal.z));
  }, [
    cutPlane.normal.x,
    cutPlane.normal.y,
    cutPlane.normal.z,
    cutPlane.position?.x,
    cutPlane.position?.y,
    cutPlane.position?.z,
  ]);

  const applyNumericCutPlane = () => {
    onCutPlaneChange({
      normal: normalizeCutPlaneVector({
        x: readCutPlaneNumber(normalX),
        y: readCutPlaneNumber(normalY),
        z: readCutPlaneNumber(normalZ),
      }),
      position: {
        x: readCutPlaneNumber(planeX),
        y: readCutPlaneNumber(planeY),
        z: readCutPlaneNumber(planeZ),
      },
    });
  };

  const applyAxisAngleCutPlane = () => {
    const normal = axisAngleCutPlaneNormal(
      planeBaseAxis,
      planeRotationAxis,
      readCutPlaneNumber(planeAngle),
    );
    setNormalX(formatCutPlaneNumber(normal.x));
    setNormalY(formatCutPlaneNumber(normal.y));
    setNormalZ(formatCutPlaneNumber(normal.z));
    onCutPlaneChange({
      normal,
      position: {
        x: readCutPlaneNumber(planeX),
        y: readCutPlaneNumber(planeY),
        z: readCutPlaneNumber(planeZ),
      },
    });
  };

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

  // Solange "Auf Fläche setzen" läuft, folgt der Ghost im Viewer den
  // Panel-Feldern (Profil/Maße/Name/Klasse) live.
  useEffect(() => {
    if (!surfacePlacementActive) {
      return;
    }
    onSurfacePlacementChange({
      depth: bodyDepth,
      height: bodyHeight,
      name: bodyName,
      placementMode: "world",
      profile: bodyProfile,
      tag: bodyTag,
      type: bodyType,
      width: bodyWidth,
      x: bodyX,
      y: bodyY,
      z: bodyZ,
    });
    // onSurfacePlacementChange ist ein stabiler Workspace-Handler.
  }, [
    bodyDepth,
    bodyHeight,
    bodyName,
    bodyProfile,
    bodyTag,
    bodyType,
    bodyWidth,
    surfacePlacementActive,
  ]);

  const splitBlockedReason = !selectedBody.hasRepresentation
    ? `#${selectedId} hat keine Körper-Geometrie`
    : !splitSupported
      ? "Auswahl hat keine Produktplatzierung"
      : !cutPlane.active || !cutPlane.position
        ? "Erst Schnittebene einblenden"
        : undefined;

  return (
    <PanelShell scroll>
      <PanelHeader
        title="Körper-Builder"
        meta={
          <>
            <span
              title={`Ziel: #${selectedId}${selectedEntity ? ` ${selectedEntity.type}` : ""}${selectedEntity?.name ? ` „${selectedEntity.name}“` : ""}`}
            >
              <Badge
                tone={selectedBody.hasRepresentation ? "success" : "neutral"}
              >
                #{selectedId}{" "}
                {selectedEntity ? shortType(selectedEntity.type) : "Auswahl"}
              </Badge>
            </span>
            <span
              title={`Modelleinheit: ${describeLengthUnit(unitScale)} · Eingaben in Meter`}
            >
              <Badge>{shortLengthUnit(unitScale)}</Badge>
            </span>
          </>
        }
      />

      <Section title="Element">
        <FieldGrid min="8rem">
          <DropdownField
            label="Klasse"
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
        </FieldGrid>
      </Section>

      <Section title="Geometrie · m">
        <FieldGrid min="6.5rem">
          <DropdownField
            label="Profil"
            options={BODY_PROFILE_OPTIONS}
            value={bodyProfile}
            onChange={(value) => setBodyProfile(value as NativeBodyProfile)}
          />
          <LabeledInput
            label={roundProfile ? "Ø X" : "Breite X"}
            keyboardType="numeric"
            value={bodyWidth}
            onChangeText={setBodyWidth}
          />
          <LabeledInput
            label={roundProfile ? "Ø Z" : "Tiefe Z"}
            keyboardType="numeric"
            value={bodyDepth}
            onChangeText={setBodyDepth}
          />
          <LabeledInput
            label="Höhe Y"
            keyboardType="numeric"
            value={bodyHeight}
            onChangeText={setBodyHeight}
          />
        </FieldGrid>
      </Section>

      <Section
        title="Position · m"
        aside={
          <Button
            size="xs"
            title={
              coordinateClipboard
                ? `Pick übernehmen: ${describeCoordinateClipboard(coordinateClipboard)}`
                : "Kein Viewer-Pick gemerkt · Koordinaten aus dem System-Clipboard lesen"
            }
            variant={coordinateClipboard ? "secondary" : "ghost"}
            onClick={() => void loadCoordinateClipboard()}
          >
            <ClipboardPaste aria-hidden />
            {coordinateClipboard ? "Pick übernehmen" : "Aus Clipboard"}
          </Button>
        }
      >
        <div className="grid min-w-0 grid-cols-3 gap-2">
          <LabeledInput
            label="X"
            keyboardType="numeric"
            value={bodyX}
            onChangeText={setBodyX}
          />
          <LabeledInput
            label="Y (Höhe)"
            keyboardType="numeric"
            value={bodyY}
            onChangeText={setBodyY}
          />
          <LabeledInput
            label="Z"
            keyboardType="numeric"
            value={bodyZ}
            onChangeText={setBodyZ}
          />
        </div>
        <SegmentedControl
          options={PLACEMENT_MODE_OPTIONS}
          value={bodyPlacementMode}
          onChange={(value) =>
            setBodyPlacementMode(value as "parent" | "world")
          }
        />
      </Section>

      <Section
        title="Erstellen"
        aside={
          <label
            className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            title="Höhe entlang der Flächennormale, Grundfläche auf der Fläche – gilt für „Auf Fläche“ und Rechtsklick „Hier hinzufügen“"
          >
            <Switch
              checked={orthogonalSpawn}
              size="sm"
              onCheckedChange={(checked) => onOrthogonalSpawnChange(checked)}
            />
            Orthogonal zur Fläche
          </label>
        }
      >
        <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-1.5">
          <Button
            className="w-full min-w-0"
            title={`Körper als Kind von #${selectedId} erstellen`}
            variant="default"
            onClick={() =>
              onAddBodyElement({ ...bodyDraft, parentId: selectedId })
            }
          >
            <Box aria-hidden />
            <span className="truncate">Als Kind</span>
          </Button>
          <Button
            className="w-full min-w-0"
            disabled={selectedParentId == null}
            title={
              selectedParentId == null
                ? "Auswahl hat keinen Parent"
                : `Körper am Parent #${selectedParentId} der Auswahl erstellen`
            }
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
            <Box aria-hidden />
            <span className="truncate">Am Parent</span>
          </Button>
          <Button
            className="w-full min-w-0"
            title={
              surfacePlacementActive
                ? "Platzierungsmodus beenden (Esc)"
                : "Fläche im 3D-Viewer anklicken, Körper wird per Raycast dort gesetzt"
            }
            variant={surfacePlacementActive ? "secondary" : "default"}
            onClick={() =>
              onSurfacePlacementChange(surfacePlacementActive ? null : bodyDraft)
            }
          >
            <Target aria-hidden />
            <span className="truncate">
              {surfacePlacementActive ? "Beenden · Esc" : "Auf Fläche"}
            </span>
          </Button>
        </div>
        {surfacePlacementActive ? (
          <InlineAlert>Fläche im Viewer anklicken.</InlineAlert>
        ) : null}
        {selectedParentId == null ? (
          <InlineAlert tone="warning">Auswahl hat keinen Parent.</InlineAlert>
        ) : null}
      </Section>

      <Tabs
        className="min-w-0 shrink-0 gap-2 border-t border-border/60 pt-2.5"
        value={tool}
        onValueChange={(value) => setTool(value as BuilderTool)}
      >
        <TabsList className="w-full">
          <TabsTrigger className="text-xs" value="split">
            <Scissors aria-hidden className="size-3.5" />
            Teilen
          </TabsTrigger>
          <TabsTrigger className="text-xs" value="combine">
            <Combine aria-hidden className="size-3.5" />
            Kombinieren
          </TabsTrigger>
          <TabsTrigger className="text-xs" value="remove">
            <Trash2 aria-hidden className="size-3.5" />
            Entfernen
          </TabsTrigger>
        </TabsList>

        <TabsContent className="grid min-w-0 gap-2" value="split">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <Button
              className="min-w-0 flex-1 basis-28"
              disabled={!splitSupported}
              title={
                cutPlane.active
                  ? "Schnittebene ausblenden"
                  : "Schnittebene im Viewer einblenden"
              }
              variant={cutPlane.active ? "default" : "outline"}
              onClick={() => onCutPlaneActiveChange(!cutPlane.active)}
            >
              <Scissors aria-hidden />
              <span className="truncate">Schnittebene</span>
            </Button>
            <Button
              title="Ebene verschieben (W)"
              variant={
                cutPlane.active && cutPlane.mode === "translate"
                  ? "secondary"
                  : "ghost"
              }
              onClick={() => onCutPlaneModeChange("translate")}
            >
              Verschieben
            </Button>
            <Button
              title="Ebene rotieren (R)"
              variant={
                cutPlane.active && cutPlane.mode === "rotate"
                  ? "secondary"
                  : "ghost"
              }
              onClick={() => onCutPlaneModeChange("rotate")}
            >
              Rotieren
            </Button>
            <Button
              disabled={!splitSupported}
              size="icon-sm"
              title="Ebene auf Auswahl zentrieren"
              variant="outline"
              onClick={onCutPlaneReset}
            >
              <Crosshair aria-hidden />
            </Button>
          </div>

          <CollapsibleSection
            title="Ebene numerisch"
            meta={`P ${planeX}; ${planeY}; ${planeZ} · N ${normalX}; ${normalY}; ${normalZ}`}
          >
            <div className="grid min-w-0 grid-cols-3 gap-2">
              <LabeledInput
                label="Punkt X"
                keyboardType="numeric"
                value={planeX}
                onChangeText={setPlaneX}
              />
              <LabeledInput
                label="Punkt Y"
                keyboardType="numeric"
                value={planeY}
                onChangeText={setPlaneY}
              />
              <LabeledInput
                label="Punkt Z"
                keyboardType="numeric"
                value={planeZ}
                onChangeText={setPlaneZ}
              />
              <LabeledInput
                label="Normale X"
                keyboardType="numeric"
                value={normalX}
                onChangeText={setNormalX}
              />
              <LabeledInput
                label="Normale Y"
                keyboardType="numeric"
                value={normalY}
                onChangeText={setNormalY}
              />
              <LabeledInput
                label="Normale Z"
                keyboardType="numeric"
                value={normalZ}
                onChangeText={setNormalZ}
              />
            </div>
            <Button variant="outline" onClick={applyNumericCutPlane}>
              Punkt + Normale setzen
            </Button>
            <div className="grid min-w-0 grid-cols-3 gap-2 border-t border-border/60 pt-2">
              <DropdownField
                label="Ausgangsnormale"
                options={CUT_PLANE_AXIS_OPTIONS}
                value={planeBaseAxis}
                onChange={setPlaneBaseAxis}
              />
              <DropdownField
                label="Drehachse"
                options={CUT_PLANE_AXIS_OPTIONS}
                value={planeRotationAxis}
                onChange={setPlaneRotationAxis}
              />
              <LabeledInput
                label="Winkel °"
                keyboardType="numeric"
                value={planeAngle}
                onChangeText={setPlaneAngle}
              />
            </div>
            <Button variant="outline" onClick={applyAxisAngleCutPlane}>
              Achse + Winkel setzen
            </Button>
          </CollapsibleSection>

          {selectedBody.hasRepresentation && !splitSupported ? (
            <InlineAlert tone="warning">
              Auswahl hat keine Produktplatzierung.
            </InlineAlert>
          ) : null}
          {!selectedBody.hasRepresentation ? (
            <InlineAlert tone="warning">
              #{selectedId} hat keine Körper-Geometrie.
            </InlineAlert>
          ) : null}
          <Button
            disabled={splitBlockedReason !== undefined}
            title={
              splitBlockedReason ??
              "Zwei eigenständige IFC-Objekte beidseits der Ebene erzeugen"
            }
            variant="default"
            onClick={onSplitSelected}
          >
            <Scissors aria-hidden />
            An Ebene teilen
          </Button>
        </TabsContent>

        <TabsContent className="grid min-w-0 gap-2" value="combine">
          <LabeledInput
            label="Name des neuen Teils"
            value={combinedName}
            onChangeText={setCombinedName}
          />
          <div title="Aus: Quellobjekte werden nach dem Kombinieren entfernt (Undo möglich)">
            <CheckboxField
              checked={keepCombineSources}
              label="Quellobjekte behalten"
              onCheckedChange={setKeepCombineSources}
            />
          </div>
          {!combineSupported ? (
            <p className="text-xs text-muted-foreground">
              Mind. 2 platzierte Körper wählen (Strg-/Umschalt-Klick).
            </p>
          ) : null}
          <Button
            disabled={!combineSupported}
            title={
              combineSupported
                ? `${selectedIds.length} Geometrien zu einem Teil mit Mehrkörper-Geometrie kombinieren`
                : "Mindestens zwei platzierte Objekte mit Geometrie auswählen"
            }
            variant="default"
            onClick={() =>
              onCombineSelected(combinedName, !keepCombineSources)
            }
          >
            <Combine aria-hidden />
            {selectedIds.length >= 2
              ? `${selectedIds.length} Körper kombinieren`
              : "Kombinieren"}
          </Button>
        </TabsContent>

        <TabsContent className="grid min-w-0 gap-2" value="remove">
          {!selectedBody.hasRepresentation ? (
            <InlineAlert tone="warning">
              #{selectedId} hat keine Körper-Geometrie.
            </InlineAlert>
          ) : null}
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
            <Trash2 aria-hidden />
            <span className="truncate">Körper-Geometrie entfernen</span>
          </Button>
        </TabsContent>
      </Tabs>
    </PanelShell>
  );
}

function Section({
  aside,
  children,
  title,
}: {
  aside?: ReactNode;
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="grid min-w-0 shrink-0 gap-1.5">
      <div className="flex min-h-6 min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <h3 className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function FieldGrid({ children, min }: { children: ReactNode; min: string }) {
  return (
    <div
      className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(var(--field-min),1fr))] gap-2"
      style={{ "--field-min": min } as CSSProperties}
    >
      {children}
    </div>
  );
}

function shortLengthUnit(metersPerUnit: number) {
  if (Math.abs(metersPerUnit - 1) < 1e-9) {
    return "m";
  }
  if (Math.abs(metersPerUnit - 0.001) < 1e-9) {
    return "mm";
  }
  if (Math.abs(metersPerUnit - 0.01) < 1e-9) {
    return "cm";
  }
  if (Math.abs(metersPerUnit - 0.3048) < 1e-6) {
    return "ft";
  }
  return `×${metersPerUnit}`;
}

function describeCoordinateClipboard(clipboard: CoordinateClipboard) {
  const placement = coordinateClipboardToBodyPlacement(clipboard);
  const source =
    clipboard.source === "thatopen"
      ? `${clipboard.fileName ?? "3D-Viewer"}${clipboard.entityId ? ` / #${clipboard.entityId}` : ""}`
      : "System-Clipboard";
  return `X ${placement.x}, Y ${placement.y}, Z ${placement.z} (${source}, ${clipboard.copiedAt})`;
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
function coordinateClipboardToBodyPlacement(clipboard: CoordinateClipboard) {
  return {
    x: formatBodyCoordinate(readCoordinateNumber(clipboard.x)),
    y: formatBodyCoordinate(readCoordinateNumber(clipboard.y)),
    z: formatBodyCoordinate(readCoordinateNumber(clipboard.z)),
  };
}

function readCoordinateNumber(value: string) {
  return parseDecimalInput(value);
}

function readCutPlaneNumber(value: string) {
  return readCoordinateNumber(value);
}

function formatCutPlaneNumber(value: number) {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function normalizeCutPlaneVector(vector: {
  x: number;
  y: number;
  z: number;
}) {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (!Number.isFinite(length) || length < 1e-9) {
    return { x: 0, y: 1, z: 0 };
  }
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

function axisAngleCutPlaneNormal(
  baseAxis: string,
  rotationAxis: string,
  degrees: number,
) {
  const base = axisVector(baseAxis);
  const axis = axisVector(rotationAxis);
  const radians = (degrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const dot = base.x * axis.x + base.y * axis.y + base.z * axis.z;
  const cross = {
    x: axis.y * base.z - axis.z * base.y,
    y: axis.z * base.x - axis.x * base.z,
    z: axis.x * base.y - axis.y * base.x,
  };
  return normalizeCutPlaneVector({
    x:
      base.x * cosine +
      cross.x * sine +
      axis.x * dot * (1 - cosine),
    y:
      base.y * cosine +
      cross.y * sine +
      axis.y * dot * (1 - cosine),
    z:
      base.z * cosine +
      cross.z * sine +
      axis.z * dot * (1 - cosine),
  });
}

function axisVector(axis: string) {
  if (axis === "x") {
    return { x: 1, y: 0, z: 0 };
  }
  if (axis === "z") {
    return { x: 0, y: 0, z: 1 };
  }
  return { x: 0, y: 1, z: 0 };
}

function formatBodyCoordinate(value: number) {
  const rounded = Math.round(value * 1000) / 1000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}
