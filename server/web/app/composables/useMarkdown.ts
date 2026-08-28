import DOMPurify from "dompurify";
import { marked } from "marked";

/**
 * Markdown -> sanitisiertes HTML. DOMPurify ist Pflicht: Inhalte kommen von
 * Projektmitgliedern, öffentliche Modelle sind aber auch ohne Login sichtbar.
 */
export function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false, gfm: true, breaks: false });
  return DOMPurify.sanitize(html);
}
