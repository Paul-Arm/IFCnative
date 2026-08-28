import type { LucideIcon } from "lucide-react";
import { CircleX } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

/**
 * Rotary-Menü im Stil eines physischen Drehreglers (Design-Port von
 * NuiRotaryMenu): echte Ring-Segmente als SVG-Donut-Sektoren, ein erhabener
 * Knob in der Mitte, eine Caption-Pill und ein gefächertes Flyout für
 * Unteraktionen. Öffnet an einer Viewport-Position (Rechtsklick im Viewer).
 */

export interface RotaryMenuChild {
  id: string;
  label: string;
  description?: string;
  icon?: LucideIcon;
  disabled?: boolean;
}

export interface RotaryMenuItem extends RotaryMenuChild {
  /** Akzentfarbe des Segments (CSS-Farbe); Standard ist var(--primary). */
  accent?: string;
  children?: RotaryMenuChild[];
}

interface RotaryPoint {
  x: number;
  y: number;
}

/** Ring-Geometrie in ViewBox-Einheiten (Quadrat 0–100, Zentrum bei 50). */
const GEOMETRY = {
  gapAngle: 2.6,
  innerRadius: 30,
  outerRadius: 48,
  startAngle: -90,
};

const DIAMETER = 240;
const FLYOUT_WIDTH = 256;

function round3(value: number) {
  return Math.round(value * 1000) / 1000;
}

function segmentAngle(index: number, count: number) {
  return GEOMETRY.startAngle + (360 / Math.max(1, count)) * index;
}

function ringPoint(angle: number, radius: number, center = 50): RotaryPoint {
  const radians = (angle * Math.PI) / 180;
  return {
    x: round3(center + Math.cos(radians) * radius),
    y: round3(center + Math.sin(radians) * radius),
  };
}

/** SVG-Pfad eines Donut-Sektors mit symmetrischer Fuge. */
function segmentPath(index: number, count: number) {
  const span = 360 / Math.max(1, count);
  const center = segmentAngle(index, count);
  const half = Math.max(4, span - GEOMETRY.gapAngle) / 2;
  const from = center - half;
  const to = center + half;
  const large = to - from > 180 ? 1 : 0;
  const outerFrom = ringPoint(from, GEOMETRY.outerRadius);
  const outerTo = ringPoint(to, GEOMETRY.outerRadius);
  const innerFrom = ringPoint(from, GEOMETRY.innerRadius);
  const innerTo = ringPoint(to, GEOMETRY.innerRadius);
  return [
    `M ${outerFrom.x} ${outerFrom.y}`,
    `A ${GEOMETRY.outerRadius} ${GEOMETRY.outerRadius} 0 ${large} 1 ${outerTo.x} ${outerTo.y}`,
    `L ${innerTo.x} ${innerTo.y}`,
    `A ${GEOMETRY.innerRadius} ${GEOMETRY.innerRadius} 0 ${large} 0 ${innerFrom.x} ${innerFrom.y}`,
    "Z",
  ].join(" ");
}

/** Fugenlose Hit-Area eines Segments als CSS-polygon() in Prozent. */
function segmentHitArea(index: number, count: number) {
  const span = 360 / Math.max(1, count);
  const from = segmentAngle(index, count) - span / 2;
  const steps = Math.max(2, Math.ceil(span / 12));
  const outer = 54;
  const inner = Math.max(0, GEOMETRY.innerRadius - 1.5);
  const points: string[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const point = ringPoint(from + (span * step) / steps, outer);
    points.push(`${point.x}% ${point.y}%`);
  }
  for (let step = steps; step >= 0; step -= 1) {
    const point = ringPoint(from + (span * step) / steps, inner);
    points.push(`${point.x}% ${point.y}%`);
  }
  return `polygon(${points.join(", ")})`;
}

function segmentAnchor(index: number, count: number) {
  return ringPoint(
    segmentAngle(index, count),
    (GEOMETRY.outerRadius + GEOMETRY.innerRadius) / 2,
  );
}

/** Grundplatte als echter Ring (Annulus), Loch unterm Knob. */
function annulusPath(outerRadius: number, innerRadius: number, center = 50) {
  const outerTop = round3(center - outerRadius);
  const outerBottom = round3(center + outerRadius);
  const innerTop = round3(center - innerRadius);
  const innerBottom = round3(center + innerRadius);
  return [
    `M ${center} ${outerTop}`,
    `A ${outerRadius} ${outerRadius} 0 1 1 ${center} ${outerBottom}`,
    `A ${outerRadius} ${outerRadius} 0 1 1 ${center} ${outerTop}`,
    "Z",
    `M ${center} ${innerTop}`,
    `A ${innerRadius} ${innerRadius} 0 1 0 ${center} ${innerBottom}`,
    `A ${innerRadius} ${innerRadius} 0 1 0 ${center} ${innerTop}`,
    "Z",
  ].join(" ");
}

const PLATE_PATH = annulusPath(49.2, GEOMETRY.innerRadius - 3);

function firstEnabledIndex(items: readonly RotaryMenuChild[]) {
  return items.findIndex((item) => !item.disabled);
}

function nextEnabledIndex(
  items: readonly RotaryMenuChild[],
  current: number,
  direction: 1 | -1,
) {
  if (!items.length) {
    return -1;
  }
  for (let offset = 1; offset <= items.length; offset += 1) {
    const index = (current + direction * offset + items.length) % items.length;
    if (!items[index]?.disabled) {
      return index;
    }
  }
  return -1;
}

export function ViewerRotaryMenu({
  ariaLabel = "Aktionsmenü",
  items,
  onClose,
  onSelect,
  x,
  y,
}: {
  ariaLabel?: string;
  items: RotaryMenuItem[];
  onClose(): void;
  onSelect(item: RotaryMenuChild, parent?: RotaryMenuItem): void;
  x: number;
  y: number;
}) {
  const instanceId = useId();
  const hatchId = `${instanceId}-hatch`;
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(() =>
    firstEnabledIndex(items),
  );
  const [childIndex, setChildIndex] = useState(-1);
  const wheelDeltaRef = useRef(0);

  const activeItem = items[activeIndex];
  const children = activeItem?.children ?? [];
  const hasFlyout = children.length > 0;
  const displayChildIndex =
    childIndex >= 0 && childIndex < children.length
      ? childIndex
      : Math.max(0, firstEnabledIndex(children));

  // Platzierung: im Viewport klemmen und die Flyout-Seite wählen.
  const placement = useMemo(() => {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const half = DIAMETER / 2;
    const side: "left" | "right" | "bottom" =
      viewportWidth < DIAMETER + FLYOUT_WIDTH + 64
        ? "bottom"
        : x > viewportWidth / 2
          ? "left"
          : "right";
    let nextX = Math.min(
      Math.max(x, half + 16),
      Math.max(viewportWidth - half - 16, half + 16),
    );
    let nextY = Math.min(
      Math.max(y, half + 16),
      Math.max(viewportHeight - half - 16, half + 16),
    );
    if (side === "right") {
      nextX = Math.min(nextX, viewportWidth - half - 260);
      nextX = Math.max(nextX, half + 16);
    } else if (side === "left") {
      nextX = Math.max(nextX, half + 260);
      nextX = Math.min(nextX, viewportWidth - half - 16);
    } else {
      nextY = Math.min(nextY, viewportHeight - half - 180);
      nextY = Math.max(nextY, half + 16);
    }
    return { side, x: nextX, y: nextY };
  }, [x, y]);

  useEffect(() => {
    menuRef.current?.focus();
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const activate = (index: number) => {
    if (items[index]?.disabled) {
      return;
    }
    setActiveIndex(index);
    setChildIndex(-1);
  };

  const chooseItem = (item: RotaryMenuItem, index: number) => {
    if (item.disabled) {
      return;
    }
    activate(index);
    if (item.children?.some((child) => !child.disabled)) {
      setChildIndex(item.children.findIndex((child) => !child.disabled));
      return;
    }
    onSelect(item);
    onClose();
  };

  const chooseChild = (child: RotaryMenuChild, parent: RotaryMenuItem) => {
    if (child.disabled) {
      return;
    }
    onSelect(child, parent);
    onClose();
  };

  /** Scrollrad dreht den Dial wie einen physischen Regler weiter. */
  const onDialWheel = (event: React.WheelEvent) => {
    wheelDeltaRef.current += event.deltaY;
    if (Math.abs(wheelDeltaRef.current) < 24) {
      return;
    }
    const direction: 1 | -1 = wheelDeltaRef.current > 0 ? 1 : -1;
    wheelDeltaRef.current = 0;
    const next = nextEnabledIndex(items, activeIndex, direction);
    if (next >= 0) {
      activate(next);
    }
  };

  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    // Tasten auf einem fokussierten Flyout-Kind gehören dem Kind-Button:
    // preventDefault würde dessen Enter/Space-Aktivierung unterdrücken und
    // die Pfeiltasten würden stattdessen den Ring weiterdrehen — die
    // Unteraktionen wären per Tastatur nie auslösbar.
    if (
      event.target instanceof HTMLElement &&
      event.target.closest(".ifc-rotary-flyout")
    ) {
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      const next = nextEnabledIndex(items, activeIndex, 1);
      if (next >= 0) {
        activate(next);
      }
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = nextEnabledIndex(items, activeIndex, -1);
      if (next >= 0) {
        activate(next);
      }
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (activeItem) {
        chooseItem(activeItem, activeIndex);
      }
    }
  };

  /** Fächer-Transformation eines Flyout-Kindes wie im NUI-Original. */
  const childStyle = (index: number): React.CSSProperties | undefined => {
    if (placement.side === "bottom") {
      return undefined;
    }
    const direction = placement.side === "left" ? -1 : 1;
    const distance = index - displayChildIndex;
    const clamped = Math.max(-3, Math.min(3, distance));
    const magnitude = Math.abs(clamped);
    const push = direction * (0.9 - 0.55 * magnitude * magnitude);
    const opacity =
      magnitude === 0
        ? 1
        : magnitude === 1
          ? 0.74
          : magnitude === 2
            ? 0.48
            : 0.3;
    return {
      "--ifc-rotary-child-x": `${Math.round(push * 100) / 100}rem`,
      "--ifc-rotary-child-rotation": `${direction * clamped * 3.5}deg`,
      "--ifc-rotary-child-scale": `${1 - magnitude * 0.05}`,
      "--ifc-rotary-child-opacity": `${opacity}`,
    } as React.CSSProperties;
  };

  return (
    <div className="ifc-rotary-layer">
      <div
        aria-label={ariaLabel}
        className="ifc-rotary-menu"
        data-flyout-side={placement.side}
        ref={menuRef}
        role="menu"
        style={{ left: `${placement.x}px`, top: `${placement.y}px` }}
        tabIndex={-1}
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={onMenuKeyDown}
        onWheel={onDialWheel}
      >
        <div className="ifc-rotary-dial">
          <svg aria-hidden className="ifc-rotary-base" viewBox="0 0 100 100">
            <defs>
              <pattern
                height="3.2"
                id={hatchId}
                patternTransform="rotate(45)"
                patternUnits="userSpaceOnUse"
                width="3.2"
              >
                <line
                  className="ifc-rotary-hatch-line"
                  x1="0"
                  x2="0"
                  y1="0"
                  y2="3.2"
                />
              </pattern>
            </defs>
            <path className="ifc-rotary-plate" d={PLATE_PATH} />
            <circle className="ifc-rotary-well" cx="50" cy="50" r="27" />
          </svg>

          {items.map((item, index) => {
            const anchor = segmentAnchor(index, items.length);
            const Icon = item.icon;
            const active = activeIndex === index;
            return (
              <button
                aria-expanded={item.children?.length ? active : undefined}
                aria-haspopup={item.children?.length ? "menu" : undefined}
                aria-label={item.label}
                className={`ifc-rotary-segment${active ? " is-active" : ""}`}
                disabled={item.disabled}
                key={item.id}
                role="menuitem"
                style={
                  {
                    clipPath: segmentHitArea(index, items.length),
                    "--ifc-rotary-accent": item.accent ?? "var(--primary)",
                  } as React.CSSProperties
                }
                tabIndex={active ? 0 : -1}
                type="button"
                onClick={() => chooseItem(item, index)}
                onFocus={() => activate(index)}
                onMouseEnter={() => activate(index)}
              >
                <svg
                  aria-hidden
                  className="ifc-rotary-segment-svg"
                  viewBox="0 0 100 100"
                >
                  <path
                    className="ifc-rotary-segment-shape"
                    d={segmentPath(index, items.length)}
                  />
                  <path
                    className="ifc-rotary-segment-hatch"
                    d={segmentPath(index, items.length)}
                    style={{ fill: `url(#${hatchId})` }}
                  />
                </svg>
                <span
                  className="ifc-rotary-segment-icon"
                  style={{ left: `${anchor.x}%`, top: `${anchor.y}%` }}
                >
                  {Icon ? <Icon aria-hidden size={18} /> : null}
                </span>
              </button>
            );
          })}

          <button
            aria-label="Menü schließen"
            className="ifc-rotary-core"
            role="menuitem"
            type="button"
            onClick={onClose}
          >
            <span aria-hidden className="ifc-rotary-core-knob" />
            <CircleX aria-hidden className="ifc-rotary-core-icon" size={20} />
          </button>

          {activeItem ? (
            <div aria-live="polite" className="ifc-rotary-caption">
              {activeItem.label}
            </div>
          ) : null}
        </div>

        {hasFlyout && activeItem ? (
          <div
            aria-label={`${activeItem.label}: Untermenü`}
            className="ifc-rotary-flyout"
            data-side={placement.side}
            role="menu"
          >
            {children.map((child, index) => {
              const ChildIcon = child.icon;
              return (
                <button
                  className="ifc-rotary-flyout-item"
                  data-state={
                    displayChildIndex === index ? "active" : "inactive"
                  }
                  disabled={child.disabled}
                  key={child.id}
                  role="menuitem"
                  style={childStyle(index)}
                  tabIndex={childIndex === index ? 0 : -1}
                  type="button"
                  onClick={() => chooseChild(child, activeItem)}
                  onFocus={() => setChildIndex(index)}
                  onMouseEnter={() => {
                    if (!child.disabled) {
                      setChildIndex(index);
                    }
                  }}
                >
                  {ChildIcon ? (
                    <ChildIcon
                      aria-hidden
                      className="ifc-rotary-flyout-glyph"
                      size={16}
                    />
                  ) : null}
                  <span className="ifc-rotary-flyout-text">
                    <span className="ifc-rotary-flyout-label">
                      {child.label}
                    </span>
                    {child.description ? (
                      <span className="ifc-rotary-flyout-description">
                        {child.description}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
