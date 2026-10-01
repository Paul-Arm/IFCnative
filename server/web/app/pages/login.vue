<script setup lang="ts">
import { PhCubeTransparent, PhGitDiff, PhShieldCheck } from "@phosphor-icons/vue";

import type { ApiUser } from "~/types/api";

definePageMeta({ layout: false });

/**
 * Anmeldung/Registrierung: links die animierte Blueprint-Szene mit dem
 * Versprechen des Hubs, rechts das Formular.
 */
const { token, setSession } = useAuth();
const route = useRoute();
const router = useRouter();

useHead({ title: "Anmelden · IFC Hub" });

if (token.value) {
  await navigateTo("/");
}

const mode = ref<"login" | "register">("login");
const email = ref("");
const name = ref("");
const password = ref("");
const error = ref<string | null>(null);
const busy = ref(false);

async function submit(): Promise<void> {
  error.value = null;
  busy.value = true;
  try {
    const path = mode.value === "login" ? "/api/auth/login" : "/api/auth/register";
    const body: Record<string, string> = { email: email.value.trim(), password: password.value };
    if (mode.value === "register" && name.value.trim()) body.name = name.value.trim();
    const result = await $fetch<{ token: string; user: ApiUser }>(path, { method: "POST", body });
    setSession(result.token, result.user);
    const target = typeof route.query.next === "string" && route.query.next.startsWith("/") ? route.query.next : "/";
    await router.push(target);
  } catch (e) {
    const message = apiErrorMessage(e);
    error.value =
      message === "Invalid credentials"
        ? "E-Mail oder Passwort stimmen nicht."
        : message === "Email already registered"
          ? "Für diese E-Mail gibt es schon ein Konto."
          : message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="auth">
    <section class="auth-hero">
      <div class="auth-brand">
        <HubLogo :size="40" animated />
        IFC Hub
      </div>
      <div class="auth-claim">
        <h1>Versionskontrolle für <em>BIM-Modelle</em>.</h1>
        <p>
          IFC-Modelle, Pläne und Dokumente an einem Ort — mit Commits, Branches und
          einem Diff, der zeigt, welche Bauteile sich wirklich geändert haben.
        </p>
      </div>
      <div class="auth-art">
        <IsoScene :size="520" />
      </div>
      <ul class="auth-features">
        <li>
          <strong><PhGitDiff :size="16" /> Objekt-Diff</strong>
          Attribute, Lage, Geometrie und Eigenschaften je Bauteil — auch im 3D-Vergleich.
        </li>
        <li>
          <strong><PhShieldCheck :size="16" /> Prüfungen</strong>
          IDS und Python laufen bei jedem Commit; Verstöße landen als Issue im Modell.
        </li>
        <li>
          <strong><PhCubeTransparent :size="16" /> 3D &amp; BCF</strong>
          Alle Fachmodelle in einer Szene, Befunde verortet und als BCF austauschbar.
        </li>
      </ul>
    </section>

    <section class="auth-panel">
      <div class="auth-card">
        <h2>{{ mode === "login" ? "Willkommen zurück" : "Konto erstellen" }}</h2>
        <p class="muted" style="margin: 0">
          {{ mode === "login" ? "Melde dich an, um deine Projekte zu öffnen." : "Ein Konto für alle Projekte im Hub." }}
        </p>

        <div class="seg" role="tablist">
          <button type="button" role="tab" :aria-selected="mode === 'login'" :class="{ active: mode === 'login' }" @click="mode = 'login'">
            Anmelden
          </button>
          <button type="button" role="tab" :aria-selected="mode === 'register'" :class="{ active: mode === 'register' }" @click="mode = 'register'">
            Registrieren
          </button>
        </div>

        <div v-if="error" class="flash flash-danger flash-sm">{{ error }}</div>

        <form @submit.prevent="submit">
          <div class="form-group">
            <label class="form-label" for="email">E-Mail</label>
            <input id="email" v-model="email" type="email" required autocomplete="email" autofocus />
          </div>
          <div v-if="mode === 'register'" class="form-group">
            <label class="form-label" for="name">Name</label>
            <input id="name" v-model="name" type="text" autocomplete="name" placeholder="Vor- und Nachname" />
          </div>
          <div class="form-group">
            <label class="form-label" for="password">Passwort</label>
            <input
              id="password"
              v-model="password"
              type="password"
              required
              minlength="8"
              :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
            />
            <p v-if="mode === 'register'" class="form-hint">Mindestens 8 Zeichen.</p>
          </div>
          <button type="submit" class="btn btn-primary btn-lg btn-block" :disabled="busy">
            <span v-if="busy" class="spinner" />
            {{ mode === "login" ? "Anmelden" : "Konto erstellen" }}
          </button>
        </form>
        <p class="auth-foot">
          <template v-if="mode === 'login'">
            Neu hier? <button type="button" class="link-btn" @click="mode = 'register'">Konto erstellen</button>
          </template>
          <template v-else>
            Schon registriert? <button type="button" class="link-btn" @click="mode = 'login'">Anmelden</button>
          </template>
        </p>
      </div>
    </section>
  </div>
</template>
