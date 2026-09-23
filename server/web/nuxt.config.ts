// Web UI for the IFC version control server.
//
// Built as a pure SPA (`ssr: false`): `npm run generate` emits static files
// that the Fastify server serves from `server/public` — one process serves
// API + UI. During development `nuxt dev` proxies /api to the local server
// (HUB_API_URL, default http://127.0.0.1:8787).
const apiTarget = process.env.HUB_API_URL ?? "http://127.0.0.1:8787";

// Setzt das gewählte Farbschema vor dem ersten Paint (siehe useTheme.ts).
const themeBoot =
  'try{var t=localStorage.getItem("ifc-hub:theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}';

export default defineNuxtConfig({
  compatibilityDate: "2026-08-01",
  ssr: false,
  devtools: { enabled: false },
  telemetry: false,
  app: {
    head: {
      title: "IFC Hub",
      htmlAttrs: { lang: "de" },
      meta: [
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { name: "color-scheme", content: "light dark" },
      ],
      link: [{ rel: "icon", type: "image/svg+xml", href: "/favicon.svg" }],
      script: [{ innerHTML: themeBoot, tagPosition: "head" }],
    },
  },
  css: [
    // Schriften lokal gebündelt (kein CDN): Mona Sans (UI), Hubot Sans
    // (Überschriften), Monaspace Neon (Ids, GUIDs, Code).
    "@fontsource-variable/mona-sans/wght.css",
    "@fontsource-variable/hubot-sans/wght.css",
    "@fontsource/monaspace-neon/400.css",
    "@fontsource/monaspace-neon/600.css",
    "~/assets/tokens.css",
    "~/assets/base.css",
    "~/assets/components.css",
    "~/assets/layout.css",
    "~/assets/features.css",
    "~/assets/project.css",
    "~/assets/issues.css",
    "~/assets/workspace.css",
    "~/assets/viewer.css",
    "~/assets/changes.css",
  ],
  nitro: {
    devProxy: {
      "/api": { target: `${apiTarget}/api`, changeOrigin: true },
    },
  },
});
