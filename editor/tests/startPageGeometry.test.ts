import assert from "node:assert/strict";
import test from "node:test";

import { BRIDGE_STAYS, cameraDepth, createShapeSchedule, CONSTELLATION_BOUNDS as bounds, constellationFrame, CUBELETS, INITIAL_SHAPES, MAX_FRAME_CELLS, MODEL_UNITS, projectPoint, SHAPES, SHAPE_SCALES, writeProjectedFrame } from "../src/components/ifc-workspace/startPageGeometry";

function cells(from: number, to = from, progress = 0, proximity = 0) {
  const output = new Float64Array(MAX_FRAME_CELLS * 4);
  const count = writeProjectedFrame(constellationFrame({ from, to, progress }, proximity), output);
  return Array.from({ length: count }, (_, i) => [...output.subarray(i * 4, i * 4 + 4)]);
}

test("all isometric axes retain equal length and equal angles", () => {
  const projected = ([[1, 0, 0], [0, 1, 0], [0, 0, 1]] as const).map(projectPoint);
  for (const [x, y] of projected) assert.ok(Math.abs(Math.hypot(x, y) - 1) < 1e-12);
  for (let i = 0; i < 3; i++) {
    const a = projected[i];
    const b = projected[(i + 1) % 3];
    assert.ok(Math.abs(a[0] * b[0] + a[1] * b[1] + 0.5) < 1e-12);
  }
});

test("the base cube has exactly 3³ cells and buildings use their own resolution", () => {
  assert.equal(CUBELETS.length, 27);
  assert.equal(SHAPE_SCALES[0] * 3, MODEL_UNITS);
  assert.ok(SHAPES[1].length > 600);
  assert.equal(new Set(SHAPES.map((shape) => shape.length)).size, SHAPES.length);
  for (const [shape, points] of SHAPES.entries()) {
    assert.equal(cells(shape).length, points.length);
    assert.equal(new Set(points.map(String)).size, points.length);
    // Integer model coordinates guarantee separate, non-overlapping unit cells.
    assert.ok(points.every((p) => p.every(Number.isInteger)));
  }
});

test("every pair starts and ends with exactly the original model, including size", () => {
  SHAPES.forEach((points, shape) => {
    const size = SHAPE_SCALES[shape];
    const expected = points.map((p) => [...projectPoint(p).map((n) => n * size), cameraDepth(p) * size, size]);
    assert.deepEqual(cells(shape), expected);
    for (let other = 0; other < SHAPES.length; other++) {
      assert.deepEqual(cells(shape, other, 0), expected);
      assert.deepEqual(cells(other, shape, 1), expected);
    }
  });
});

test("additional cells grow from the 27 parents while travelling to the bridge", () => {
  const parents = cells(0);
  const early = cells(0, 1, 0.01);
  const split = cells(0, 1, 0.1);
  const separated = cells(0, 1, 0.2);
  const count = SHAPES[1].length;
  assert.equal(early.length, count + 27);
  assert.equal(split.length, count + 27);
  assert.equal(separated.length, count);
  for (let i = 0; i < count; i++) {
    // New cells grow out of a parent, not from unrelated distant positions.
    const nearest = Math.min(...parents.map((p) => Math.hypot(...p.slice(0, 3).map((n, axis) => n - early[i][axis]))));
    assert.ok(nearest < 0.03);
    assert.ok(early[i][3] < 0.01);
    assert.ok(split[i][3] < separated[i][3]);
    assert.ok(separated[i][3] < SHAPE_SCALES[0]);
  }
  for (let i = count; i < split.length; i++) {
    assert.equal(split[i][3], SHAPE_SCALES[0] / 2);
  }
});

test("subdivided children travel directly to the model without building another lattice", () => {
  for (const [from, to] of [[0, 1], [0, 6], [6, 0], [2, 4]]) {
    const source = cells(from);
    const target = cells(to);
    const count = Math.max(source.length, target.length);
    for (const progress of [0.01, 0.1, 0.2, 0.5, 0.8, 0.9]) {
      const frame = cells(from, to, progress);
      let moved = 0;
      for (let i = 0; i < count; i++) {
        const a = source[Math.ceil((i + 1) * source.length / count) - 1];
        const b = target[Math.ceil((i + 1) * target.length / count) - 1];
        const direction = a.slice(0, 3).map((v, axis) => b[axis] - v);
        const offset = a.slice(0, 3).map((v, axis) => frame[i][axis] - v);
        const axis = direction.findIndex((n) => Math.abs(n) > 1e-8);
        if (axis < 0) continue;
        const ratio = offset[axis] / direction[axis];
        assert.ok(ratio > 0 && ratio < 1);
        // All components follow the same straight path from parent to target.
        offset.forEach((v, j) => assert.ok(Math.abs(v - direction[j] * ratio) < 1e-8));
        moved++;
      }
      assert.ok(moved > count / 2);
    }
  }
});

test("returning to the cube merges children and removes surplus cells smoothly", () => {
  const bridgeCount = SHAPES[1].length;
  assert.equal(cells(1, 0, 0.8).length, bridgeCount);
  assert.equal(cells(1, 0, 0.9).length, bridgeCount + 27);
  const nearEnd = cells(1, 0, 1 - 1e-6);
  assert.equal(nearEnd.length, 27);
  const target = cells(0);
  nearEnd.forEach((cell, i) => cell.forEach((n, axis) => assert.ok(Math.abs(n - target[i][axis]) < 1e-8)));
});

test("all intermediate cells remain finite and inside the cached bitmap", () => {
  for (let from = 0; from < SHAPES.length; from++) for (let to = 0; to < SHAPES.length; to++) {
    for (const progress of [0, 0.00001, 0.1, 0.19999, 0.2, 0.4, 0.6, 0.8, 0.80001, 0.9, 0.99999, 1]) {
      for (const proximity of [0, 1]) {
        const frame = cells(from, to, progress, proximity);
        assert.ok(frame.length <= MAX_FRAME_CELLS);
        for (const [x, y, depth, size] of frame) {
          assert.ok([x, y, depth, size].every(Number.isFinite));
          assert.ok(size > 0);
          assert.ok(x - size >= bounds.minX && x + size <= bounds.maxX);
          assert.ok(y - size >= bounds.minY && y + size <= bounds.maxY);
        }
      }
    }
  }
});

test("split and merge stages join continuously without moving the parent abruptly", () => {
  for (const [from, to] of [[0, 1], [1, 0], [2, 3], [3, 2]]) {
    for (const boundary of [SHAPES[from].length < SHAPES[to].length ? 0.2 : 0.8]) {
      const before = cells(from, to, boundary - 1e-6);
      const after = cells(from, to, boundary + 1e-6);
      assert.equal(before.length, after.length);
      before.forEach((cell, i) => cell.forEach((n, axis) => assert.ok(Math.abs(n - after[i][axis]) < 1e-4)));
    }
  }
});

test("mouse proximity separates the current model while retaining its cell count and size", () => {
  for (let shape = 0; shape < SHAPES.length; shape++) {
    const original = cells(shape);
    const expanded = cells(shape, shape, 0, 1);
    assert.equal(original.length, expanded.length);
    original.forEach((cell, i) => {
      for (let axis = 0; axis < 3; axis++) assert.equal(expanded[i][axis], cell[axis] * 1.65);
      assert.equal(expanded[i][3], cell[3]);
    });
    assert.deepEqual(cells(shape), original);
  }
});

test("the detailed bridge has a split mast and mirrored stays on both deck edges", () => {
  const has = (x: number, y: number, z: number) => SHAPES[1].some((p) => p[0] === x && p[1] === y && p[2] === z - 8);
  for (const x of [-16, 16]) assert.ok(has(x, 0, 0));
  for (const y of [-4, 4]) assert.ok(has(0, y, 1));
  for (const y of [-1, 1]) assert.ok(has(0, y, 25));
  // The long A-frame and lower diamond remain open rather than solid walls.
  for (let z = 2; z < 18; z++) assert.ok(!has(0, 0, z));
  for (let z = -5; z <= -2; z++) assert.ok(!has(0, 0, z));
  assert.ok(has(0, 0, -6));
  assert.ok(has(0, 0, -1));
  for (const z of [18, 21, 24]) for (const y of [-2, 2]) assert.ok(has(2, y, z));
  const back = BRIDGE_STAYS.filter((s) => !s.front);
  const front = BRIDGE_STAYS.filter((s) => s.front);
  assert.ok(back.length >= 14);
  assert.equal(back.length, front.length);
  front.forEach((stay, i) => {
    assert.deepEqual(stay.from, [back[i].from[0], -back[i].from[1], back[i].from[2]]);
    assert.deepEqual(stay.to, [back[i].to[0], -back[i].to[1], back[i].to[2]]);
    assert.ok(stay.from[1] > SHAPE_SCALES[1] * 1.5);
    // Stay anchors land on the mast, clear of the projecting collars.
    const anchorZ = stay.from[2] / SHAPE_SCALES[1] + 8;
    assert.ok(anchorZ > 21.5 && anchorZ < 23.5);
    assert.equal(stay.to[1], SHAPE_SCALES[1] * 3.5);
    assert.ok(stay.from[2] > stay.to[2]);
  });
  assert.ok(front.some((s) => s.to[0] < 0) && front.some((s) => s.to[0] > 0));
});

test("house windows, door, roof and chimney remain open and detailed", () => {
  const has = (x: number, y: number, z: number) => SHAPES[2].some((p) => p[0] === x && p[1] === y && p[2] === z - 5);
  for (let z = 1; z <= 3; z++) assert.ok(!has(0, 3, z));
  for (const x of [-3, -2, 2, 3]) for (const z of [2, 3]) assert.ok(!has(x, 3, z));
  assert.ok(has(0, 0, 10));
  assert.ok(has(5, 0, 5));
  assert.ok(has(2, -1, 11));
});

test("Nibelungen bridge retains a clear arch, a steep roof, turrets and a through road", () => {
  const has = (x: number, y: number, z: number) => SHAPES[6].some((p) => p[0] === x && p[1] === y && p[2] === z - 12);
  for (let x = -20; x <= 20; x++) assert.ok(has(x, 0, 0));
  for (let x = -3; x <= 3; x++) for (let z = 1; z <= 9; z++) assert.ok(!has(x, 0, z));
  assert.ok(has(3, 0, 10));
  assert.ok(has(0, 0, 28));
  assert.ok(has(4, 0, 20));
  for (const x of [-3, 3]) for (const y of [-6, 6]) assert.ok(has(x, y, 26));
  for (const y of [-2, 2, -4, 4]) assert.ok(!has(3, y, 13));
  // The side has stacked narrow windows above a continuous, deeper base.
  for (const y of [-6, 6]) {
    for (const z of [3, 4, 8, 9, 12, 13, 16, 17]) assert.ok(!has(0, y, z));
    assert.ok(has(1, y, -7));
    assert.ok(!has(0, y, -7));
    assert.ok(has(0, y, -8));
  }
});

test("held models share cache keys across transition boundaries", () => {
  const key = (from: number, to: number, progress: number, proximity = 0) => constellationFrame({ from, to, progress }, proximity).key;
  assert.equal(key(0, 1, 1), key(1, 4, 0));
  assert.equal(key(0, 2, 0), key(0, 5, 0));
  assert.notEqual(key(0, 1, 0.1), key(0, 1, 0.2));
  assert.notEqual(key(0, 1, 0), key(0, 1, 0, 0.5));
});

function seededRandom(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

test("figures stay unique across all clouds, including startup and overlapping morphs", () => {
  assert.equal(new Set(INITIAL_SHAPES).size, 3);
  for (const random of [() => 0, () => 0.99999, seededRandom(1), seededRandom(2), seededRandom(3)]) {
    const schedule = createShapeSchedule(random);
    const histories: number[][] = [[], [], []];
    for (let step = 0; step <= 6000; step++) {
      const scene = schedule.sample(step / 10);
      const occupied = new Set<number>();
      scene.forEach((transition, group) => {
        assert.ok(transition.progress >= 0 && transition.progress < 1);
        for (const shape of new Set([transition.from, transition.to])) {
          assert.ok(Number.isInteger(shape) && shape >= 0 && shape < SHAPES.length);
          assert.ok(!occupied.has(shape), "source and target figures must be reserved across clouds");
          occupied.add(shape);
        }
        if (histories[group].at(-1) !== transition.from) histories[group].push(transition.from);
      });
    }
    assert.ok(histories.every((history) => history.length > 15));
    assert.equal(new Set(histories.map((history) => history.join(","))).size, 3);
  }
});

test("scene scheduling survives time jumps and does not choose random targets per frame", () => {
  let calls = 0;
  const random = seededRandom(42);
  const fine = createShapeSchedule(() => { calls++; return random(); });
  const coarse = createShapeSchedule(seededRandom(42));
  const initialCalls = calls;
  for (let step = 0; step <= 50; step++) fine.sample(step / 10);
  assert.equal(calls, initialCalls);
  for (let second = 6; second <= 1000; second++) {
    const scene = fine.sample(second);
    if (second % 100 === 0) assert.deepEqual(scene, coarse.sample(second));
  }
});
