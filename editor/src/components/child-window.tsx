import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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

interface DocumentPictureInPicture {
  requestWindow(options?: { height?: number; width?: number }): Promise<Window>;
  window: Window | null;
}

declare global {
  interface Window {
    documentPictureInPicture?: DocumentPictureInPicture;
  }
}

/**
 * Renders its children into a separate native window via window.open and
 * React portals. The child window shares the parent renderer's memory, so no
 * document data is copied over IPC and nothing is re-parsed. Closing the native
 * window (or unmounting) invokes onClose.
 *
 * In environments where window.open is blocked (e.g. Tauri/wry), the
 * Document Picture-in-Picture API is tried next (real OS window, same JS
 * context, can be dragged to another monitor). If that is unavailable too,
 * a floating in-app panel is rendered instead so pop-outs keep working.
 */
export function ChildWindow({
  children,
  height = 780,
  onClose,
  title,
  width = 1100,
}: ChildWindowProps) {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | null = null;

    const adoptWindow = (
      externalWindow: Window,
      closeEvent: "beforeunload" | "pagehide",
    ) => {
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

      const handleClose = () => {
        onClose();
      };
      externalWindow.addEventListener(closeEvent, handleClose);

      cleanup = () => {
        themeObserver.disconnect();
        externalWindow.removeEventListener(closeEvent, handleClose);
        externalWindow.close();
      };
    };

    const externalWindow = window.open(
      "about:blank",
      "",
      `width=${width},height=${height}`,
    );
    if (externalWindow) {
      adoptWindow(externalWindow, "beforeunload");
    } else {
      // Tauri (wry) blocks window.open. Try Document Picture-in-Picture: a
      // real OS window in the same JS context that can be moved to another
      // monitor. Only one PiP window can exist at a time.
      const pip = window.documentPictureInPicture;
      if (pip && !pip.window) {
        pip
          .requestWindow({ height, width })
          .then((pipWindow) => {
            if (disposed) {
              pipWindow.close();
              return;
            }
            adoptWindow(pipWindow, "pagehide");
          })
          .catch(() => {
            if (!disposed) {
              setBlocked(true);
            }
          });
      } else {
        setBlocked(true);
      }
    }

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    if (container) {
      container.ownerDocument.title = title;
    }
  }, [container, title]);

  if (blocked) {
    return (
      <FloatingPanel
        height={height}
        title={title}
        width={width}
        onClose={onClose}
      >
        {children}
      </FloatingPanel>
    );
  }

  if (!container) {
    return null;
  }
  return createPortal(children, container);
}

interface FloatingPanelProps {
  children: React.ReactNode;
  height: number;
  onClose: () => void;
  title: string;
  width: number;
}

/**
 * Draggable, resizable in-app panel used as a pop-out fallback when native
 * child windows are unavailable.
 */
function FloatingPanel({
  children,
  height,
  onClose,
  title,
  width,
}: FloatingPanelProps) {
  const panelWidth = Math.min(width, Math.max(320, window.innerWidth - 48));
  const panelHeight = Math.min(height, Math.max(240, window.innerHeight - 48));
  const [position, setPosition] = useState(() => ({
    x: Math.max(12, (window.innerWidth - panelWidth) / 2),
    y: Math.max(12, (window.innerHeight - panelHeight) / 2),
  }));
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragState = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragState.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = dragState.current;
    if (!state || state.pointerId !== event.pointerId) {
      return;
    }
    const panel = panelRef.current;
    const panelW = panel?.offsetWidth ?? panelWidth;
    const nextX = state.originX + event.clientX - state.startX;
    const nextY = state.originY + event.clientY - state.startY;
    setPosition({
      x: Math.min(Math.max(nextX, 8 - panelW + 80), window.innerWidth - 80),
      y: Math.min(Math.max(nextY, 0), window.innerHeight - 40),
    });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragState.current?.pointerId === event.pointerId) {
      dragState.current = null;
    }
  };

  return createPortal(
    <div
      ref={panelRef}
      className="fixed z-50 flex flex-col overflow-hidden rounded-lg border bg-background text-foreground shadow-2xl"
      style={{
        height: panelHeight,
        left: position.x,
        maxHeight: `calc(100vh - 16px)`,
        maxWidth: `calc(100vw - 16px)`,
        minHeight: 200,
        minWidth: 280,
        resize: "both",
        top: position.y,
        width: panelWidth,
      }}
    >
      <div
        className="flex shrink-0 cursor-move select-none items-center justify-between gap-2 border-b bg-muted/60 px-3 py-1.5"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <span className="truncate text-xs font-medium">{title}</span>
        <button
          aria-label={`${title} schließen`}
          className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Zurück ins Hauptfenster"
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onClose}
        >
          <X aria-hidden className="size-3.5" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {children}
      </div>
    </div>,
    document.body,
  );
}
