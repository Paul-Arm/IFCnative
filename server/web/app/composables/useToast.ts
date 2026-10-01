/**
 * Kurze Rückmeldungen unten links („Gespeichert“, „Fehler: …“) statt
 * dauerhafter Alert-Boxen. Gerendert von <ToastHost> im App-Root.
 */

export type ToastKind = "success" | "error" | "info";

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  /** Optionaler Link („Öffnen“) hinter der Meldung. */
  action?: { label: string; to: string };
}

let nextId = 1;

export function useToast() {
  const toasts = useState<Toast[]>("hub:toasts", () => []);

  function dismiss(id: number): void {
    toasts.value = toasts.value.filter((toast) => toast.id !== id);
  }

  function push(
    kind: ToastKind,
    message: string,
    options: { action?: Toast["action"]; duration?: number } = {},
  ): void {
    const id = nextId++;
    toasts.value = [...toasts.value.slice(-3), { id, kind, message, action: options.action }];
    const duration = options.duration ?? (kind === "error" ? 7000 : 4000);
    if (import.meta.client && duration > 0) {
      setTimeout(() => dismiss(id), duration);
    }
  }

  return {
    toasts,
    dismiss,
    success: (message: string, options?: { action?: Toast["action"]; duration?: number }) =>
      push("success", message, options),
    error: (message: string, options?: { action?: Toast["action"]; duration?: number }) =>
      push("error", message, options),
    info: (message: string, options?: { action?: Toast["action"]; duration?: number }) =>
      push("info", message, options),
  };
}
