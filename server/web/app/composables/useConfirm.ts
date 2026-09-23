/**
 * Bestätigungsdialog als Promise — Ersatz für window.confirm(), das in
 * eingebetteten Browsern/WebViews blockiert ist und nicht zum Design passt.
 *
 *   if (!(await confirm({ title: "Ordner löschen?", danger: true }))) return;
 *
 * `typeToConfirm` verlangt die Eingabe eines Textes (z. B. Projekt-Slug)
 * vor unwiderruflichen Aktionen — wie GitHubs „Danger Zone“.
 */

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  typeToConfirm?: string;
}

interface ConfirmState extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

export function useConfirm() {
  const state = useState<ConfirmState | null>("hub:confirm", () => null);

  function confirm(options: ConfirmOptions): Promise<boolean> {
    // Ein noch offener Dialog gilt als abgebrochen.
    state.value?.resolve(false);
    return new Promise((resolve) => {
      state.value = { ...options, resolve };
    });
  }

  function settle(value: boolean): void {
    const current = state.value;
    state.value = null;
    current?.resolve(value);
  }

  return { state, confirm, settle };
}
