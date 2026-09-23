/**
 * Gemeinsamer Minutentakt für relative Zeitangaben — ein Intervall für die
 * ganze App statt eines Timers je <RelTime>.
 */
let timer: ReturnType<typeof setInterval> | null = null;

export function useNow() {
  const now = useState<number>("hub:now", () => Date.now());
  if (import.meta.client && !timer) {
    timer = setInterval(() => {
      now.value = Date.now();
    }, 30_000);
  }
  return now;
}
