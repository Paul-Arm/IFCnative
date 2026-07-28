/**
 * Strichzeichnungs-Icons für das Ribbon. Bewusst eigener, minimaler Satz:
 * Der ifc-lite-Viewer nutzt `lucide-react` + eigene Icon-Pakete, die hier
 * nicht installiert sind — die Icons sind deshalb nachgebaut, nicht kopiert.
 * Alle Pfade zeichnen mit `currentColor`, damit Theme-Wechsel greifen.
 */
import type { ComponentType } from "react";

export interface IconProps {
  readonly className?: string;
}

export type IconComponent = ComponentType<IconProps>;

function icon(name: string, ...paths: readonly string[]): IconComponent {
  function Icon({ className }: IconProps) {
    return (
      <svg
        className={className}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        {paths.map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    );
  }
  Icon.displayName = name;
  return Icon;
}

export const IconChevronDown = icon("ChevronDown", "M6 9l6 6 6-6");
export const IconChevronUp = icon("ChevronUp", "M6 15l6-6 6 6");

export const IconOpen = icon(
  "Open",
  "M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2.5h7A1.5 1.5 0 0 1 19 9v8.5A1.5 1.5 0 0 1 17.5 19h-13A1.5 1.5 0 0 1 3 17.5z",
);
export const IconExport = icon(
  "Export",
  "M12 3v11",
  "M8 7l4-4 4 4",
  "M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4",
);
export const IconUndo = icon("Undo", "M4 8h10a5 5 0 0 1 0 10H8", "M8 4L4 8l4 4");
export const IconRedo = icon(
  "Redo",
  "M20 8H10a5 5 0 0 0 0 10h6",
  "M16 4l4 4-4 4",
);
export const IconSave = icon(
  "Save",
  "M5 4h11l3 3v13H5z",
  "M8 4v5h7V4",
  "M8 13h8v7H8z",
);
export const IconSun = icon(
  "Sun",
  "M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12z",
  "M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19",
);
export const IconMoon = icon(
  "Moon",
  "M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z",
);
export const IconZoom = icon(
  "Zoom",
  "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z",
  "M16.5 16.5L21 21",
  "M8 11h6M11 8v6",
);
export const IconLayout = icon("Layout", "M3 4h18v16H3z", "M9 4v16", "M9 12h12");
export const IconWorkspace = icon(
  "Workspace",
  "M3 5h8v6H3z",
  "M13 5h8v14h-8z",
  "M3 13h8v6H3z",
);
export const IconStructure = icon(
  "Structure",
  "M5 4v15",
  "M5 8h6M5 13h9M5 18h5",
);
export const IconCube = icon(
  "Cube",
  "M12 3l8 4.5v9L12 21l-8-4.5v-9z",
  "M4 7.5l8 4.5 8-4.5M12 12v9",
);
export const IconInspector = icon(
  "Inspector",
  "M4 5h16v14H4z",
  "M4 9h16",
  "M8 13h8M8 16h5",
);
export const IconGraph = icon(
  "Graph",
  "M3 4h6v5H3z",
  "M15 15h6v5h-6z",
  "M9 6.5h3a3 3 0 0 1 3 3v5",
);
export const IconLens = icon(
  "Lens",
  "M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14z",
  "M12 9v6M9 12h6",
);
export const IconNotes = icon(
  "Notes",
  "M6 3h9l4 4v14H6z",
  "M15 3v4h4",
  "M9 12h7M9 16h5",
);
export const IconRecents = icon(
  "Recents",
  "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z",
  "M12 8v4.5l3 2",
);
export const IconTable = icon(
  "Table",
  "M3 5h18v14H3z",
  "M3 10h18M9 10v9M15 10v9",
);
export const IconCatalog = icon(
  "Catalog",
  "M5 4h13a1 1 0 0 1 1 1v15H6a1 1 0 0 1-1-1z",
  "M6 16h13",
  "M9 8h7",
);
export const IconBuilder = icon(
  "Builder",
  "M3 5h18v5H3z",
  "M3 14h8v5H3z",
  "M13 14h8v5h-8z",
);
export const IconDrawing = icon(
  "Drawing",
  "M4 19l3-1 10-10-2-2L5 16z",
  "M14 5l2 2",
  "M4 21h16",
);
export const IconHub = icon(
  "Hub",
  "M7.5 18a4 4 0 0 1 .3-8 5.5 5.5 0 0 1 10.4-1A3.8 3.8 0 0 1 17 18z",
);
export const IconCheck = icon(
  "Check",
  "M12 3l7 3v6c0 4-3 6.6-7 9-4-2.4-7-5-7-9V6z",
  "M9 12l2 2 4-4",
);
export const IconIds = icon(
  "Ids",
  "M9 4h6v3H9z",
  "M9 5.5H6a1 1 0 0 0-1 1V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6.5a1 1 0 0 0-1-1h-3",
  "M9 14l2 2 4-4",
);

// — Viewer-Werkzeuge (M10, schwebende Toolbar) —
export const IconCursor = icon("Cursor", "M6 3l7 16 2-6 6-2z");
export const IconMoveTool = icon(
  "MoveTool",
  "M12 3v18M3 12h18",
  "M9.5 5.5L12 3l2.5 2.5M9.5 18.5L12 21l2.5-2.5",
  "M5.5 9.5L3 12l2.5 2.5M18.5 9.5L21 12l-2.5 2.5",
);
export const IconRotateTool = icon(
  "RotateTool",
  "M19.5 12a7.5 7.5 0 1 1-2.2-5.3",
  "M19.5 3.5v3.4h-3.4",
);
export const IconScaleTool = icon(
  "ScaleTool",
  "M13 4h7v7",
  "M4 13h7v7H4z",
  "M11 13l7-7",
);
export const IconCrosshair = icon(
  "Crosshair",
  "M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14z",
  "M12 2v4M12 18v4M2 12h4M18 12h4",
);
export const IconKnife = icon(
  "Knife",
  "M4 19L15 8l2.5 2.5L8 20l-4 1z",
  "M15 8l2-2a2 2 0 0 1 2.5 2.5l-2 2",
);
export const IconEyeOff = icon(
  "EyeOff",
  "M3 3l18 18",
  "M10.6 5.1A9.8 9.8 0 0 1 12 5c5 0 9 4.5 10 7- .4 1-1.3 2.4-2.6 3.7M6.6 6.6C4.3 8 2.7 10.1 2 12c1 2.5 5 7 10 7 1.4 0 2.7-.3 3.9-.9",
  "M9.9 9.9a3 3 0 0 0 4.2 4.2",
);
export const IconEyeAll = icon(
  "EyeAll",
  "M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12z",
  "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
);
export const IconIsolate = icon(
  "Isolate",
  "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  "M3 3h4M17 3h4M3 21h4M17 21h4M3 3v4M21 3v4M3 17v4M21 17v4",
);
export const IconXray = icon(
  "Xray",
  "M12 3l8 4.5v9L12 21l-8-4.5v-9z",
  "M4 7.5l8 4.5 8-4.5",
  "M12 12v9",
  "M8 5.2l8 4.6M8 18.8v-4.6",
);
export const IconGridLines = icon(
  "GridLines",
  "M3 3h18v18H3z",
  "M3 9h18M3 15h18M9 3v18M15 3v18",
);
export const IconRefresh = icon(
  "Refresh",
  "M20 12a8 8 0 1 1-2.5-5.8",
  "M20 3.5V7h-3.5",
);
export const IconClipBox = icon(
  "ClipBox",
  "M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4",
  "M9 9h6v6H9z",
);
