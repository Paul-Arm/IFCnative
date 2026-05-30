import { cn } from "@/lib/utils";

import type { RelationshipFlowProps } from "./relationship-flow.types";

const DEPTH_VALUES = Array.from(
  { length: 26 },
  (_unused, depthValue) => depthValue,
);

export default function RelationshipFlow({
  capped,
  depth,
  edges,
  nodes,
  relationshipCount,
  relationshipOptions,
  relationshipTypeFilters,
  onClearPositions,
  onDepth,
  onRelationshipTypeFilters,
  onSelect,
  onToggleChildren,
  onTogglePin,
}: RelationshipFlowProps) {
  return (
    <div className="min-h-[430px] overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b p-2">
        <div className="min-w-40 flex-1 text-sm text-muted-foreground">
          {nodes.length} nodes - {relationshipCount} rels{" "}
          {capped ? "- capped" : ""}
        </div>
        <div className="flex flex-wrap gap-1">
          {DEPTH_VALUES.map((value) => (
            <button
              type="button"
              key={value}
              onClick={() => onDepth(value)}
              className={cn(
                "min-w-8 rounded-md border px-2 py-1 text-xs text-foreground hover:bg-muted",
                depth === value &&
                  "border-primary bg-primary text-primary-foreground",
              )}
            >
              {value}
            </button>
          ))}
          <button
            type="button"
            onClick={onClearPositions}
            className="rounded-md border px-2 py-1 text-xs text-foreground hover:bg-muted"
          >
            Auto
          </button>
        </div>
        <div className="flex max-w-full gap-1 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => onRelationshipTypeFilters([])}
            className={cn(
              "rounded-full border px-2 py-1 text-xs text-foreground hover:bg-muted",
              relationshipTypeFilters.length === 0 &&
                "border-primary bg-primary text-primary-foreground",
            )}
          >
            All rels
          </button>
          {relationshipOptions.map((option) => {
            const active = relationshipTypeFilters.includes(option.value);
            return (
              <button
                type="button"
                key={option.value}
                onClick={() => {
                  const next = active
                    ? relationshipTypeFilters.filter(
                        (value) => value !== option.value,
                      )
                    : [...relationshipTypeFilters, option.value];
                  onRelationshipTypeFilters(next);
                }}
                className={cn(
                  "rounded-full border px-2 py-1 text-xs text-foreground hover:bg-muted",
                  active && "border-primary bg-primary text-primary-foreground",
                )}
              >
                {shortRelationship(option.label)}
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid max-h-[560px] gap-2 overflow-auto p-2">
        {nodes.map((node) => (
          <div
            key={node.id}
            className={cn(
              "grid gap-1 rounded-xl border-2 border-primary/60 bg-cyan-50 p-2",
              node.selected &&
                "border-foreground bg-primary text-primary-foreground",
              node.pinned && !node.selected && "bg-emerald-100",
            )}
          >
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onSelect(node.id)}
                className="min-w-0 flex-1 truncate text-left text-xs font-medium"
              >
                #{node.id} {shortType(node.entity.type)}
              </button>
              {node.childCount > 0 ? (
                <button
                  type="button"
                  onClick={() => onToggleChildren(node.id, node.childrenLoaded)}
                  className="min-w-7 rounded border bg-background px-1 py-0.5 text-xs text-primary"
                >
                  {node.childrenLoaded
                    ? "-"
                    : `+${Math.min(node.childCount, 99)}`}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => onTogglePin(node.id)}
                className="min-w-7 rounded border bg-background px-1 py-0.5 text-xs text-primary"
              >
                {node.pinned ? "PIN" : "+"}
              </button>
            </div>
            <button
              type="button"
              onClick={() => onSelect(node.id)}
              className="truncate text-left text-xs opacity-90"
            >
              {node.entity.name || node.entity.globalId || node.entity.type}
            </button>
          </div>
        ))}
        {!nodes.length ? (
          <p className="py-2 text-sm text-muted-foreground">No graph nodes.</p>
        ) : null}
        {edges.length ? (
          <p className="py-2 text-sm text-muted-foreground">
            {edges.length} relationships indexed.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function shortType(type: string) {
  return type.replace(/^IFC/i, "");
}

function shortRelationship(type: string) {
  return type.replace(/^IFCREL/i, "").replace(/^IFC/i, "");
}
