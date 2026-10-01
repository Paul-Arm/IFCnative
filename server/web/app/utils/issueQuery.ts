import type { Issue } from "~/types/api";

/**
 * Filtersprache der Issue-Liste wie bei GitHub:
 *   is:open  is:closed  label:"Brandschutz"  author:Paula  assignee:Bernd
 *   no:assignee  model:architektur  kind:bcf  sort:updated  Freitext …
 * Werte mit Leerzeichen in Anführungszeichen. Freitext durchsucht Titel,
 * Beschreibung und #Nummer.
 */

export type IssueSort = "created-desc" | "created-asc" | "updated-desc" | "comments-desc";

export interface IssueQuery {
  state: "open" | "closed" | null;
  labels: string[];
  authors: string[];
  assignees: string[];
  noAssignee: boolean;
  models: string[];
  kind: "bcf" | "virtual" | null;
  sort: IssueSort;
  text: string;
}

const TOKEN = /(-?[a-z]+):("([^"]*)"|\S+)|("([^"]*)"|\S+)/gi;

export function parseIssueQuery(input: string): IssueQuery {
  const query: IssueQuery = {
    state: null,
    labels: [],
    authors: [],
    assignees: [],
    noAssignee: false,
    models: [],
    kind: null,
    sort: "created-desc",
    text: "",
  };
  const words: string[] = [];
  for (const match of input.matchAll(TOKEN)) {
    const key = match[1]?.toLowerCase();
    const value = match[3] ?? match[2];
    if (!key || value === undefined) {
      words.push(match[5] ?? match[4] ?? "");
      continue;
    }
    switch (key) {
      case "is":
        if (value === "open" || value === "closed") query.state = value;
        else if (value === "bcf" || value === "virtual") query.kind = value;
        break;
      case "label":
        query.labels.push(value);
        break;
      case "author":
        query.authors.push(value);
        break;
      case "assignee":
        query.assignees.push(value);
        break;
      case "no":
        if (value === "assignee") query.noAssignee = true;
        break;
      case "model":
        query.models.push(value);
        break;
      case "kind":
        if (value === "bcf" || value === "virtual") query.kind = value;
        break;
      case "sort":
        if (value === "created-asc" || value === "updated-desc" || value === "comments-desc") {
          query.sort = value;
        } else if (value === "updated") {
          query.sort = "updated-desc";
        } else if (value === "comments") {
          query.sort = "comments-desc";
        }
        break;
      default:
        words.push(match[0]);
    }
  }
  query.text = words.join(" ").trim();
  return query;
}

function quote(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value;
}

/** Qualifier setzen/entfernen und den Suchtext neu zusammensetzen. */
export function toggleQualifier(input: string, key: string, value: string): string {
  const token = `${key}:${quote(value)}`;
  const pattern = new RegExp(`(^|\\s)${key}:("${escapeRegExp(value)}"|${escapeRegExp(value)})(?=\\s|$)`, "i");
  if (pattern.test(input)) {
    return input.replace(pattern, " ").replace(/\s+/g, " ").trim();
  }
  return `${input.trim()} ${token}`.trim();
}

/** Einen Qualifier-Schlüssel exklusiv setzen (z. B. is:open ↔ is:closed, sort:…). */
export function setQualifier(input: string, key: string, value: string | null, only?: string[]): string {
  const values = only ? only.map(escapeRegExp).join("|") : '"[^"]*"|\\S+';
  const pattern = new RegExp(`(^|\\s)${key}:(${values})(?=\\s|$)`, "gi");
  const cleaned = input.replace(pattern, " ").replace(/\s+/g, " ").trim();
  return value === null ? cleaned : `${key}:${quote(value)} ${cleaned}`.trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function includesName(names: string[], value: string | undefined | null): boolean {
  if (!value) return false;
  const lower = value.toLowerCase();
  return names.some((name) => lower.includes(name.toLowerCase()));
}

/** Filter anwenden (ohne Status — den setzt die Liste über die Tabs). */
export function matchesIssue(issue: Issue, query: IssueQuery): boolean {
  if (query.labels.length) {
    const names = issue.labels.map((label) => label.name.toLowerCase());
    if (!query.labels.every((label) => names.includes(label.toLowerCase()))) return false;
  }
  if (query.authors.length && !includesName(query.authors, issue.author?.name)) return false;
  if (query.assignees.length) {
    if (!issue.assignees.some((user) => includesName(query.assignees, user.name))) return false;
  }
  if (query.noAssignee && issue.assignees.length) return false;
  if (query.models.length) {
    const models = issue.models.flatMap((model) => [model.slug.toLowerCase(), model.name.toLowerCase()]);
    if (!query.models.every((wanted) => models.includes(wanted.toLowerCase()))) return false;
  }
  if (query.kind && issue.kind !== query.kind) return false;
  if (query.text) {
    const needle = query.text.toLowerCase().replace(/^#/, "");
    const haystack = `#${issue.number} ${issue.number} ${issue.title} ${issue.body}`.toLowerCase();
    if (!needle.split(/\s+/).every((part) => haystack.includes(part))) return false;
  }
  return true;
}

export function sortIssues(list: Issue[], sort: IssueSort): Issue[] {
  const sorted = [...list];
  switch (sort) {
    case "created-asc":
      return sorted.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    case "updated-desc":
      return sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    case "comments-desc":
      return sorted.sort((a, b) => (b.commentCount ?? 0) - (a.commentCount ?? 0) || b.number - a.number);
    default:
      return sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.number - a.number);
  }
}

export const SORT_LABELS: Record<IssueSort, string> = {
  "created-desc": "Neueste zuerst",
  "created-asc": "Älteste zuerst",
  "updated-desc": "Zuletzt aktualisiert",
  "comments-desc": "Meiste Kommentare",
};
