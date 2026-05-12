export type ViewerWorldDelta = {
  x?: number;
  y?: number;
  z?: number;
};

export function viewerWorldDeltaToIfcPlacementDelta(delta: ViewerWorldDelta) {
  return {
    x: delta.x ?? 0,
    y: -(delta.z ?? 0),
    z: delta.y ?? 0,
  };
}
