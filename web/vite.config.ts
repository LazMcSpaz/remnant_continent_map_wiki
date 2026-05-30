import { defineConfig } from "vite";

// Vite config for the Remnant Continent atlas (Phase 1 map spine).
// The dev server and build are intentionally minimal — MapLibre is the only
// runtime dependency so far. Env vars (VITE_*) drive the basemap source so no
// keys or style URLs are hardcoded; see .env.example.
export default defineConfig({
  root: ".",
  build: {
    outDir: "dist",
    sourcemap: true,
    target: "es2022",
  },
  server: {
    port: 5173,
    host: true,
  },
});
