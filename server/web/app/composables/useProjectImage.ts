/**
 * Projektbilder (Szenen-Screenshots) mit Auth laden und als Object-URL
 * zwischenspeichern — Dashboard, Projektliste und Projektkopf teilen sich
 * denselben Cache, jedes Bild wird nur einmal geholt.
 */
const cache = reactive(new Map<string, string | null>());
const inflight = new Map<string, Promise<void>>();

export function useProjectImage() {
  const { token } = useAuth();

  function load(slug: string, force = false): void {
    if (!import.meta.client) return;
    if (!force && (cache.has(slug) || inflight.has(slug))) return;
    const request = $fetch<Blob>(`/api/projects/${slug}/image`, {
      responseType: "blob",
      headers: token.value ? { authorization: `Bearer ${token.value}` } : {},
      query: force ? { t: Date.now() } : undefined,
    })
      .then((blob) => {
        const previous = cache.get(slug);
        if (previous) URL.revokeObjectURL(previous);
        cache.set(slug, URL.createObjectURL(blob));
      })
      .catch(() => {
        cache.set(slug, null);
      })
      .finally(() => inflight.delete(slug));
    inflight.set(slug, request);
  }

  function imageFor(slug: string): string | null {
    return cache.get(slug) ?? null;
  }

  function forget(slug: string): void {
    const previous = cache.get(slug);
    if (previous) URL.revokeObjectURL(previous);
    cache.delete(slug);
  }

  return { load, imageFor, forget };
}
