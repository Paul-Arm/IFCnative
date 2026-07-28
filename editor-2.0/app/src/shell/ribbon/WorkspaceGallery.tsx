/**
 * Workspace-Wechsler im Register „Ansicht" — kompaktes Dropdown im Stil der
 * ersten React-App: eingebaute und eigene Arbeitsbereiche in einem Menü, der
 * aktive ist markiert. Das Menü hängt als Portal am <body> (DropMenu), weil
 * die Befehlsleiste per overflow clippt. Sichern/Löschen bleiben als eigene
 * Schalter daneben (AnsichtTab).
 */
import { useCallback, useRef, useState } from "react";
import { BUILTIN_WORKSPACE_NAMES } from "../../panes/workspaces";
import { useUi } from "../../store/ui";
import { DropMenu } from "./DropMenu";
import { IconChevronDown, IconWorkspace } from "./icons";

export function WorkspaceGallery() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  const workspaceName = useUi((s) => s.workspaceName);
  const customWorkspaces = useUi((s) => s.customWorkspaces);
  const switchWorkspace = useUi((s) => s.switchWorkspace);

  const pick = (name: string) => {
    switchWorkspace(name);
    setOpen(false);
  };

  const item = (name: string) => (
    <button
      key={name}
      type="button"
      role="menuitem"
      className="tb-menu-item"
      data-active={name === workspaceName ? "true" : undefined}
      onClick={() => pick(name)}
    >
      <span className="tb-menu-item-text">{name}</span>
      <span className="tb-menu-check" aria-hidden="true">
        {name === workspaceName ? "✓" : ""}
      </span>
    </button>
  );

  return (
    <div className="tb-menu-box" ref={box}>
      <button
        type="button"
        className="tb-btn tb-btn-outline tb-workspace"
        title="Arbeitsbereich wechseln"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <IconWorkspace className="tb-icon" />
        <span className="tb-btn-text">{workspaceName}</span>
        <IconChevronDown className="tb-icon-xs" />
      </button>
      <DropMenu anchorRef={box} open={open} onDismiss={close}>
        <div className="tb-menu-heading">Arbeitsbereiche</div>
        {BUILTIN_WORKSPACE_NAMES.map(item)}
        {customWorkspaces.length > 0 ? (
          <>
            <div className="tb-menu-separator" />
            <div className="tb-menu-heading">Eigene</div>
            {customWorkspaces.map((w) => item(w.name))}
          </>
        ) : null}
      </DropMenu>
    </div>
  );
}
