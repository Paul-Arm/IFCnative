<script setup lang="ts">
import {
  PhArrowRight,
  PhBooks,
  PhClockCounterClockwise,
  PhCube,
  PhCubeTransparent,
  PhDesktop,
  PhFolderSimple,
  PhGear,
  PhKeyboard,
  PhMagnifyingGlass,
  PhMoon,
  PhPlayCircle,
  PhPlus,
  PhPulse,
  PhRecord,
  PhSignOut,
  PhSquaresFour,
  PhSun,
  PhUploadSimple,
  PhUsersThree,
} from "@phosphor-icons/vue";
import type { Component } from "vue";

import type { SearchResults } from "~/types/api";

/**
 * Befehlspalette: ein Eingabefeld für alles — Projekte, Dateien/Modelle
 * und Issues (Serversuche), Befehle und zuletzt Besuchtes.
 * Präfixe: „#“ = nur Issues, „>“ = nur Befehle.
 */

interface PaletteItem {
  id: string;
  title: string;
  subtitle?: string;
  icon: Component;
  iconColor?: string;
  /** Modell-Icon statt Phosphor-Icon. */
  model?: { kind: "ifc" | "md" | "file"; name: string };
  issueState?: "open" | "closed";
  to?: string;
  run?: () => void;
  keywords?: string;
}

interface Section {
  title: string;
  items: PaletteItem[];
}

const { paletteOpen: open, paletteQuery: query, helpOpen } = useShortcuts();
const { api } = useApi();
const { user, logout } = useAuth();
const { setPreference } = useTheme();
const { entries: recent } = useRecent();
const route = useRoute();
const router = useRouter();

const input = ref<HTMLInputElement | null>(null);
const list = ref<HTMLElement | null>(null);
const panel = ref<HTMLElement | null>(null);
useFocusTrap(panel, () => open.value);
const activeIndex = ref(0);
const results = ref<SearchResults | null>(null);
const searching = ref(false);

const projectSlug = computed(() =>
  typeof route.params.project === "string" ? route.params.project : null,
);
const projectContext = useProjectHeaderContext();
const currentContext = computed(() =>
  projectContext.value && projectContext.value.slug === projectSlug.value ? projectContext.value : null,
);
const projectName = computed(() => currentContext.value?.name ?? projectSlug.value);

const mode = computed<"all" | "issues" | "commands">(() => {
  const q = query.value.trimStart();
  if (q.startsWith(">")) return "commands";
  if (q.startsWith("#")) return "issues";
  return "all";
});
const term = computed(() => {
  const q = query.value.trim();
  if (mode.value === "commands") return q.slice(1).trim();
  return q;
});

// ---- Befehle ----------------------------------------------------------

const commands = computed<PaletteItem[]>(() => {
  const list: PaletteItem[] = [];
  const slug = projectSlug.value;
  if (slug) {
    const inProject = `in ${projectName.value}`;
    list.push(
      { id: "p-files", title: "Dateien", subtitle: inProject, icon: PhFolderSimple, to: `/p/${slug}`, keywords: "code modelle ordner" },
      { id: "p-new-issue", title: "Neues Issue", subtitle: inProject, icon: PhPlus, to: `/p/${slug}/issues/new`, keywords: "fehler anlegen" },
      { id: "p-issues", title: "Issues", subtitle: inProject, icon: PhRecord, to: `/p/${slug}/issues` },
    );
    if (currentContext.value?.canWrite) {
      list.push({ id: "p-upload", title: "Datei hochladen", subtitle: inProject, icon: PhUploadSimple, to: `/p/${slug}?upload=1`, keywords: "ifc pdf dwg commit" });
    }
    list.push(
      { id: "p-actions", title: "Actions", subtitle: inProject, icon: PhPlayCircle, to: `/p/${slug}/actions`, keywords: "prüfungen runs ids python" },
      { id: "p-3d", title: "3D-Szene", subtitle: inProject, icon: PhCubeTransparent, to: `/p/${slug}/3d`, keywords: "viewer modell" },
      { id: "p-activity", title: "Aktivität", subtitle: inProject, icon: PhPulse, to: `/p/${slug}/activity`, keywords: "insights statistik verlauf" },
      { id: "p-settings", title: "Einstellungen", subtitle: inProject, icon: PhGear, to: `/p/${slug}/settings`, keywords: "mitglieder labels löschen" },
    );
  }
  list.push(
    { id: "dashboard", title: "Dashboard", icon: PhSquaresFour, to: "/", keywords: "start home" },
    { id: "projects", title: "Alle Projekte", icon: PhFolderSimple, to: "/projects" },
    { id: "new-project", title: "Neues Projekt", icon: PhPlus, to: "/new", keywords: "anlegen erstellen" },
    { id: "library", title: "Bibliothek", icon: PhBooks, to: "/library", keywords: "ids python prüfdateien" },
  );
  if (user.value?.isAdmin) {
    list.push({ id: "admin", title: "Verwaltung", icon: PhUsersThree, to: "/admin", keywords: "benutzer admin system" });
  }
  list.push(
    { id: "theme-light", title: "Design: Hell", icon: PhSun, run: () => setPreference("light"), keywords: "theme farbe light" },
    { id: "theme-dark", title: "Design: Dunkel", icon: PhMoon, run: () => setPreference("dark"), keywords: "theme farbe dark" },
    { id: "theme-system", title: "Design: System", icon: PhDesktop, run: () => setPreference("system"), keywords: "theme farbe auto" },
    { id: "shortcuts", title: "Tastenkürzel anzeigen", icon: PhKeyboard, run: () => (helpOpen.value = true), keywords: "hilfe keyboard" },
    { id: "logout", title: "Abmelden", icon: PhSignOut, run: () => void logout(), keywords: "logout" },
  );
  return list;
});

function matches(item: PaletteItem, needle: string): boolean {
  if (!needle) return true;
  const haystack = `${item.title} ${item.subtitle ?? ""} ${item.keywords ?? ""}`.toLowerCase();
  return needle
    .toLowerCase()
    .split(/\s+/)
    .every((part) => haystack.includes(part));
}

// ---- Serversuche --------------------------------------------------------

let searchTimer: ReturnType<typeof setTimeout> | undefined;
let searchSeq = 0;

watch([term, mode, open], () => {
  clearTimeout(searchTimer);
  activeIndex.value = 0;
  const needle = mode.value === "issues" ? term.value.replace(/^#/, "") : term.value;
  if (!open.value || mode.value === "commands" || !needle) {
    results.value = null;
    searching.value = false;
    return;
  }
  searching.value = true;
  const seq = ++searchSeq;
  searchTimer = setTimeout(async () => {
    try {
      // „#12“ sucht die Nummer, „#brand“ den Titel.
      const q = mode.value === "issues" && /^\d+$/.test(needle) ? `#${needle}` : needle;
      const data = await api<SearchResults>("/search", { query: { q, limit: "8" } });
      if (seq === searchSeq) results.value = data;
    } catch {
      if (seq === searchSeq) results.value = null;
    } finally {
      if (seq === searchSeq) searching.value = false;
    }
  }, 140);
});

// ---- Abschnitte ---------------------------------------------------------

const sections = computed<Section[]>(() => {
  const out: Section[] = [];
  const needle = term.value;

  if (mode.value === "commands") {
    out.push({ title: "Befehle", items: commands.value.filter((item) => matches(item, needle)) });
    return out.filter((section) => section.items.length);
  }

  if (!needle) {
    if (recent.value.length && mode.value === "all") {
      out.push({
        title: "Zuletzt besucht",
        items: recent.value.slice(0, 6).map((entry) => ({
          id: `recent-${entry.to}`,
          title: entry.title,
          subtitle: entry.subtitle,
          icon: entry.type === "project" ? PhFolderSimple : entry.type === "issue" ? PhRecord : PhCube,
          model: entry.type === "model" && entry.kind ? { kind: entry.kind, name: entry.title } : undefined,
          issueState: entry.type === "issue" ? entry.state : undefined,
          to: entry.to,
        })),
      });
    }
    if (mode.value === "all") {
      out.push({ title: "Befehle", items: commands.value.slice(0, projectSlug.value ? 8 : 6) });
    }
    return out;
  }

  const data = results.value;
  const currentFirst = <T extends { project: { slug: string } }>(items: T[]) =>
    [...items].sort(
      (a, b) =>
        Number(b.project.slug === projectSlug.value) - Number(a.project.slug === projectSlug.value),
    );

  if (data && mode.value === "all") {
    if (data.projects.length) {
      out.push({
        title: "Projekte",
        items: data.projects.map((project) => ({
          id: `project-${project.id}`,
          title: project.name,
          subtitle: project.description || project.slug,
          icon: PhFolderSimple,
          to: `/p/${project.slug}`,
        })),
      });
    }
    if (data.models.length) {
      out.push({
        title: "Dateien & Modelle",
        items: currentFirst(data.models).map((model) => ({
          id: `model-${model.id}`,
          title: model.name,
          subtitle: `${model.project.name}${model.folder ? ` / ${model.folder}` : ""}`,
          icon: PhCube,
          model: { kind: model.kind, name: model.name },
          to: `/p/${model.project.slug}/m/${model.slug}`,
        })),
      });
    }
  }
  if (data?.issues.length) {
    out.push({
      title: "Issues",
      items: currentFirst(data.issues).map((issue) => ({
        id: `issue-${issue.id}`,
        title: issue.title,
        subtitle: `${issue.project.name} #${issue.number}`,
        icon: PhRecord,
        issueState: issue.state,
        to: `/p/${issue.project.slug}/i/${issue.number}`,
      })),
    });
  }
  if (mode.value === "all") {
    const cmds = commands.value.filter((item) => matches(item, needle)).slice(0, 5);
    if (cmds.length) out.push({ title: "Befehle", items: cmds });
  }
  return out;
});

const flat = computed(() => sections.value.flatMap((section) => section.items));

function indexOf(item: PaletteItem): number {
  return flat.value.indexOf(item);
}

function close(): void {
  open.value = false;
}

function runItem(item: PaletteItem | undefined): void {
  if (!item) return;
  close();
  if (item.run) {
    item.run();
  } else if (item.to) {
    void router.push(item.to);
  }
}

/** Escape schließt auch, wenn ein Treffer (per Tab) den Fokus hat. */
function onPanelKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    close();
  }
}

function onKeydown(event: KeyboardEvent): void {
  const count = flat.value.length;
  if (event.key === "ArrowDown" && count) {
    event.preventDefault();
    activeIndex.value = (activeIndex.value + 1) % count;
    scrollActive();
  } else if (event.key === "ArrowUp" && count) {
    event.preventDefault();
    activeIndex.value = (activeIndex.value - 1 + count) % count;
    scrollActive();
  } else if (event.key === "Enter") {
    event.preventDefault();
    runItem(flat.value[activeIndex.value]);
  }
}

function scrollActive(): void {
  nextTick(() => {
    list.value
      ?.querySelector<HTMLElement>(".palette-item.active")
      ?.scrollIntoView({ block: "nearest" });
  });
}

/** Titel in Treffer-/Nicht-Treffer-Stücke zerlegen (Hervorhebung). */
function segments(text: string): { text: string; hit: boolean }[] {
  const needle = (mode.value === "commands" ? term.value : term.value.replace(/^#/, "")).trim();
  if (!needle) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const index = lower.indexOf(needle.toLowerCase());
  if (index < 0) return [{ text, hit: false }];
  return [
    { text: text.slice(0, index), hit: false },
    { text: text.slice(index, index + needle.length), hit: true },
    { text: text.slice(index + needle.length), hit: false },
  ].filter((part) => part.text);
}

watch(open, (value) => {
  if (value) {
    activeIndex.value = 0;
    nextTick(() => input.value?.focus());
  }
});

// Seitenwechsel schließt die Palette (z. B. Zurück-Taste).
watch(() => route.fullPath, close);
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="palette-backdrop" @mousedown.self="close">
      <div
        ref="panel"
        class="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Befehlspalette"
        tabindex="-1"
        @keydown="onPanelKeydown"
      >
        <div class="palette-input">
          <PhMagnifyingGlass :size="18" aria-hidden="true" />
          <span v-if="projectSlug && mode !== 'commands'" class="palette-scope">
            {{ projectName }}
          </span>
          <input
            ref="input"
            v-model="query"
            type="text"
            spellcheck="false"
            autocomplete="off"
            :placeholder="
              mode === 'commands'
                ? 'Befehl eingeben …'
                : 'Projekte, Dateien und Issues suchen oder > für Befehle …'
            "
            aria-label="Suchen"
            @keydown="onKeydown"
          />
          <span v-if="searching" class="spinner" aria-hidden="true" />
          <kbd>Esc</kbd>
        </div>

        <div ref="list" class="palette-results">
          <template v-for="section in sections" :key="section.title">
            <div class="palette-section">{{ section.title }}</div>
            <button
              v-for="item in section.items"
              :key="item.id"
              type="button"
              class="palette-item"
              :class="{ active: indexOf(item) === activeIndex }"
              @mousemove="activeIndex = indexOf(item)"
              @click="runItem(item)"
            >
              <span class="palette-icon">
                <IssueStateIcon v-if="item.issueState" :state="item.issueState" />
                <ModelIcon v-else-if="item.model" :kind="item.model.kind" :name="item.model.name" />
                <component :is="item.icon" v-else :size="16" />
              </span>
              <span class="palette-text">
                <span class="palette-title">
                  <template v-for="(part, index) in segments(item.title)" :key="index">
                    <mark v-if="part.hit">{{ part.text }}</mark>
                    <template v-else>{{ part.text }}</template>
                  </template>
                </span>
                <span v-if="item.subtitle" class="palette-sub">{{ item.subtitle }}</span>
              </span>
              <span class="palette-go" aria-hidden="true">
                <template v-if="item.run">Ausführen</template>
                <template v-else>Öffnen</template>
                <PhArrowRight :size="12" />
              </span>
            </button>
          </template>

          <div v-if="!flat.length && !searching" class="palette-empty">
            <template v-if="term">Keine Treffer für „{{ term }}“.</template>
            <template v-else>
              <PhClockCounterClockwise :size="16" aria-hidden="true" />
              Tippe, um zu suchen.
            </template>
          </div>
        </div>

        <div class="palette-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> wählen</span>
          <span><kbd>↵</kbd> öffnen</span>
          <span><kbd>#</kbd> Issues</span>
          <span><kbd>&gt;</kbd> Befehle</span>
          <span class="spacer" />
          <span class="hide-sm"><kbd>Strg</kbd><kbd>K</kbd> öffnen/schließen</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>
