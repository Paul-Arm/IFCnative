/**
 * Modus „Platzierung": zeigt die ObjectPlacement-Kette und die Extrusionsdaten
 * des ausgewählten Objekts — ausschließlich LESEND.
 *
 * Die Werte kommen aus `placementRead.ts`; jede Zahl trägt dort ihre
 * Record-Adresse (Entity + positionaler Attributindex + Komponente) mit. Sie
 * steht als Tooltip an der Zeile und ist der Andockpunkt für die Editierfelder,
 * die mit den Geometrie-Commands nachgereicht werden — die Zeilenstruktur muss
 * dafür nicht mehr angefasst werden. Aktualität (Befund 5): Das Memo hängt an
 * `useDocRevision(docId)`, der Revision, die bei do, undo UND redo steigt.
 */
import { useMemo, type ReactNode } from "react";
import { useDocRevision } from "../../commands/pipeline";
import type { ModelSession } from "../../core/session";
import { SectionHeading } from "./parts";
import {
  readPlacement,
  toMeters,
  type CoordinateSet,
  type ExtrusionInfo,
  type NumericSlot,
  type PlacementLink,
} from "./placementRead";

interface PlacementSectionProps {
  docId: string;
  session: ModelSession;
  expressId: number;
}

const UNITS = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 6 });
const METER_DIGITS = { minimumFractionDigits: 3, maximumFractionDigits: 3 };
const METERS = new Intl.NumberFormat("de-DE", METER_DIGITS);
const AXES = ["X", "Y", "Z"];

const formatVector = (values: readonly number[]): string =>
  `(${values.map((v) => UNITS.format(v)).join(" | ")})`;

/** Record-Adresse als Tooltip — später die Zieladresse des Editierfelds. */
const slotTitle = (slot: NumericSlot): string =>
  `#${slot.expressId} · Attribut ${slot.index}` +
  (slot.component === null ? "" : `, Komponente ${slot.component}`);

export default function PlacementSection({
  docId,
  session,
  expressId,
}: PlacementSectionProps) {
  const revision = useDocRevision(docId);
  const reading = useMemo(
    () => readPlacement(session, expressId),
    [session, expressId, revision],
  );
  const scale = reading.lengthUnitScale;

  return (
    <div>
      <SectionHeading>Platzierung</SectionHeading>
      <table className="kv-table">
        <tbody>
          <tr>
            <td className="dim">ObjectPlacement</td>
            <td>
              {reading.objectPlacementId === null
                ? "—"
                : `#${reading.objectPlacementId}`}
            </td>
          </tr>
          <tr>
            <td className="dim">Längeneinheit</td>
            <td>1 Modelleinheit = {UNITS.format(scale)} m</td>
          </tr>
        </tbody>
      </table>

      {reading.note && (
        <p className="text-dim" style={{ padding: "6px 8px", margin: 0 }}>
          {reading.note}
        </p>
      )}

      {reading.chain.map((link) => (
        <ChainBlock key={link.expressId} link={link} scale={scale} />
      ))}

      {reading.chainSum && (
        <>
          <SectionHeading>
            Kettensumme{" "}
            <span className="text-dim">— nur Versätze, ohne Rotationen</span>
          </SectionHeading>
          <ValueTable>
            {reading.chainSum.map((value, i) => (
              <LengthRow
                key={i}
                label={AXES[i] ?? `K${i + 1}`}
                value={value}
                scale={scale}
              />
            ))}
          </ValueTable>
        </>
      )}

      <SectionHeading>
        Extrusion <span className="text-dim">({reading.extrusions.length})</span>
      </SectionHeading>
      {reading.extrusions.length > 0 ? (
        reading.extrusions.map((extrusion) => (
          <ExtrusionBlock
            key={extrusion.expressId}
            extrusion={extrusion}
            scale={scale}
          />
        ))
      ) : reading.representations.length === 0 ? (
        <p className="pane-empty">Keine Repräsentation für dieses Objekt.</p>
      ) : (
        <ValueTable>
          {reading.representations.map((rep) => (
            <tr key={rep.expressId}>
              <td className="dim">#{rep.expressId}</td>
              <td colSpan={2}>
                {rep.identifier || "—"} / {rep.representationType || "—"} (
                {rep.itemCount} Elemente)
              </td>
            </tr>
          ))}
        </ValueTable>
      )}
    </div>
  );
}

function ChainBlock({ link, scale }: { link: PlacementLink; scale: number }) {
  return (
    <>
      <SectionHeading>
        {link.depth === 0
          ? "Eigene Platzierung"
          : `Übergeordnet (Ebene ${link.depth})`}{" "}
        <span className="text-dim">
          {link.ifcClass} #{link.expressId}
        </span>
      </SectionHeading>
      <ValueTable>
        <TextRow
          label="RelativePlacement"
          text={
            link.relativeClass
              ? `${link.relativeClass} #${link.relativeId ?? "?"}`
              : "—"
          }
        />
        <CoordinateRows label="Location" coordinates={link.location} scale={scale} />
        {link.axis && <TextRow label="Axis" text={formatVector(link.axis)} />}
        {link.refDirection && (
          <TextRow label="RefDirection" text={formatVector(link.refDirection)} />
        )}
      </ValueTable>
    </>
  );
}

function ExtrusionBlock({
  extrusion,
  scale,
}: {
  extrusion: ExtrusionInfo;
  scale: number;
}) {
  const { representation: rep, profile } = extrusion;
  return (
    <>
      <SectionHeading>
        {extrusion.ifcClass}{" "}
        <span className="text-dim">#{extrusion.expressId}</span>
      </SectionHeading>
      <ValueTable>
        <TextRow
          label="Repräsentation"
          text={`${rep.identifier || "—"} / ${rep.representationType || "—"} (#${rep.expressId})`}
        />
        {extrusion.depth && (
          <LengthRow
            label={extrusion.depth.label}
            value={extrusion.depth.value}
            scale={scale}
            title={slotTitle(extrusion.depth)}
          />
        )}
        {extrusion.direction && (
          <TextRow label="Richtung" text={formatVector(extrusion.direction)} />
        )}
        <CoordinateRows
          label="Position"
          coordinates={extrusion.position}
          scale={scale}
        />
        <TextRow
          label="Profil"
          text={
            profile
              ? `${profile.ifcClass} #${profile.expressId}` +
                (profile.profileType ? ` (${profile.profileType})` : "") +
                (profile.name ? ` ‚${profile.name}'` : "")
              : "—"
          }
        />
        {profile?.dimensions.map((slot) => (
          <LengthRow
            key={slot.label}
            label={`· ${slot.label}`}
            value={slot.value}
            scale={scale}
            title={slotTitle(slot)}
          />
        ))}
        {profile?.unknownDimensions && (
          <TextRow label="Maße" text="Profilklasse ohne hinterlegte Maßtabelle." />
        )}
      </ValueTable>
    </>
  );
}

function ValueTable({ children }: { children: ReactNode }) {
  return (
    <table className="kv-table">
      <thead>
        <tr>
          <th style={{ width: "40%" }}>Wert</th>
          <th>Modelleinheit</th>
          <th>Meter</th>
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

function CoordinateRows({
  label,
  coordinates,
  scale,
}: {
  label: string;
  coordinates: CoordinateSet | null;
  scale: number;
}) {
  if (!coordinates) return <TextRow label={label} text="—" />;
  return (
    <>
      <TextRow
        label={label}
        text={`${coordinates.ifcClass} #${coordinates.expressId}`}
      />
      {coordinates.slots.map((slot) => (
        <LengthRow
          key={slot.label}
          label={`· ${slot.label}`}
          value={slot.value}
          scale={scale}
          title={slotTitle(slot)}
        />
      ))}
    </>
  );
}

function TextRow({ label, text }: { label: string; text: string }) {
  return (
    <tr>
      <td className="dim">{label}</td>
      <td colSpan={2}>{text}</td>
    </tr>
  );
}

function LengthRow({
  label,
  value,
  scale,
  title,
}: {
  label: string;
  value: number;
  scale: number;
  title?: string;
}) {
  return (
    <tr title={title}>
      <td className="dim">{label}</td>
      <td>{UNITS.format(value)}</td>
      <td className="dim">{METERS.format(toMeters(value, scale))} m</td>
    </tr>
  );
}
