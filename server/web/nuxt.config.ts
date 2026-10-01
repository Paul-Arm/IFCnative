// Web UI for the IFC version control server.
//
// Built as a pure SPA (`ssr: false`): `npm run generate` emits static files
// that the Fastify server serves from `server/public` — one process serves
// API + UI. During development `nuxt dev` proxies /api to the local server
// (HUB_API_URL, default http://127.0.0.1:8787).
const apiTarget = process.env.HUB_API_URL ?? "http://127.0.0.1:8787";

// Eingebettet in OpenProject (anderer Host = andere "Site") sperren manche
// Browser im iframe den Zugriff auf localStorage/sessionStorage
// (Drittanbieter-Cookies blockiert, Firefox streng, Firmenrichtlinien) —
// jeder Zugriff wirft dann, die App bliebe leer. Läuft vor der App: nur wenn
// gesperrt, werden beide durch einen Speicher im Arbeitsspeicher ersetzt.
// Die Sitzung gilt dann für die Lebensdauer der Seite; eingebettet kommt sie
// ohnehin bei jedem Laden frisch per Ticket aus OpenProject.
const storageFallbackBoot =
  '(function(){function ok(n){try{var s=window[n],k="__ifc_hub_probe__";s.setItem(k,"1");s.removeItem(k);return true}catch(e){return false}}' +
  'function mem(){var d=Object.create(null);return{get length(){return Object.keys(d).length},key:function(i){var k=Object.keys(d);return i<k.length?k[i]:null},' +
  'getItem:function(k){k=String(k);return k in d?d[k]:null},setItem:function(k,v){d[String(k)]=String(v)},removeItem:function(k){delete d[String(k)]},clear:function(){d=Object.create(null)}}}' +
  '["localStorage","sessionStorage"].forEach(function(n){if(!ok(n)){try{Object.defineProperty(window,n,{value:mem(),configurable:true,writable:true});window.__ifcHubMemoryStorage=true}catch(e){}}})})();';

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
      script: [
        { innerHTML: storageFallbackBoot, tagPosition: "head" },
        { innerHTML: themeBoot, tagPosition: "head" },
      ],
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
