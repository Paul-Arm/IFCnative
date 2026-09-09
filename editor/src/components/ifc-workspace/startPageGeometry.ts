export type Point3 = readonly [number, number, number];

export const CUBE_GRID_SIZE = 3;
// Keep the overall silhouette size independent of a model's voxel resolution.
export const MODEL_UNITS = 7;
export const CUBELETS: readonly Point3[] = Array.from({ length: CUBE_GRID_SIZE ** 3 }, (_, i) => [
  i % 3 - 1,
  Math.floor(i / 3) % 3 - 1,
  Math.floor(i / 9) - 1,
]);

export const CONSTELLATIONS = [
  { x: 192, y: 320, size: 140 },
  { x: 1275, y: 620, size: 156 },
  { x: 1020, y: 145, size: 81 },
] as const;

export function projectPoint([x, y, z]: Point3): readonly [number, number] {
  return [(x - y) * Math.sqrt(3) / 2, (x + y) / 2 - z];
}

export function cubePath(...points: Point3[]): string {
  return points.map((point, i) => {
    const [x, y] = projectPoint(point);
    return `${i ? "L" : "M"}${x.toFixed(4)} ${y.toFixed(4)}`;
  }).join(" ");
}

function voxelModel() {
  const points = new Map<string, Point3>();
  return {
    add(x: number, y: number, z: number) { points.set(`${x},${y},${z}`, [x, y, z]); },
    finish(centerZ: number): readonly Point3[] {
      return [...points.values()].map(([x, y, z]): Point3 => [x, y, z - centerZ]);
    },
  };
}

function createBridge(): readonly Point3[] {
  const model = voxelModel();
  const foundationZ = -13;
  // Slender deck and parapets; a split central mast follows the reference photo.
  for (let x = -16; x <= 16; x++) {
    for (let y = -3; y <= 3; y++) model.add(x, y, 0);
    for (const y of [-3, 3]) model.add(x, y, 1);
    for (const y of [-2, 2]) model.add(x, y, -1);
  }
  for (const x of [0, 1]) {
    // Long, two-cell-thick A-frame legs leave the roadway opening clear.
    for (let z = 0; z <= 18; z++) {
      const inner = Math.max(1, Math.round(4 * (1 - z / 19)));
      for (const side of [-1, 1]) {
        model.add(x, side * inner, z);
        model.add(x, side * (inner + 1), z);
      }
    }
    for (let z = 19; z <= 24; z++) for (let y = -1; y <= 1; y++) model.add(x, y, z);
    for (const y of [-1, 1]) model.add(x, y, 25);

    // The lower legs fold inward onto the pier, forming the open diamond base.
    for (let z = -6; z <= -2; z++) {
      const outer = 2 + Math.round((z + 6) * 3 / 4);
      for (const side of [-1, 1]) {
        model.add(x, side * outer, z);
        model.add(x, side * (outer - 1), z);
      }
    }
    for (let y = -5; y <= 5; y++) model.add(x, y, -1);
    for (let y = -2; y <= 2; y++) for (let z = foundationZ + 1; z <= -6; z++) model.add(x, y, z);
  }
  // Projecting collars articulate the slim upper mast, as in the reference.
  for (const z of [18, 21, 24]) {
    for (let x = -1; x <= 2; x++) for (let y = -2; y <= 2; y++) model.add(x, y, z);
  }
  for (const x of [-14, 14]) {
    for (let y = -2; y <= 2; y++) for (let z = foundationZ + 1; z <= -1; z++) model.add(x, y, z);
    for (let y = -3; y <= 3; y++) model.add(x, y, foundationZ);
  }
  for (const x of [-1, 0, 1, 2]) for (let y = -3; y <= 3; y++) model.add(x, y, foundationZ);
  return model.finish(8);
}
function createHouse(): readonly Point3[] {
  const model = voxelModel();
  for (let x = -4; x <= 4; x++) {
    for (let y = -3; y <= 3; y++) {
      model.add(x, y, 0);
      for (let z = 1; z <= 4; z++) {
        const wall = Math.abs(x) === 4 || Math.abs(y) === 3;
        const door = x === 0 && y === 3 && z <= 3;
        const window = (z === 2 || z === 3) && (
          (Math.abs(y) === 3 && Math.abs(x) >= 2 && Math.abs(x) <= 3)
          || (Math.abs(x) === 4 && Math.abs(y) <= 1)
        );
        if (wall && !door && !window) model.add(x, y, z);
      }
      if (Math.abs(y) === 3) {
        for (let z = 5; z < 10 - Math.abs(x); z++) model.add(x, y, z);
      }
    }
  }
  // Pitched roof with overhanging eaves and a chimney.
  for (let x = -5; x <= 5; x++) {
    for (let y = -4; y <= 4; y++) model.add(x, y, 10 - Math.abs(x));
  }
  for (const x of [2, 3]) for (let z = 9; z <= 11; z++) model.add(x, -1, z);
  return model.finish(5);
}

function createTower(): readonly Point3[] {
  const model = voxelModel();
  for (let x = -4; x <= 4; x++) for (let y = -3; y <= 3; y++) model.add(x, y, 0);
  for (let z = 1; z <= 9; z++) {
    for (let x = -3; x <= 3; x++) {
      for (let y = -2; y <= 2; y++) {
        const facade = Math.abs(x) === 3 || Math.abs(y) === 2;
        const window = z % 3 !== 0 && ((Math.abs(y) === 2 && Math.abs(x) % 2 === 1) || (Math.abs(x) === 3 && y === 0));
        if (z % 3 === 0 || (facade && !window)) model.add(x, y, z);
      }
    }
  }
  for (let x = -2; x <= 2; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = 10; z <= 13; z++) if (z === 13 || Math.abs(x) === 2 || Math.abs(y) === 1) model.add(x, y, z);
    }
  }
  for (let z = 14; z <= 17; z++) model.add(0, 0, z);
  return model.finish(8);
}

function createIfcLetters(): readonly Point3[] {
  const model = voxelModel();
  const glyphs = [
    ["1111111", "1111111", "0011100", "0011100", "0011100", "0011100", "0011100", "1111111", "1111111"],
    ["1111111", "1111111", "1100000", "1100000", "1111110", "1111110", "1100000", "1100000", "1100000"],
    ["0111111", "1111111", "1100000", "1100000", "1100000", "1100000", "1100000", "1111111", "0111111"],
  ];
  // Read left to right on the visible front face, with three layers of depth
  // and enough spacing to keep the extruded letters separate in projection.
  glyphs.forEach((rows, letter) => rows.forEach((row, r) => {
    for (let column = 0; column < row.length; column++) {
      if (row[column] !== "1") continue;
      for (let depth = -1; depth <= 1; depth++) model.add(letter * 10 + column - 13, depth, 8 - r);
    }
  }));
  return model.finish(4);
}

function createGate(): readonly Point3[] {
  const model = voxelModel();
  for (let x = -5; x <= 5; x++) {
    const archHeight = Math.abs(x) <= 3 ? 4 + Math.sqrt(3.5 ** 2 - x ** 2) : 0;
    for (let y = -1; y <= 1; y++) for (let z = 0; z <= 8; z++) {
      if (z >= archHeight) model.add(x, y, z);
    }
  }
  for (let x = -6; x <= 6; x++) for (let y = -2; y <= 2; y++) {
    for (const z of [9, 10]) model.add(x, y, z);
    if (Math.abs(x) >= 4) model.add(x, y, -1);
  }
  for (let x = -5; x <= 5; x++) for (let y = -1; y <= 1; y++) model.add(x, y, 11);
  for (const x of [-1, 0, 1]) model.add(x, 0, 12);
  return model.finish(5);
}

function createNibelungenBridge(): readonly Point3[] {
  const model = voxelModel();
  const foundationZ = -9;
  // Longer approaches flare outside the gateway. A double deck, inset girders
  // and raised parapets give the bridge weight without enlarging the tower.
  for (let x = -20; x <= 20; x++) {
    const halfWidth = Math.abs(x) <= 5 ? 3 : 4;
    for (let y = -halfWidth; y <= halfWidth; y++) {
      model.add(x, y, 0);
      model.add(x, y, -1);
    }
    if (Math.abs(x) > 5) {
      for (const side of [-1, 1]) {
        model.add(x, side * halfWidth, 1);
        model.add(x, side * (halfWidth - 1), -2);
      }
    }
  }
  // Broad pier caps carry the girders; thicker shafts meet widened footings.
  for (const center of [-16, 16]) {
    for (let x = center - 1; x <= center + 1; x++) {
      for (let y = -2; y <= 2; y++) for (let z = foundationZ; z <= -4; z++) model.add(x, y, z);
    }
    for (let x = center - 2; x <= center + 2; x++) {
      for (let y = -4; y <= 4; y++) model.add(x, y, -3);
      for (let y = -3; y <= 3; y++) model.add(x, y, foundationZ - 1);
    }
  }
  for (let x = -3; x <= 3; x++) for (let y = -6; y <= 6; y++) {
    const archHeight = Math.abs(y) <= 3 ? 6 + Math.sqrt(3.5 ** 2 - y ** 2) : 0;
    const facade = Math.abs(x) === 3;
    const side = Math.abs(y) === 6;
    for (let z = 1; z <= 19; z++) {
      const window = (facade && (
        ((z === 12 || z === 13) && (Math.abs(y) === 2 || Math.abs(y) === 4))
        || ((z === 16 || z === 17) && y % 3 === 0 && Math.abs(y) < 6)
      )) || (side && x === 0 && [3, 4, 8, 9, 12, 13, 16, 17].includes(z));
      if (z >= archHeight && !window && (facade || side || z === 10 || z === 15 || z === 19)) model.add(x, y, z);
    }
    // The narrow side wall continues below road level into a continuous stone
    // base, with a recessed entrance instead of two exposed bridge legs.
    for (let z = foundationZ; z < 0; z++) {
      const entrance = side && x === 0 && z >= -7 && z <= -5;
      if ((facade || side || z === foundationZ) && !entrance) model.add(x, y, z);
    }
  }
  for (let x = -4; x <= 4; x++) for (let y = -7; y <= 7; y++) {
    if (Math.abs(x) >= 3 || Math.abs(y) >= 6) model.add(x, y, foundationZ - 1);
  }
  // Alternating corner blocks and corbels outline the tall side elevation.
  for (const x of [-4, 4]) for (const y of [-6, 6]) {
    for (let z = foundationZ + 1; z < 15; z += 3) {
      model.add(x, y, z);
      model.add(x, y, z + 1);
    }
  }
  for (const y of [-7, 7]) for (const x of [-2, 0, 2]) {
    model.add(x, y, 18);
  }
  // Cornices and stepped arch voussoirs give the stone tower its relief.
  for (const z of [15, 19]) {
    for (const x of [-4, 4]) for (let y = -6; y <= 6; y++) model.add(x, y, z);
    for (const y of [-7, 7]) for (let x = -3; x <= 3; x++) model.add(x, y, z);
  }
  for (let y = -4; y <= 4; y++) {
    const z = Math.ceil(6 + Math.sqrt(Math.max(0, 4.5 ** 2 - y ** 2)));
    for (const x of [-4, 4]) model.add(x, y, z);
  }
  // Steep hipped roof with a long ridge, rather than the house's simple gable.
  for (let x = -4; x <= 4; x++) for (let y = -8; y <= 8; y++) {
    const top = 28 - Math.max(Math.abs(x) * 2, (Math.abs(y) - 4) * 2);
    model.add(x, y, top);
    model.add(x, y, top - 1);
  }
  const turret = (cx: number, cy: number, bottom: number, eaves: number, radius: number) => {
    for (let x = -radius; x <= radius; x++) for (let y = -radius; y <= radius; y++) {
      if (x * x + y * y > radius * radius + 0.5) continue;
      for (let z = bottom; z < eaves; z++) {
        if (!(x === radius && y === 0 && z === eaves - 2)) model.add(cx + x, cy + y, z);
      }
    }
    for (let z = eaves; z <= eaves + 5; z++) {
      const r = Math.max(0, 2 - Math.floor((z - eaves) / 2));
      for (let x = -r; x <= r; x++) for (let y = -r; y <= r; y++) {
        if (x * x + y * y <= r * r + 0.5) model.add(cx + x, cy + y, z);
      }
    }
    model.add(cx, cy, eaves + 6);
  };
  for (const x of [-3, 3]) for (const y of [-6, 6]) turret(x, y, 15, 20, 1);
  for (const y of [-6, 6]) turret(4, y, foundationZ, 6, 2);
  for (const y of [-4, 4]) for (let z = 29; z <= 30; z++) model.add(0, y, z);
  return model.finish(12);
}

export const SHAPE_NAMES = ["cube", "bridge", "house", "tower", "ifc", "gate", "nibelungen"] as const;
export const SHAPES = [CUBELETS, createBridge(), createHouse(), createTower(), createIfcLetters(), createGate(), createNibelungenBridge()] as const;
export const SHAPE_SCALES = [MODEL_UNITS / CUBE_GRID_SIZE, 0.46, 0.85, 0.8, 0.58, 0.85, 0.46] as const;
export const INITIAL_SHAPES = [0, 6, 1] as const;
export const MAX_CELL_SIZE = Math.max(...SHAPE_SCALES);
export const MAX_FRAME_CELLS = Math.max(...SHAPES.map((shape) => shape.length)) * 2;
const smoothstep = (t: number) => t * t * (3 - 2 * t);
const clamp = (t: number) => Math.min(1, Math.max(0, t));

export interface ShapeTransition {
  from: number;
  to: number;
  progress: number;
}

/** Independent timers share reservations for every visible source and target.
 * Process events chronologically, including time jumps, so no cloud can claim
 * a figure while another cloud still holds or morphs it. */
export function createShapeSchedule(random: () => number = Math.random) {
  const clouds = INITIAL_SHAPES.map((shape, group) => ({
    from: shape as number, to: shape as number,
    start: 6 + group * 1.5 + random() * 6,
    duration: 0, moving: false,
  }));
  return {
    sample(seconds: number): ShapeTransition[] {
      while (true) {
        let next = clouds[0];
        const eventTime = (cloud: typeof next) => cloud.start + (cloud.moving ? cloud.duration : 0);
        for (const cloud of clouds) if (eventTime(cloud) < eventTime(next)) next = cloud;
        const time = eventTime(next);
        if (time > seconds) break;
        if (next.moving) {
          next.from = next.to;
          next.moving = false;
          next.start = time + 6 + random() * 6;
        } else {
          const occupied = new Set(clouds.flatMap((cloud) => [cloud.from, cloud.to]));
          const available = SHAPES.map((_, shape) => shape).filter((shape) => !occupied.has(shape));
          next.to = available[Math.min(available.length - 1, Math.floor(random() * available.length))];
          next.duration = 4 + random() * 2;
          next.moving = true;
        }
      }
      return clouds.map((cloud) => ({
        from: cloud.from, to: cloud.to,
        progress: cloud.moving ? clamp((seconds - cloud.start) / cloud.duration) : 0,
      }));
    },
  };
}

/** Stays attach outside both mast faces and both deck edges. The near fan must
 * paint after the opaque glass cells; otherwise only the far fan is visible. */
export const BRIDGE_STAYS = ([-1, 1] as const).flatMap((side) =>
  [-15, -13, -11, -9, -7, -5, -3, 4, 6, 8, 10, 12, 14, 16].map((x, i) => ({
    front: side === 1,
    // Anchor on the wider mast faces, between the two upper collars.
    from: [0.5 * SHAPE_SCALES[1], side * 1.55 * SHAPE_SCALES[1], (23.35 - i * 0.12 - 8) * SHAPE_SCALES[1]] as Point3,
    to: [x * SHAPE_SCALES[1], side * 3.5 * SHAPE_SCALES[1], (1.2 - 8) * SHAPE_SCALES[1]] as Point3,
  })),
);

/** The isometric camera looks along (1, 1, 1); distant cells paint first. */
export function cameraDepth(point: Point3): number {
  return point[0] + point[1] + point[2];
}

// Project once; frames only interpolate cached numbers into a reusable buffer.
const PROJECTED_SHAPES = SHAPES.map((shape, layout) => Float64Array.from(shape.flatMap((point) => {
  const [x, y] = projectPoint(point);
  const scale = SHAPE_SCALES[layout];
  return [x * scale, y * scale, cameraDepth(point) * scale];
})));
// Include the expanded silhouettes and subdivision offsets in the bitmap bounds.
const projected = PROJECTED_SHAPES;
const margin = MAX_CELL_SIZE * 2;
export const CONSTELLATION_BOUNDS = {
  minX: Math.min(...projected.flatMap((points) => [...points].filter((_, i) => i % 3 === 0))) * 1.65 - margin,
  maxX: Math.max(...projected.flatMap((points) => [...points].filter((_, i) => i % 3 === 0))) * 1.65 + margin,
  minY: Math.min(...projected.flatMap((points) => [...points].filter((_, i) => i % 3 === 1))) * 1.65 - margin,
  maxY: Math.max(...projected.flatMap((points) => [...points].filter((_, i) => i % 3 === 1))) * 1.65 + margin,
};

export function constellationFrame(transition: ShapeTransition, proximity: number) {
  const progress = transition.from === transition.to ? 0 : clamp(transition.progress);
  const shape = progress === 1 ? transition.to : transition.from;
  const next = progress === 0 || progress === 1 ? shape : transition.to;
  const phase = shape === next ? 0 : progress;
  const influence = smoothstep(clamp(proximity));
  const bridgeWeight = ((shape === 1 ? 1 - phase : 0) + (next === 1 ? phase : 0)) * (1 - influence);
  return {
    key: `${shape}:${next}:${phase.toFixed(5)}:${influence.toFixed(5)}`,
    shape,
    next,
    progress: phase,
    expansion: 1 + 0.65 * influence,
    bridgeOpacity: Math.max(0, (bridgeWeight - 0.75) / 0.25),
  };
}

/** Children inherit a parent centre and fly straight to their destination.
 * No intermediate subdivision lattice is built. Plans are shared by all clouds. */
function transitionCells(shape: number, count: number) {
  const parents = PROJECTED_SHAPES[shape];
  const size = SHAPE_SCALES[shape];
  const cells = new Float64Array(count * 4); // parent xyz, child size
  const parentCount = SHAPES[shape].length;
  for (let parent = 0; parent < parentCount; parent++) {
    const start = Math.floor(parent * count / parentCount);
    const end = Math.floor((parent + 1) * count / parentCount);
    const childSize = size / Math.cbrt(end - start);
    for (let child = start; child < end; child++) {
      cells.set([parents[parent * 3], parents[parent * 3 + 1], parents[parent * 3 + 2], childSize], child * 4);
    }
  }
  return cells;
}

const plans = new Map<string, { count: number; from: Float64Array; to: Float64Array }>();

/** Writes only visible cells as [screen x, screen y, depth, size]; at rest the
 * standard cube really renders 27 cells, without hidden surplus particles. */
export function writeProjectedFrame(frame: ReturnType<typeof constellationFrame>, output: Float64Array): number {
  let count = 0;
  const append = (x: number, y: number, depth: number, size: number) => {
    if (size <= 1e-5) return;
    const offset = count++ * 4;
    output[offset] = x * frame.expansion;
    output[offset + 1] = y * frame.expansion;
    output[offset + 2] = depth * frame.expansion;
    output[offset + 3] = size;
  };
  const parents = (shape: number, scale: number) => {
    const points = PROJECTED_SHAPES[shape];
    for (let i = 0; i < points.length; i += 3) {
      append(points[i], points[i + 1], points[i + 2], SHAPE_SCALES[shape] * scale);
    }
  };
  if (frame.shape === frame.next) {
    parents(frame.shape, 1);
    return count;
  }
  const key = `${frame.shape}:${frame.next}`;
  let plan = plans.get(key);
  if (!plan) {
    const count = Math.max(SHAPES[frame.shape].length, SHAPES[frame.next].length);
    plan = { count, from: transitionCells(frame.shape, count), to: transitionCells(frame.next, count) };
    plans.set(key, plan);
  }
  const split = SHAPES[frame.shape].length < plan.count;
  const merge = SHAPES[frame.next].length < plan.count;
  const splitProgress = split ? smoothstep(clamp(frame.progress / 0.2)) : 1;
  const mergeProgress = merge ? smoothstep(clamp((frame.progress - 0.8) / 0.2)) : 0;
  const travel = smoothstep(frame.progress);
  const a = 1 - travel;
  const b = travel;
  for (let cell = 0; cell < plan.count; cell++) {
    const i = cell * 4;
    const from = plan.from;
    const to = plan.to;
    append(
      from[i] * a + to[i] * b,
      from[i + 1] * a + to[i + 1] * b,
      from[i + 2] * a + to[i + 2] * b,
      from[i + 3] * splitProgress * a + to[i + 3] * (1 - mergeProgress) * b,
    );
  }
  if (split && splitProgress < 1) parents(frame.shape, 1 - splitProgress);
  if (merge && mergeProgress > 0) parents(frame.next, mergeProgress);
  return count;
}
