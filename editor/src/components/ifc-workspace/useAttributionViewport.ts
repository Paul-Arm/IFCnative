import { useLayoutEffect, useRef, useState } from "react";
import { ATTRIBUTION_ROW_HEIGHT, virtualRowRange } from "@/ifc/attribution/tableViewport";

export function useAttributionViewport(count: number, view: string, resetKey: string) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState(() => virtualRowRange(count, 0, 600, 64));
  const updateRef = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    let frame = 0;
    const update = () => {
      const next = virtualRowRange(count, element.scrollTop, element.clientHeight, element.querySelector("thead")?.offsetHeight ?? 64);
      setRange((current) => current.start === next.start && current.end === next.end ? current : next);
    };
    updateRef.current = update;
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; update(); });
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    const header = element.querySelector("thead");
    if (header) observer.observe(header);
    element.addEventListener("scroll", schedule, { passive: true });
    update();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); element.removeEventListener("scroll", schedule); updateRef.current = () => {}; };
  }, [count, view]);
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    updateRef.current();
  }, [resetKey]);

  const revealRow = (index: number) => {
    const element = scrollRef.current;
    if (!element) return;
    const available = element.clientHeight - (element.querySelector("thead")?.offsetHeight ?? 64);
    const top = index * ATTRIBUTION_ROW_HEIGHT;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + ATTRIBUTION_ROW_HEIGHT > element.scrollTop + available) element.scrollTop = top + ATTRIBUTION_ROW_HEIGHT - available;
    updateRef.current();
  };
  return { scrollRef, range, revealRow };
}
