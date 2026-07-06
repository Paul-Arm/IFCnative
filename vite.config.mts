import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const fromRoot = (...parts: string[]) => path.resolve(projectRoot, ...parts);

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: "@", replacement: fromRoot("src") },
      { find: /^react$/, replacement: fromRoot("node_modules/react") },
      {
        find: /^react\/jsx-runtime$/,
        replacement: fromRoot("node_modules/react/jsx-runtime.js"),
      },
      {
        find: /^react\/jsx-dev-runtime$/,
        replacement: fromRoot("node_modules/react/jsx-dev-runtime.js"),
      },
      { find: /^react-dom$/, replacement: fromRoot("node_modules/react-dom") },
      {
        find: /^react-dom\/client$/,
        replacement: fromRoot("node_modules/react-dom/client.js"),
      },
      {
        find: /^react-dom\/server$/,
        replacement: fromRoot("node_modules/react-dom/server.browser.js"),
      },
    ],
    dedupe: ["react", "react-dom"],
    extensions: [".web.tsx", ".web.ts", ".tsx", ".ts", ".jsx", ".js", ".json"],
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    // MKP-Portal-Dev-Proxy: umgeht CORS im Browser-Dev-Modus. Die
    // Portal-Default-URLs zeigen auf diese Pfade (src/portal/types.ts).
    proxy: {
      "/mkp/portal": {
        target: "https://portal.dev.marxkrontal.com",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/mkp\/portal/, ""),
      },
      "/mkp/auth": {
        target: "https://auth.marxkrontal.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/mkp\/auth/, ""),
      },
      "/mkp/local": {
        target: "http://localhost:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/mkp\/local/, ""),
      },
    },
  },
});
