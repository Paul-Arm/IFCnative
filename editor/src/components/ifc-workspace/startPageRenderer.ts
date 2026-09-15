import {
  BRIDGE_STAYS,
  CONSTELLATION_BOUNDS as bounds,
  CONSTELLATIONS,
  INITIAL_SHAPES,
  MAX_CELL_SIZE,
  MAX_FRAME_CELLS,
  MODEL_UNITS,
  constellationFrame,
  createShapeSchedule,
  cubePath,
  projectPoint,
  writeProjectedFrame,
} from "./startPageGeometry";

const FACE_PATHS = [
  `${cubePath([-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5])}Z`,
  `${cubePath([-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5])}Z`,
  `${cubePath([0.5, 0.5, 0.5], [0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5])}Z`,
];
const OUTLINE = [
  `${cubePath([-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5], [-0.5, 0.5, 0.5])}Z`,
  cubePath([-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, -0.5, 0.5]),
  cubePath([0.5, 0.5, 0.5], [0.5, 0.5, -0.5]),
].join(" ");
const HALF_WIDTH = Math.sqrt(3) / 2;
const CABLE_PATHS = [false, true].map((front) => BRIDGE_STAYS.filter((stay) => stay.front === front).map(({ from, to }) => ({
  from: projectPoint(from), to: projectPoint(to),
})));

function materialColors(canvas: HTMLCanvasElement): string[] {
  const style = getComputedStyle(canvas);
  const probe = document.createElement("span");
  probe.style.visibility = "hidden";
  canvas.parentElement!.append(probe);
  try {
    return [
      "--start-cube-top-light", "--start-cube-top-shade",
      "--start-cube-left-light", "--start-cube-left-shade",
      "--start-cube-right-light", "--start-cube-right-shade", "--primary",
    ].map((property) => {
      // Resolve color-mix/variables through CSS before using Canvas color stops.
      probe.style.color = style.getPropertyValue(property);
      return getComputedStyle(probe).color;
    });
  } finally {
    probe.remove();
  }
}

function cubeSprite(unit: number, pixelRatio: number, colors: string[], edgeOpacity: number) {
  const image = document.createElement("canvas");
  image.width = Math.ceil(2 * HALF_WIDTH * unit + 4);
  image.height = Math.ceil(2 * unit + 4);
  const context = image.getContext("2d")!;
  context.setTransform(unit, 0, 0, unit, image.width / 2, image.height / 2);
  const gradients = [
    [-HALF_WIDTH, -1, HALF_WIDTH, 0],
    [-HALF_WIDTH, -0.5, 0, 1],
    [0, -0.5, HALF_WIDTH, 1],
  ];
  FACE_PATHS.forEach((path, face) => {
    const [x1, y1, x2, y2] = gradients[face];
    const gradient = context.createLinearGradient(x1, y1, x2, y2);
    gradient.addColorStop(0, colors[face * 2]);
    gradient.addColorStop(1, colors[face * 2 + 1]);
    context.fillStyle = gradient;
    context.fill(new Path2D(path));
  });
  context.strokeStyle = colors[6];
  context.globalAlpha = edgeOpacity;
  context.lineWidth = pixelRatio / unit;
  context.lineJoin = "round";
  context.stroke(new Path2D(OUTLINE));
  return image;
}

/** Cached cube sprites → cached model bitmaps → one visible canvas. */
export function createStartPageRenderer(canvas: HTMLCanvasElement, random: () => number = Math.random) {
  const context = canvas.getContext("2d");
  if (!context) return null;
  const schedule = createShapeSchedule(random);
  const staticScene = INITIAL_SHAPES.map((shape) => ({ from: shape, to: shape, progress: 0 }));

  const layers = CONSTELLATIONS.map(() => {
    const image = document.createElement("canvas");
    return {
      image,
      context: image.getContext("2d")!,
      sprite: document.createElement("canvas"),
      largeSprite: document.createElement("canvas"),
      points: new Float64Array(MAX_FRAME_CELLS * 4),
      order: [] as number[],
      key: "",
      unit: 1,
      cableColor: "",
    };
  });
  let rect = canvas.getBoundingClientRect();
  let pixelRatio = 1;
  let viewScale = 1;
  let offsetX = 0;
  let offsetY = 0;

  const resize = () => {
    rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(8_000_000 / (rect.width * rect.height)));
    // Wider framing for the orthographic canvas scene (about 22% wider view).
    viewScale = Math.max(rect.width / 1440, rect.height / 900) * 0.82;
    offsetX = (rect.width - 1440 * viewScale) / 2;
    offsetY = (rect.height - 900 * viewScale) / 2;
    canvas.width = Math.ceil(rect.width * pixelRatio);
    canvas.height = Math.ceil(rect.height * pixelRatio);
    const colors = materialColors(canvas);
    const edgeOpacity = Number(getComputedStyle(canvas).getPropertyValue("--start-cube-edge-opacity"));
    layers.forEach((layer, group) => {
      layer.unit = CONSTELLATIONS[group].size / MODEL_UNITS * viewScale * pixelRatio;
      layer.cableColor = colors[6];
      layer.sprite = cubeSprite(layer.unit, pixelRatio, colors, edgeOpacity);
      layer.largeSprite = cubeSprite(layer.unit * MAX_CELL_SIZE, pixelRatio, colors, edgeOpacity);
      layer.image.width = Math.ceil((bounds.maxX - bounds.minX) * layer.unit);
      layer.image.height = Math.ceil((bounds.maxY - bounds.minY) * layer.unit);
      layer.key = "";
    });
  };

  const draw = (seconds: number, proximity: readonly number[], reduced: boolean) => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    const transitions = reduced ? staticScene : schedule.sample(seconds);
    layers.forEach((layer, group) => {
      const config = CONSTELLATIONS[group];
      const float = reduced ? 0 : Math.sin(seconds * 0.3 + group * 2) * 10;
      const x = (offsetX + config.x * viewScale) * pixelRatio + bounds.minX * layer.unit;
      const y = (offsetY + (config.y + float) * viewScale) * pixelRatio + bounds.minY * layer.unit;
      if (x + layer.image.width < 0 || y + layer.image.height < 0 || x > canvas.width || y > canvas.height) return;
      const frame = constellationFrame(transitions[group], reduced ? 0 : proximity[group]);
      if (frame.key !== layer.key) {
        const count = writeProjectedFrame(frame, layer.points);
        // The active list grows during subdivision and shrinks during merging.
        if (layer.order.length !== count) {
          layer.order.length = count;
          for (let i = 0; i < count; i++) layer.order[i] = i;
        }
        layer.order.sort((a, b) => layer.points[a * 4 + 2] - layer.points[b * 4 + 2] || a - b);
        layer.context.clearRect(0, 0, layer.image.width, layer.image.height);
        const drawCables = (side: number) => {
          if (frame.bridgeOpacity <= 0) return;
          layer.context.beginPath();
          for (const { from: [x1, y1], to: [x2, y2] } of CABLE_PATHS[side]) {
            layer.context.moveTo((x1 * frame.expansion - bounds.minX) * layer.unit, (y1 * frame.expansion - bounds.minY) * layer.unit);
            layer.context.lineTo((x2 * frame.expansion - bounds.minX) * layer.unit, (y2 * frame.expansion - bounds.minY) * layer.unit);
          }
          layer.context.strokeStyle = layer.cableColor;
          layer.context.lineWidth = 0.7 * pixelRatio;
          layer.context.globalAlpha = frame.bridgeOpacity * 0.38;
          layer.context.stroke();
          layer.context.globalAlpha = 1;
        };
        drawCables(0);
        for (const index of layer.order) {
          const size = layer.points[index * 4 + 3];
          const large = size > 1;
          const sprite = large ? layer.largeSprite : layer.sprite;
          const scale = size / (large ? MAX_CELL_SIZE : 1);
          const width = sprite.width * scale;
          const height = sprite.height * scale;
          layer.context.drawImage(sprite,
            (layer.points[index * 4] - bounds.minX) * layer.unit - width / 2,
            (layer.points[index * 4 + 1] - bounds.minY) * layer.unit - height / 2,
            width, height);
        }
        drawCables(1);
        layer.key = frame.key;
      }
      // Stable buildings only require one bitmap draw each, including floating.
      context.drawImage(layer.image, x, y);
    });
  };

  return {
    resize,
    draw,
    pointer(clientX: number, clientY: number) {
      return { x: (clientX - rect.left - offsetX) / viewScale, y: (clientY - rect.top - offsetY) / viewScale };
    },
    dispose() {
      for (const layer of layers) {
        layer.image.width = layer.sprite.width = layer.largeSprite.width = 0;
      }
      canvas.width = 0;
    },
  };
}
