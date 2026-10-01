import type { Ref } from "vue";

/**
 * Fokusfalle für modale Ebenen (Dialoge, Befehlspalette): Tab und
 * Shift+Tab bleiben in der Ebene, Fokus, der nach außen wandert (z. B. nach
 * Klick auf den Hintergrund), wird zurückgeholt, und beim Schließen kehrt er
 * zum auslösenden Element zurück. Ebenen stapeln sich — nur die oberste
 * greift (Bestätigungsdialog über einem Dialog).
 */
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const stack: HTMLElement[] = [];

function top(): HTMLElement | undefined {
  return stack[stack.length - 1];
}

function onFocusIn(event: FocusEvent): void {
  const layer = top();
  const target = event.target as Node | null;
  if (layer && target && !layer.contains(target)) layer.focus();
}

function onKeydown(event: KeyboardEvent): void {
  const layer = top();
  if (!layer || event.key !== "Tab") return;
  const items = [...layer.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.getClientRects().length > 0,
  );
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) {
    event.preventDefault();
    layer.focus();
    return;
  }
  const active = document.activeElement;
  const atStart = active === first || active === layer;
  if (event.shiftKey ? atStart : active === last) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}

export function useFocusTrap(root: Ref<HTMLElement | null>, active: () => boolean): void {
  if (!import.meta.client) return;
  let layer: HTMLElement | null = null;
  let previous: HTMLElement | null = null;

  function release(): void {
    if (!layer) return;
    const index = stack.indexOf(layer);
    if (index >= 0) stack.splice(index, 1);
    layer = null;
    if (!stack.length) {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeydown);
    }
    if (previous?.isConnected) previous.focus({ preventScroll: true });
    previous = null;
  }

  watch(
    [active, root],
    ([isActive, element]) => {
      if (!isActive || !element) {
        release();
        return;
      }
      if (element === layer) return;
      if (layer) {
        // Neu gerendertes Panel übernimmt den Platz im Stapel.
        const index = stack.indexOf(layer);
        if (index >= 0) stack[index] = element;
        layer = element;
        return;
      }
      previous = document.activeElement as HTMLElement | null;
      layer = element;
      if (!stack.length) {
        document.addEventListener("focusin", onFocusIn);
        document.addEventListener("keydown", onKeydown);
      }
      stack.push(element);
    },
    { flush: "post", immediate: true },
  );

  onBeforeUnmount(release);
}
