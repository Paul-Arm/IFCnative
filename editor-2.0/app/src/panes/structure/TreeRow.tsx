/**
 * Eine Baumzeile: Chevron, Name, abgeblendeter Typ/Detail-Teil.
 * Layout per Inline-Style, weil `.row-item` aus global.css ein Blockelement ist.
 */
import { memo, type CSSProperties, type MouseEvent } from "react";
import { ROW_HEIGHT, type TreeItem } from "./treeModel";

const ROW_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  height: ROW_HEIGHT,
  lineHeight: `${ROW_HEIGHT}px`,
  padding: 0,
  userSelect: "none",
};

const CHEVRON_STYLE: CSSProperties = {
  width: 14,
  flex: "0 0 14px",
  textAlign: "center",
  fontSize: "0.625rem",
  color: "var(--text-dim)",
  cursor: "pointer",
};

export interface TreeRowProps {
  item: TreeItem;
  index: number;
  row: number;
  selected: boolean;
  highlighted: boolean;
  expanded: boolean;
  onToggle(index: number): void;
  onActivate(event: MouseEvent, row: number, expressId: number): void;
  onFocus(expressId: number): void;
  /** Rechtsklick → eigenes Kontextmenü (M9), kein natives Menü. */
  onContext(event: MouseEvent, index: number): void;
}

function TreeRow({
  item,
  index,
  row,
  selected,
  highlighted,
  expanded,
  onToggle,
  onActivate,
  onFocus,
  onContext,
}: TreeRowProps) {
  const hasChildren = item.subtreeSize > 0;
  const label = item.name || "(ohne Namen)";

  return (
    <div
      className="row-item"
      data-selected={selected || undefined}
      title={`${item.type} ${label} (#${item.expressId})`}
      style={{
        ...ROW_STYLE,
        paddingLeft: 6 + item.depth * 14,
        paddingRight: 8,
      }}
      onClick={(event) => onActivate(event, row, item.expressId)}
      onDoubleClick={() => onFocus(item.expressId)}
      onContextMenu={(event) => onContext(event, index)}
    >
      <span
        style={CHEVRON_STYLE}
        onClick={(event) => {
          if (!hasChildren) return;
          event.stopPropagation();
          onToggle(index);
        }}
      >
        {hasChildren ? (expanded ? "▼" : "▶") : ""}
      </span>
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontWeight: highlighted ? 600 : 400,
          color: highlighted ? "var(--accent)" : undefined,
        }}
      >
        {label}
      </span>
      <span
        className="text-dim"
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontSize: "0.75rem",
        }}
      >
        {item.detail ? `${item.type} · ${item.detail}` : item.type}
      </span>
      <span
        className="text-dim mono"
        style={{ marginLeft: "auto", fontSize: "0.7rem", flex: "0 0 auto" }}
      >
        #{item.expressId}
      </span>
    </div>
  );
}

export default memo(TreeRow);
