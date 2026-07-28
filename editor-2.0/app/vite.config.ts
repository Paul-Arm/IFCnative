import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Tauri erwartet einen festen Port; clearScreen aus, damit Rust-Logs sichtbar bleiben
  clearScreen: false,
  server: { port: 5273, strictPort: true, host: "127.0.0.1" },
  build: { target: "es2022", outDir: "dist" },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
