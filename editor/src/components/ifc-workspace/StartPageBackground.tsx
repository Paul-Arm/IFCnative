import { useEffect, useRef } from "react";

import { CONSTELLATIONS } from "./startPageGeometry";
import { createStartPageRenderer } from "./startPageRenderer";

export function StartPageBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = createStartPageRenderer(canvas);
    if (!renderer) return;

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const proximity = CONSTELLATIONS.map(() => 0);
    let pointer: { x: number; y: number } | null = null;
    let frame = 0;
    let previous = 0;
    let elapsed = 0;

    const clearPointer = () => { pointer = null; };
    const move = (event: PointerEvent) => {
      if (event.pointerType === "touch" || !(event.target instanceof Element)
        || !event.target.closest(".start-page-workspace")
        || event.target.closest("section, button, input, [role=dialog]")) {
        clearPointer();
        return;
      }
      pointer = { x: event.clientX, y: event.clientY };
    };
    const leave = (event: PointerEvent) => { if (!event.relatedTarget) clearPointer(); };

    const render = (dt: number) => {
      const reduced = motion.matches;
      const mouse = !reduced && pointer ? renderer.pointer(pointer.x, pointer.y) : null;
      CONSTELLATIONS.forEach((config, group) => {
        const float = reduced ? 0 : Math.sin(elapsed * 0.3 + group * 2) * 10;
        const distance = mouse ? Math.hypot(mouse.x - config.x, mouse.y - config.y - float) : Infinity;
        const target = Math.max(0, Math.min(1, 1 - (distance - config.size * 0.35) / (config.size * 1.65)));
        const next = reduced ? 0 : proximity[group] + (target - proximity[group]) * (1 - Math.exp(-dt * 5));
        // Settle exactly at rest so stationary geometry can reuse its bitmap.
        proximity[group] = Math.abs(next - target) < 0.001 ? target : next;
      });
      renderer.draw(elapsed, proximity, reduced);
    };

    const tick = (now: number) => {
      frame = window.requestAnimationFrame(tick);
      if (!previous) { previous = now; return; }
      const delta = now - previous;
      if (delta < 1000 / 30 - 0.5) return;
      const dt = Math.min(delta / 1000, 0.1);
      previous = now;
      elapsed += dt;
      render(dt);
    };

    const refresh = () => {
      renderer.resize();
      render(0);
    };
    const syncMotion = () => {
      window.cancelAnimationFrame(frame);
      previous = 0;
      clearPointer();
      if (motion.matches) render(0);
      else if (!document.hidden) frame = window.requestAnimationFrame(tick);
    };
    const resize = new ResizeObserver(refresh);
    resize.observe(canvas);
    // Rebuild material sprites when the editor changes light/dark theme.
    const theme = new MutationObserver(refresh);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });

    window.addEventListener("resize", refresh);
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerout", leave, { passive: true });
    window.addEventListener("blur", clearPointer);
    window.addEventListener("dragstart", clearPointer);
    motion.addEventListener("change", syncMotion);
    document.addEventListener("visibilitychange", syncMotion);
    refresh();
    syncMotion();

    return () => {
      window.cancelAnimationFrame(frame);
      resize.disconnect();
      theme.disconnect();
      window.removeEventListener("resize", refresh);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerout", leave);
      window.removeEventListener("blur", clearPointer);
      window.removeEventListener("dragstart", clearPointer);
      motion.removeEventListener("change", syncMotion);
      document.removeEventListener("visibilitychange", syncMotion);
      renderer.dispose();
    };
  }, []);

  return (
    <div aria-hidden="true" className="start-page-background">
      <div className="start-page-glow start-page-glow--teal" />
      <div className="start-page-glow start-page-glow--blue" />
      <div className="start-page-grid" />
      <canvas ref={canvasRef} className="start-page-geometry" />
    </div>
  );
}