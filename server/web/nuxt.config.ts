// Web UI for the IFC version control server.
//
// Built as a pure SPA (`ssr: false`): `npm run generate` emits static files
// that the Fastify server serves from `server/public` — one process serves
// API + UI. During development `nuxt dev` proxies /api to the local server.
export default defineNuxtConfig({
  compatibilityDate: "2026-08-01",
  ssr: false,
  devtools: { enabled: false },
  telemetry: false,
  app: {
    head: {
      title: "IFC Ablage",
      htmlAttrs: { lang: "de" },
      meta: [{ name: "viewport", content: "width=device-width, initial-scale=1" }],
      link: [
        { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      ],
    },
  },
  css: ["~/assets/main.css"],
  nitro: {
    devProxy: {
      "/api": { target: "http://127.0.0.1:8787/api", changeOrigin: true },
    },
  },
});
