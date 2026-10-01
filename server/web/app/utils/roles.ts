import type { Role } from "~/types/api";

/** Projektrollen in absteigender Berechtigung, mit Kurzbeschreibung. */
export const ROLES: { value: Role; label: string; hint: string }[] = [
  { value: "owner", label: "Owner", hint: "Alles, inkl. Projekt löschen" },
  { value: "maintainer", label: "Maintainer", hint: "Einstellungen, Mitglieder, Modelle verwalten" },
  { value: "contributor", label: "Contributor", hint: "Committen, Issues bearbeiten, Prüfungen starten" },
  { value: "viewer", label: "Viewer", hint: "Lesen, Issues eröffnen und kommentieren" },
];

export function roleLabel(role: Role | string): string {
  return ROLES.find((entry) => entry.value === role)?.label ?? role;
}

export function roleHint(role: Role | string): string {
  return ROLES.find((entry) => entry.value === role)?.hint ?? "";
}
