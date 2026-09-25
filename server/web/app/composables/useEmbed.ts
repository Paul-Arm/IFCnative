/**
 * Einbettung in OpenProject (Plugin "IFC Hub"): Kontext der aktuellen
 * iframe-Sitzung. Liegt im sessionStorage — gilt also nur für diesen Tab
 * bzw. dieses iframe und verschwindet mit ihm.
 */
const EMBED_KEY = "ifc-hub:embed";

export interface EmbedContext {
  /** Basis-URL der OpenProject-Instanz. */
  openprojectUrl: string;
  /** Projekt-Identifier in OpenProject. */
  projectIdentifier: string;
  /** Zugehöriger Projekt-Slug im Hub. */
  projectSlug: string;
}

function readStored(): EmbedContext | null {
  if (!import.meta.client) return null;
  try {
    const raw = sessionStorage.getItem(EMBED_KEY);
    return raw ? (JSON.parse(raw) as EmbedContext) : null;
  } catch {
    return null;
  }
}

export function useEmbed() {
  const embed = useState<EmbedContext | null>("embed", readStored);

  function setEmbed(context: EmbedContext | null): void {
    embed.value = context;
    try {
      if (context) {
        sessionStorage.setItem(EMBED_KEY, JSON.stringify(context));
      } else {
        sessionStorage.removeItem(EMBED_KEY);
      }
    } catch {
      // Ohne Storage gilt der Einbettungsmodus nur bis zum Neuladen.
    }
  }

  return { embed, setEmbed };
}
