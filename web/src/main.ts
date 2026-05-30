// App entry point — Phase 1 map spine.
// Boots the MapLibre basemap, loads authored feature layers from Supabase,
// renders them, and builds the derived network graph. Editing (Terra Draw) and
// the wiki/notes view attach in later steps.

import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";
import { createBasemap } from "./map/basemap";
import { loadFeatures } from "./layers/features";
import { addFeatureLayers, setNameMode, type NameMode } from "./layers/render";
import { buildNetworkGraph, edgeTravelHours } from "./derived/network-graph";

function setStatus(text: string, kind: "info" | "error" = "info"): void {
  const el = document.getElementById("status");
  if (!el) return;
  el.textContent = text;
  el.dataset.kind = kind;
}

async function boot(): Promise<void> {
  const container = document.getElementById("map");
  if (!container) {
    setStatus("Map container missing.", "error");
    return;
  }

  const { map, ready } = createBasemap(container);

  map.on("error", (e) => {
    const msg = e.error?.message ?? "Unknown map error";
    setStatus(`Map error: ${msg}`, "error");
    console.error("[map]", e.error);
  });

  await ready;
  setStatus("Basemap loaded. Loading features…");

  try {
    const data = await loadFeatures();
    const nameMode = initNameToggle(map);
    addFeatureLayers(map, data, nameMode);

    // Build the derived network graph and log a quick summary + travel times.
    const graph = buildNetworkGraph(data.locations, data.routes);
    const reachable = graph.edges.filter((e) => edgeTravelHours(e) !== null).length;
    console.info(
      `[graph] ${graph.nodes.length} nodes, ${graph.edges.length} edges ` +
        `(${reachable} passable).`,
    );
    for (const e of graph.edges) {
      const hrs = edgeTravelHours(e);
      const from = graph.nodes.find((n) => n.id === e.from)?.name ?? e.from;
      const to = graph.nodes.find((n) => n.id === e.to)?.name ?? e.to;
      console.info(
        `[graph] ${from} → ${to}: ${e.lengthKm.toFixed(0)} km, ` +
          (hrs === null ? "severed" : `${hrs.toFixed(1)} h`) +
          ` (${e.status})`,
      );
    }

    const count = data.locations.features.length;
    setStatus(
      count > 0
        ? `${count} locations, ${data.routes.features.length} routes. Graph built.`
        : "No backend configured — viewer only. Set VITE_SUPABASE_* in web/.env.",
    );
    (window as unknown as { __map?: unknown; __graph?: unknown }).__map = map;
    (window as unknown as { __graph?: unknown }).__graph = graph;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setStatus(`Could not load features: ${msg}`, "error");
    console.error("[features]", err);
  }
}

/** Build the new/old name-toggle button; returns the initial mode. */
function initNameToggle(map: import("maplibre-gl").Map): NameMode {
  let mode: NameMode = "new";
  const btn = document.getElementById("name-toggle");
  if (btn instanceof HTMLButtonElement) {
    const label = () => (mode === "new" ? "Names: new-world" : "Names: old-world");
    btn.textContent = label();
    btn.hidden = false;
    btn.addEventListener("click", () => {
      mode = mode === "new" ? "old" : "new";
      btn.textContent = label();
      setNameMode(map, mode);
    });
  }
  return mode;
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void boot());
} else {
  void boot();
}
