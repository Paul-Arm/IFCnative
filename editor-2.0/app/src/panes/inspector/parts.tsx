/**
 * Kleine Bausteine, die sich alle Inspector-Abschnitte teilen.
 * Bewusst ohne eigenes CSS — nur Token aus global.css.
 */
import type { ReactNode } from "react";

export function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        padding: "10px 8px 4px",
        fontWeight: 600,
        fontSize: "0.8125rem",
      }}
    >
      {children}
    </div>
  );
}

/** Leerer Wert wird gedimmt als Gedankenstrich dargestellt. */
export function DimValue({ value }: { value: string }) {
  if (!value) return <span className="text-dim">—</span>;
  return <>{value}</>;
}
