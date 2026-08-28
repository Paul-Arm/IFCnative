<script setup lang="ts">
import type { ApiUser } from "~/types/api";

definePageMeta({ layout: false });

const { token, setSession } = useAuth();
const router = useRouter();

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
    const body: Record<string, string> = {
      email: email.value.trim(),
      password: password.value,
    };
    if (mode.value === "register" && name.value.trim()) {
      body.name = name.value.trim();
    }
    const result = await $fetch<{ token: string; user: ApiUser }>(path, {
      method: "POST",
      body,
    });
    setSession(result.token, result.user);
    await router.push("/");
  } catch (e) {
    error.value = apiErrorMessage(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="login-page">
    <div class="card login-card">
      <div class="card-body">
        <h1 style="text-align: center">IFC Ablage</h1>
        <p class="muted small" style="text-align: center; margin-top: -0.25rem">
          Zentrale Ablage und Versionierung für IFC-Modelle
        </p>
        <div class="tabs" style="justify-content: center; margin-bottom: 1rem">
          <button :class="{ active: mode === 'login' }" @click="mode = 'login'">
            Anmelden
          </button>
          <button :class="{ active: mode === 'register' }" @click="mode = 'register'">
            Registrieren
          </button>
        </div>
        <div v-if="error" class="alert error">{{ error }}</div>
        <form @submit.prevent="submit">
          <div class="form-row">
            <label for="email">E-Mail</label>
            <input id="email" v-model="email" type="email" required autocomplete="email" />
          </div>
          <div v-if="mode === 'register'" class="form-row">
            <label for="name">Name</label>
            <input id="name" v-model="name" type="text" autocomplete="name" />
          </div>
          <div class="form-row">
            <label for="password">Passwort</label>
            <input
              id="password"
              v-model="password"
              type="password"
              required
              minlength="8"
              :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
            />
          </div>
          <button class="primary" style="width: 100%" type="submit" :disabled="busy">
            {{ mode === "login" ? "Anmelden" : "Konto erstellen" }}
          </button>
        </form>
      </div>
    </div>
  </div>
</template>
