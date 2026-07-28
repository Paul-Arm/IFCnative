/**
 * Abschnitt „Auswahl bearbeiten": Maße der Extrusion des ausgewählten
 * Bauteils (XDim/YDim bzw. Radius am Profil, Depth am Solid) und eine
 * Verschiebung um dx/dy/dz.
 *
 * Die Anzeige hängt an `useDocRevision`, damit Undo/Redo und Änderungen aus
 * anderen Panes sofort sichtbar sind.
 */
import { useEffect, useMemo, useState } from "react";
import type { ModelSession } from "../../core/session";
import { useCommands, useDocRevision } from "../../commands/pipeline";
import {
  cmdMoveElement,
  cmdUpdateDimensions,
} from "../../commands/geometryCommands";
import { findExtrusion, findPlacementPoint } from "../../domain/geometry";
import { NumberField, SectionTitle, StatusLine } from "./fields";

interface DimState {
  xDim: number;
  yDim: number;
  radius: number;
  depth: number;
}

export default function EditSection({
  docId,
  session,
  expressId,
}: {
  docId: string;
  session: ModelSession;
  expressId: number;
}) {
  const revision = useDocRevision(docId);
  const context = useMemo(
    () => ({ store: session.store, view: session.view }),
    [session],
  );
  const info = useMemo(
    () => findExtrusion(context, expressId),
    [context, expressId, revision],
  );
  const placement = useMemo(
    () => findPlacementPoint(context, expressId),
    [context, expressId, revision],
  );

  const [dims, setDims] = useState<DimState>({
    xDim: 0,
    yDim: 0,
    radius: 0,
    depth: 0,
  });
  const [delta, setDelta] = useState({ dx: 0, dy: 0, dz: 0 });
  const [status, setStatus] = useState<{ text: string; error?: boolean }>({
    text: "",
  });

  useEffect(() => {
    setDims({
      xDim: info?.xDim ?? 0,
      yDim: info?.yDim ?? 0,
      radius: info?.radius ?? 0,
      depth: info?.depth ?? 0,
    });
    setStatus({ text: "" });
  }, [info?.elementId, info?.xDim, info?.yDim, info?.radius, info?.depth]);

  function run(build: () => ReturnType<typeof cmdMoveElement>): void {
    try {
      const command = build();
      useCommands.getState().execute(docId, command);
      setStatus({ text: command.label });
    } catch (error) {
      setStatus({
        text: error instanceof Error ? error.message : String(error),
        error: true,
      });
    }
  }

  if (!info) {
    return (
      <section>
        <SectionTitle title="Auswahl bearbeiten" />
        <p className="text-dim" style={{ fontSize: "0.8rem" }}>
          {session.labelOf(expressId)} hat keinen parametrischen
          Extrusionskörper — Maße sind nur an IfcExtrudedAreaSolid änderbar.
        </p>
      </section>
    );
  }

  const isRect = info.profile.type === "IFCRECTANGLEPROFILEDEF";
  const isCircle = info.profile.type === "IFCCIRCLEPROFILEDEF";

  return (
    <section>
      <SectionTitle
        title="Auswahl bearbeiten"
        note={`${session.labelOf(expressId)} · Profil ${info.profile.type} #${info.profile.expressId} · Körper #${info.solid.expressId}`}
      />

      {isRect && (
        <>
          <NumberField
            label="Breite (XDim)"
            value={dims.xDim}
            onChange={(value) => setDims({ ...dims, xDim: value })}
          />
          <NumberField
            label="Tiefe (YDim)"
            value={dims.yDim}
            onChange={(value) => setDims({ ...dims, yDim: value })}
          />
        </>
      )}
      {isCircle && (
        <NumberField
          label="Radius"
          value={dims.radius}
          onChange={(value) => setDims({ ...dims, radius: value })}
        />
      )}
      {!isRect && !isCircle && (
        <p className="text-dim" style={{ fontSize: "0.75rem" }}>
          Profiltyp {info.profile.type} ist nicht parametrisch editierbar —
          nur die Extrusionslänge lässt sich ändern.
        </p>
      )}
      <NumberField
        label="Extrusion (Depth)"
        value={dims.depth}
        onChange={(value) => setDims({ ...dims, depth: value })}
      />
      <button
        className="btn"
        onClick={() =>
          run(() =>
            cmdUpdateDimensions(session, expressId, {
              xDim: isRect ? dims.xDim : undefined,
              yDim: isRect ? dims.yDim : undefined,
              radius: isCircle ? dims.radius : undefined,
              depth: dims.depth,
            }),
          )
        }
      >
        Maße übernehmen
      </button>

      <SectionTitle
        title="Verschieben"
        note={
          placement
            ? `Aktuelle Position: ${placement.coords.map((v) => v.toFixed(3)).join(" / ")} m`
            : "Keine verschiebbare Platzierung gefunden."
        }
      />
      <NumberField
        label="Δ X"
        value={delta.dx}
        step={0.1}
        onChange={(value) => setDelta({ ...delta, dx: value })}
      />
      <NumberField
        label="Δ Y"
        value={delta.dy}
        step={0.1}
        onChange={(value) => setDelta({ ...delta, dy: value })}
      />
      <NumberField
        label="Δ Z"
        value={delta.dz}
        step={0.1}
        onChange={(value) => setDelta({ ...delta, dz: value })}
      />
      <button
        className="btn"
        disabled={!placement}
        onClick={() =>
          run(() =>
            cmdMoveElement(session, expressId, delta.dx, delta.dy, delta.dz),
          )
        }
      >
        Verschieben
      </button>

      <StatusLine text={status.text} error={status.error} />
    </section>
  );
}
