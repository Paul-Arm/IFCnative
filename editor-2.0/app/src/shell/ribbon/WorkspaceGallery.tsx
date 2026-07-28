/**
 * Workspace-Galerie im Office-Stil: jede Kachel zeigt eine Miniatur des
 * Layouts (aus dem Mosaic-Baum abgeleitet) über dem Namen; die aktive
 * Kachel ist markiert. Auswahl = `useUi.switchWorkspace`.
 */
import type { MosaicNode } from "react-mosaic-component";
import type { PaneId } from "../../panes/ids";
import { BUILTIN_WORKSPACES, BUILTIN_WORKSPACE_NAMES } from "../../panes/workspaces";
import { useUi } from "../../store/ui";

/** Miniaturansicht: Splits werden zu geschachtelten Flex-Kästchen. */
function LayoutPreview({
  node,
  grow,
}: {
  node: MosaicNode<PaneId>;
  grow: number;
}) {
  if (typeof node === "string" || node.type === "tabs") {
    return <span className="ribbon-gallery-cell" style={{ flexGrow: grow }} />;
  }
  return (
    <span
      className="ribbon-gallery-split"
      style={{
        flexGrow: grow,
        flexDirection: node.direction === "row" ? "row" : "column",
      }}
    >
      {node.children.map((child, index) => (
        <LayoutPreview
          key={index}
          node={child}
          grow={node.splitPercentages?.[index] ?? 50}
        />
      ))}
    </span>
  );
}

export function WorkspaceGallery() {
  const workspaceName = useUi((s) => s.workspaceName);
  const customWorkspaces = useUi((s) => s.customWorkspaces);
  const switchWorkspace = useUi((s) => s.switchWorkspace);

  const entries: ReadonlyArray<{
    name: string;
    layout: MosaicNode<PaneId>;
    custom: boolean;
  }> = [
    ...BUILTIN_WORKSPACE_NAMES.map((name) => ({
      name,
      layout: BUILTIN_WORKSPACES[name],
      custom: false,
    })),
    ...customWorkspaces.map((entry) => ({
      name: entry.name,
      layout: entry.layout,
      custom: true,
    })),
  ];

  return (
    <div
      className="ribbon-gallery"
      role="listbox"
      aria-label="Arbeitsbereich wählen"
    >
      {entries.map((entry) => {
        const selected = entry.name === workspaceName;
        return (
          <button
            key={`${entry.custom ? "custom" : "builtin"}:${entry.name}`}
            type="button"
            role="option"
            aria-selected={selected}
            data-active={selected ? "true" : undefined}
            className="ribbon-gallery-item"
            title={
              entry.custom
                ? `Eigener Arbeitsbereich „${entry.name}“`
                : `Arbeitsbereich „${entry.name}“`
            }
            onClick={(event) => {
              event.currentTarget.blur();
              switchWorkspace(entry.name);
            }}
          >
            <span className="ribbon-gallery-preview">
              <LayoutPreview node={entry.layout} grow={100} />
            </span>
            <span className="ribbon-gallery-name">{entry.name}</span>
          </button>
        );
      })}
    </div>
  );
}
