/**
 * Anmeldung/Registrierung am IFC Hub. Einzige Stelle im Editor, an der
 * Zugangsdaten eingegeben werden — das Hub-Panel verlinkt nur noch hierher
 * (zentrale Einstellungen). Der Hub-Browser auf der Startseite bindet dasselbe
 * Formular ein, damit gemerkte Zugangsdaten überall greifen.
 */

import { Loader2, LogIn, LogOut, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { VcsApiClient, VcsApiError } from "@/vcs/client";
import type { VcsAuth, VcsSettings } from "@/vcs/types";

import {
  Badge,
  Button,
  CheckboxField,
  InlineAlert,
  LabeledInput,
  SegmentedControl,
} from "./ui";
import {
  clearVcsCredentials,
  loadVcsCredentials,
  saveVcsCredentials,
} from "./workspaceStorage";

export interface HubAuthFormProps {
  settings: VcsSettings;
  auth: VcsAuth | null;
  onAuthChange: (auth: VcsAuth | null) => void;
  /** Externe Sperre, z. B. während eine Datei lädt. */
  busy?: boolean;
  /** Aufräumen nach dem Abmelden (Projektlisten leeren o. Ä.). */
  onSignedOut?: () => void;
}

function errorMessage(error: unknown): string {
  if (error instanceof VcsApiError) {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export function HubAuthForm({
  settings,
  auth,
  onAuthChange,
  busy: externalBusy = false,
  onSignedOut,
}: HubAuthFormProps) {
  const client = useMemo(
    () => new VcsApiClient(settings, auth),
    [settings, auth],
  );

  const stored = useMemo(() => loadVcsCredentials(), []);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState(stored.email);
  const [name, setName] = useState(stored.name);
  const [password, setPassword] = useState(stored.password);
  const [remember, setRemember] = useState(stored.remember);
  const [authBusy, setAuthBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    setAuthBusy(true);
    try {
      const nextAuth =
        authMode === "login"
          ? await client.login(email.trim(), password)
          : await client.register(
              email.trim(),
              name.trim() || email.trim(),
              password,
            );
      // Erst nach erfolgreicher Anmeldung merken — falsch getippte Daten
      // sollen nicht dauerhaft im Formular kleben bleiben.
      saveVcsCredentials({
        email: email.trim(),
        name: nextAuth.user.name || name.trim(),
        password,
        remember,
      });
      setName(nextAuth.user.name || name.trim());
      if (!remember) {
        setPassword("");
      }
      onAuthChange(nextAuth);
    } catch (loginError) {
      setError(errorMessage(loginError));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleRememberChange = (checked: boolean) => {
    setRemember(checked);
    // Abwählen löscht ein bereits gespeichertes Passwort sofort mit.
    saveVcsCredentials({ email, name, password, remember: checked });
  };

  const handleForget = () => {
    clearVcsCredentials();
    setEmail("");
    setName("");
    setPassword("");
    setRemember(false);
  };

  const busy = externalBusy || authBusy;

  if (auth) {
    return (
      <div className="grid gap-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-col">
            <span className="flex items-center gap-2 text-sm font-medium text-foreground">
              {auth.user.name}
              <Badge tone="success">Angemeldet</Badge>
            </span>
            <span className="truncate text-[11px] text-muted-foreground">
              {auth.user.email}
            </span>
          </div>
          <Button
            disabled={busy}
            title="Vom IFC Hub abmelden"
            onClick={() => {
              onAuthChange(null);
              onSignedOut?.();
            }}
          >
            <LogOut aria-hidden className="size-3.5" />
            Abmelden
          </Button>
        </div>
        <CheckboxField
          checked={remember}
          description="E-Mail und Passwort für die nächste Anmeldung merken. Das Passwort liegt dabei unverschlüsselt im Browser-Speicher dieses Rechners."
          label="Zugangsdaten auf diesem Rechner speichern"
          onCheckedChange={handleRememberChange}
        />
        <div>
          <Button
            disabled={busy}
            title="Gemerkte E-Mail und Passwort von diesem Rechner löschen"
            onClick={handleForget}
          >
            <Trash2 aria-hidden className="size-3.5" />
            Gespeicherte Zugangsdaten löschen
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      {/* Moduswechsel als Tabs — bewusst KEIN Button, damit er nicht mit dem
          Absenden-Button darunter verwechselt wird. */}
      <SegmentedControl
        options={[
          { label: "Anmelden", value: "login" },
          { label: "Registrieren", value: "register" },
        ]}
        value={authMode}
        onChange={(mode) => setAuthMode(mode as "login" | "register")}
      />
      <LabeledInput label="E-Mail" value={email} onChangeText={setEmail} />
      {authMode === "register" ? (
        <LabeledInput label="Name" value={name} onChangeText={setName} />
      ) : null}
      <label className="grid min-w-0 gap-1.5 text-xs text-muted-foreground">
        Passwort
        <Input
          autoComplete={
            authMode === "login" ? "current-password" : "new-password"
          }
          className="text-foreground"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && email.trim() && password && !busy) {
              void handleSubmit();
            }
          }}
        />
      </label>
      <CheckboxField
        checked={remember}
        description="E-Mail und Passwort für die nächste Anmeldung merken. Das Passwort liegt dabei unverschlüsselt im Browser-Speicher dieses Rechners."
        label="Zugangsdaten auf diesem Rechner speichern"
        onCheckedChange={handleRememberChange}
      />
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={busy || !email.trim() || !password}
          variant="default"
          onClick={() => void handleSubmit()}
        >
          {busy ? (
            <Loader2 aria-hidden className="size-3.5 animate-spin" />
          ) : (
            <LogIn aria-hidden className="size-3.5" />
          )}
          {authMode === "login" ? "Anmelden" : "Konto erstellen"}
        </Button>
        {stored.email || stored.password ? (
          <Button
            disabled={busy}
            title="Gemerkte E-Mail und Passwort von diesem Rechner löschen"
            onClick={handleForget}
          >
            <Trash2 aria-hidden className="size-3.5" />
            Vergessen
          </Button>
        ) : null}
      </div>
    </div>
  );
}
