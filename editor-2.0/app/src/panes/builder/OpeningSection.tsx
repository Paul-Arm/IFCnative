/**
 * Abschnitt „Öffnung": schneidet ein IfcOpeningElement in das ausgewählte
 * Bauteil (IfcRelVoidsElement). Position und Brüstung beziehen sich auf das
 * lokale Koordinatensystem des Bauteils — bei einer Wand des Baukastens
 * läuft die lokale X-Achse entlang der Wand.
 */
import { useState } from "react";
import type { ModelSession } from "../../core/session";
import { useCommands } from "../../commands/pipeline";
import { cmdCreateOpening } from "../../commands/geometryCommands";
import { useSelection } from "../../store/selection";
import {
  DEFAULT_OPENING_PARAMS,
  type CreateOpeningParams,
} from "../../domain/geometry";
import { NumberField, SectionTitle, StatusLine, TextField } from "./fields";

export default function OpeningSection({
  docId,
  session,
  hostId,
}: {
  docId: string;
  session: ModelSession;
  hostId: number;
}) {
  const [params, setParams] = useState<CreateOpeningParams>(
    DEFAULT_OPENING_PARAMS,
  );
  const [status, setStatus] = useState<{ text: string; error?: boolean }>({
    text: "",
  });
  const patch = (next: Partial<CreateOpeningParams>): void =>
    setParams((current) => ({ ...current, ...next }));

  function create(): void {
    try {
      const command = cmdCreateOpening(session, hostId, params);
      useCommands.getState().execute(docId, command);
      const created = command.createdId();
      if (created !== null) useSelection.getState().select(docId, created);
      setStatus({ text: `Öffnung #${created ?? "?"} angelegt.` });
    } catch (error) {
      setStatus({
        text: error instanceof Error ? error.message : String(error),
        error: true,
      });
    }
  }

  return (
    <section>
      <SectionTitle
        title="Öffnung"
        note={`Bauteil: ${session.labelOf(hostId)} — Position entlang der lokalen X-Achse.`}
      />
      <NumberField
        label="Breite"
        value={params.breite}
        onChange={(value) => patch({ breite: value })}
      />
      <NumberField
        label="Höhe"
        value={params.hoehe}
        onChange={(value) => patch({ hoehe: value })}
      />
      <NumberField
        label="Tiefe"
        value={params.tiefe}
        onChange={(value) => patch({ tiefe: value })}
        hint="Durchdringungstiefe quer zum Bauteil"
      />
      <NumberField
        label="Abstand (X)"
        value={params.abstand}
        step={0.1}
        onChange={(value) => patch({ abstand: value })}
      />
      <NumberField
        label="Brüstung (Z)"
        value={params.bruestung}
        step={0.1}
        onChange={(value) => patch({ bruestung: value })}
      />
      <TextField
        label="Name"
        value={params.name}
        placeholder="Öffnung"
        onChange={(value) => patch({ name: value })}
      />
      <button className="btn" onClick={create}>
        Öffnung anlegen
      </button>
      <StatusLine text={status.text} error={status.error} />
    </section>
  );
}
