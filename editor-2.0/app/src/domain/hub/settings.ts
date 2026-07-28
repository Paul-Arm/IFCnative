/**
 * Einstellungen der Hub-Verbindung: Basis-URL, optionales Bearer-Token und
 * der Autorname, der beim Sichern eines Standes mitgeschickt wird.
 *
 * Persistiert über `core/storage` (localStorage). Das Token liegt dort im
 * Klartext — bewusst, weil der Hub laut Spezifikation lokal läuft
 * (127.0.0.1) und das Token dort nur ein Schreibschutz ist. Für entfernte
 * Instanzen gehört es später in den Tauri-Secure-Store.
 */
import { create } from "zustand";

import { loadJson, saveJson } from "../../core/storage";
import type { HubConfig } from "./types";

export const DEFAULT_HUB_URL = "http://127.0.0.1:8711";

const BASE_URL_KEY = "hub.baseUrl";
const TOKEN_KEY = "hub.token";
const AUTHOR_KEY = "hub.author";

interface HubSettingsState extends HubConfig {
  /** Autorname für POST …/versions?author= */
  author: string;
  setBaseUrl(baseUrl: string): void;
  setToken(token: string): void;
  setAuthor(author: string): void;
}

/** loadJson liefert `unknown` aus fremdem Storage — Typ hier absichern. */
function loadString(key: string, fallback: string): string {
  const value = loadJson<unknown>(key, fallback);
  return typeof value === "string" ? value : fallback;
}

export const useHubSettings = create<HubSettingsState>((set) => ({
  baseUrl: loadString(BASE_URL_KEY, DEFAULT_HUB_URL),
  token: loadString(TOKEN_KEY, ""),
  author: loadString(AUTHOR_KEY, ""),

  setBaseUrl(baseUrl) {
    saveJson(BASE_URL_KEY, baseUrl);
    set({ baseUrl });
  },

  setToken(token) {
    saveJson(TOKEN_KEY, token);
    set({ token });
  },

  setAuthor(author) {
    saveJson(AUTHOR_KEY, author);
    set({ author });
  },
}));

/** Verbindungsdaten außerhalb von React (z. B. in Aktionen) lesen. */
export function currentHubConfig(): HubConfig {
  const { baseUrl, token } = useHubSettings.getState();
  return { baseUrl, token };
}
