// App entry point — Phase 1 map spine.
// Boots the MapLibre basemap and reports load status in the UI. Feature layers,
// derived overlays, and the network graph attach to `handle.map` in later steps.

import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";
import { createBasemap } from "./map/basemap";

function setStatus(text: string, kind: "info" | "error" = "info"): void {
  const el = document.getElementById("status");
  if (!el) return;
  el.textContent = text;
  el.dataset.kind = kind;
}

function boot(): void {
  const container = document.getElementById("map");
  if (!container) {
    setStatus("Map container missing.", "error");
    return;
  }

  const { map, ready } = createBasemap(container);

  map.on("error", (e) => {
    // Tile/style fetch failures surface here (e.g. offline dev).
    const msg = e.error?.message ?? "Unknown map error";
    setStatus(`Map error: ${msg}`, "error");
    console.error("[map]", e.error);
  });

  ready.then(() => {
    setStatus("Basemap loaded. Midwest corridor.");
    // Expose for console inspection during development.
    (window as unknown as { __map?: unknown }).__map = map;
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
