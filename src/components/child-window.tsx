import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface ChildWindowProps {
  children: React.ReactNode;
  height?: number;
  onClose: () => void;
  title: string;
  width?: number;
}

function copyDocumentStyles(source: Document, target: Document) {
  const head = target.head;
  for (const node of Array.from(
    source.querySelectorAll('link[rel="stylesheet"], style'),
  )) {
    const clone = node.cloneNode(true) as HTMLElement;
    if (clone instanceof HTMLLinkElement && node instanceof HTMLLinkElement) {
      // about:blank has no base URL, so resolve relative hrefs to absolute.
      clone.href = node.href;
    }
    head.appendChild(clone);
  }
}

/**
 * Renders its children into a separate native window via window.open and
 * React portals. The child window shares the parent renderer's memory, so no
 * document data is copied over IPC and nothing is re-parsed. Closing the native
 * window (or unmounting) invokes onClose.
 */
export function ChildWindow({
  children,
  height = 780,
  onClose,
  title,
  width = 1100,
}: ChildWindowProps) {
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const externalWindow = window.open(
      "about:blank",
      "",
      `width=${width},height=${height}`,
    );
    if (!externalWindow) {
      onClose();
      return;
    }

    const externalDocument = externalWindow.document;
    externalDocument.title = title;
    copyDocumentStyles(window.document, externalDocument);

    const syncRootTheme = () => {
      externalDocument.documentElement.className =
        window.document.documentElement.className;
      externalDocument.documentElement.style.colorScheme =
        window.document.documentElement.style.colorScheme;
      externalDocument.documentElement.style.fontSize =
        window.document.documentElement.style.fontSize;
    };
    syncRootTheme();
    externalDocument.body.className = window.document.body.className;
    externalDocument.body.style.margin = "0";

    // Theme-Wechsel (Hell/Dunkel) erreichen das Kindfenster sonst nicht:
    // die .dark-Klasse wird nur am Haupt-documentElement umgeschaltet.
    const themeObserver = new MutationObserver(syncRootTheme);
    themeObserver.observe(window.document.documentElement, {
      attributeFilter: ["class", "style"],
      attributes: true,
    });

    const mount = externalDocument.createElement("div");
    mount.style.height = "100vh";
    mount.style.width = "100vw";
    mount.style.display = "flex";
    mount.style.flexDirection = "column";
    externalDocument.body.appendChild(mount);
    setContainer(mount);

    const handleBeforeUnload = () => {
      onClose();
    };
    externalWindow.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      themeObserver.disconnect();
      externalWindow.removeEventListener("beforeunload", handleBeforeUnload);
      externalWindow.close();
    };
  }, []);

  useEffect(() => {
    if (container) {
      container.ownerDocument.title = title;
    }
  }, [container, title]);

  if (!container) {
    return null;
  }
  return createPortal(children, container);
}
