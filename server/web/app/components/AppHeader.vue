<script setup lang="ts">
import {
  PhBooks,
  PhCaretDown,
  PhCube,
  PhDesktop,
  PhFileArrowUp,
  PhFolderPlus,
  PhFolderSimple,
  PhKeyboard,
  PhMagnifyingGlass,
  PhMoon,
  PhPlus,
  PhRecord,
  PhShieldCheck,
  PhSignOut,
  PhSquaresFour,
  PhSun,
} from "@phosphor-icons/vue";

/**
 * Globaler Kopf: Logo + Kontext (Projekt), Suche/Befehlspalette,
 * „+“-Menü, Bibliothek/Verwaltung und Benutzermenü mit Farbschema.
 */
const { user, logout } = useAuth();
const { preference, setPreference } = useTheme();
const { openPalette, helpOpen } = useShortcuts();
const route = useRoute();

const projectSlug = computed(() =>
  typeof route.params.project === "string" ? route.params.project : null,
);
const projectContext = useProjectHeaderContext();
const currentContext = computed(() =>
  projectContext.value && projectContext.value.slug === projectSlug.value ? projectContext.value : null,
);
const projectName = computed(() => currentContext.value?.name ?? projectSlug.value);
/** Hochladen/Anlegen nur mit Schreibrecht (Leser dürfen aber Issues eröffnen). */
const projectCanWrite = computed(() => currentContext.value?.canWrite ?? false);

/** Kontext-Brotkrumen außerhalb von Projekten (Bibliothek, Verwaltung …). */
const pageContext = computed(() => {
  if (projectSlug.value) return null;
  if (route.path.startsWith("/library")) return "Bibliothek";
  if (route.path.startsWith("/admin")) return "Verwaltung";
  if (route.path.startsWith("/projects")) return "Projekte";
  if (route.path.startsWith("/new")) return "Neues Projekt";
  if (route.path.startsWith("/u/")) return "Profil";
  return "Dashboard";
});

const isMac = import.meta.client && /Mac|iPhone|iPad/.test(navigator.platform);
</script>

<template>
  <header class="app-header" :class="{ flush: projectSlug }">
    <div class="app-header-row">
      <NuxtLink to="/" class="app-logo" aria-label="IFC Hub — Dashboard">
        <HubLogo :size="30" />
        <span class="app-logo-text hide-sm">IFC Hub</span>
      </NuxtLink>

      <nav class="app-context" aria-label="Kontext">
        <span class="sep" aria-hidden="true">/</span>
        <template v-if="projectSlug">
          <NuxtLink :to="`/p/${projectSlug}`" :title="projectName ?? ''">{{ projectName }}</NuxtLink>
        </template>
        <span v-else class="current">{{ pageContext }}</span>
      </nav>

      <span class="spacer" />

      <button
        type="button"
        class="app-search"
        aria-label="Suchen oder springen"
        @click="openPalette()"
      >
        <PhMagnifyingGlass :size="16" aria-hidden="true" />
        <span class="app-search-text">
          {{ projectSlug ? `In ${projectName} suchen oder springen …` : "Suchen oder springen …" }}
        </span>
        <kbd>/</kbd>
      </button>

      <div class="app-header-actions">
        <UiMenu align="right">
          <template #trigger="{ toggle, open }">
            <button
              type="button"
              class="header-btn"
              :class="{ active: open }"
              aria-label="Neu anlegen"
              data-tip="Neu anlegen"
              data-tip-pos="below"
              data-tip-end
              :aria-expanded="open"
              @click="toggle"
            >
              <PhPlus :size="16" />
              <PhCaretDown :size="10" />
            </button>
          </template>
          <template v-if="projectSlug">
            <div class="menu-heading">In {{ projectName }}</div>
            <template v-if="projectCanWrite">
              <NuxtLink class="menu-item" :to="`/p/${projectSlug}?upload=1`">
                <PhFileArrowUp :size="16" /> Datei hochladen
              </NuxtLink>
              <NuxtLink class="menu-item" :to="`/p/${projectSlug}?create=model`">
                <PhCube :size="16" /> Neues IFC-Modell
              </NuxtLink>
              <NuxtLink class="menu-item" :to="`/p/${projectSlug}?create=folder`">
                <PhFolderPlus :size="16" /> Neuer Ordner
              </NuxtLink>
            </template>
            <NuxtLink class="menu-item" :to="`/p/${projectSlug}/issues/new`">
              <PhRecord :size="16" /> Neues Issue
            </NuxtLink>
            <div class="menu-sep" />
          </template>
          <NuxtLink class="menu-item" to="/new">
            <PhFolderSimple :size="16" /> Neues Projekt
          </NuxtLink>
        </UiMenu>

        <span class="app-header-divider hide-sm" aria-hidden="true" />

        <NuxtLink
          to="/library"
          class="header-btn hide-sm"
          aria-label="Bibliothek"
          data-tip="Bibliothek (Prüfdateien)"
          data-tip-pos="below"
          data-tip-end
        >
          <PhBooks :size="16" />
        </NuxtLink>
        <NuxtLink
          v-if="user?.isAdmin"
          to="/admin"
          class="header-btn hide-sm"
          aria-label="Verwaltung"
          data-tip="Verwaltung"
          data-tip-pos="below"
          data-tip-end
        >
          <PhShieldCheck :size="16" />
        </NuxtLink>

        <UiMenu align="right">
          <template #trigger="{ toggle, open }">
            <button
              type="button"
              class="avatar-btn"
              :aria-expanded="open"
              aria-label="Benutzermenü"
              @click="toggle"
            >
              <UserAvatar :user="user" :size="32" :titled="false" />
            </button>
          </template>
          <div class="user-menu-head">
            <UserAvatar :user="user" :size="36" :titled="false" />
            <div class="truncate">
              <strong class="truncate">{{ user?.name }}</strong>
              <span class="muted small truncate" style="display: block">{{ user?.email }}</span>
            </div>
          </div>
          <div class="menu-sep" />
          <NuxtLink class="menu-item" to="/">
            <PhSquaresFour :size="16" /> Dashboard
          </NuxtLink>
          <NuxtLink class="menu-item" to="/projects">
            <PhFolderSimple :size="16" /> Alle Projekte
          </NuxtLink>
          <NuxtLink class="menu-item" to="/library">
            <PhBooks :size="16" /> Bibliothek
          </NuxtLink>
          <NuxtLink v-if="user?.isAdmin" class="menu-item" to="/admin">
            <PhShieldCheck :size="16" /> Verwaltung
          </NuxtLink>
          <div class="menu-sep" />
          <div class="menu-heading">Farbschema</div>
          <div class="theme-seg">
            <div class="seg" role="radiogroup" aria-label="Farbschema">
              <button
                type="button"
                role="radio"
                :aria-checked="preference === 'system'"
                :class="{ active: preference === 'system' }"
                @click="setPreference('system')"
              >
                <PhDesktop :size="14" /> System
              </button>
              <button
                type="button"
                role="radio"
                :aria-checked="preference === 'light'"
                :class="{ active: preference === 'light' }"
                @click="setPreference('light')"
              >
                <PhSun :size="14" /> Hell
              </button>
              <button
                type="button"
                role="radio"
                :aria-checked="preference === 'dark'"
                :class="{ active: preference === 'dark' }"
                @click="setPreference('dark')"
              >
                <PhMoon :size="14" /> Dunkel
              </button>
            </div>
          </div>
          <button type="button" class="menu-item" @click="helpOpen = true">
            <PhKeyboard :size="16" /> Tastenkürzel
            <span class="spacer" />
            <kbd>?</kbd>
          </button>
          <div class="menu-sep" />
          <button type="button" class="menu-item" @click="logout">
            <PhSignOut :size="16" /> Abmelden
          </button>
          <div class="menu-sep" />
          <div class="menu-empty">
            Suche: <kbd>{{ isMac ? "⌘" : "Strg" }}</kbd> <kbd>K</kbd>
          </div>
        </UiMenu>
      </div>
    </div>
  </header>
</template>
