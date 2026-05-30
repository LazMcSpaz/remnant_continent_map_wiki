// App entry point — Phase 1 map spine.
// Boots the MapLibre basemap, loads authored feature layers from Supabase,
// renders them, builds the derived network graph, and enables Terra Draw
// editing that writes back to the authored layer.

import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";
import type { Map as MlMap } from "maplibre-gl";
import { createBasemap } from "./map/basemap";
import { loadFeatures, hasBackend, type FeatureData } from "./layers/features";
import { addFeatureLayers, updateFeatureData, setNameMode, onLocationClick, setSelectedLocation, type NameMode } from "./layers/render";
import { buildNetworkGraph, edgeTravelHours, type NetworkGraph } from "./derived/network-graph";
import { mountEditorToolbar } from "./layers/editor";
import { WikiPanel, type WikiHost } from "./notes/wiki-panel";

function setStatus(text: string, kind: "info" | "error" = "info"): void {
  const el = document.getElementById("status");
  if (!el) return;
  el.textContent = text;
  el.dataset.kind = kind;
}

/** Recompute and log the derived network graph from current feature data. */
function rebuildGraph(data: FeatureData): NetworkGraph {
  const graph = buildNetworkGraph(data.locations, data.routes);
  const reachable = graph.edges.filter((e) => edgeTravelHours(e) !== null).length;
  console.info(
    `[graph] ${graph.nodes.length} nodes, ${graph.edges.length} edges (${reachable} passable).`,
  );
  (window as unknown as { __graph?: unknown }).__graph = graph;
  return graph;
}

function summarize(data: FeatureData): string {
  return `${data.locations.features.length} locations, ${data.routes.features.length} routes, ${data.territories.features.length} territories.`;
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
    let data = await loadFeatures();
    let graph = rebuildGraph(data);
    const nameMode = initNameToggle(map);
    addFeatureLayers(map, data, nameMode);

    // Tabbed wiki panel. The host is its window into live app state, so the
    // panel can edit, navigate, and refresh without owning data or map state.
    const appEl = document.getElementById("app") ?? document.body;
    const host: WikiHost = {
      getDetail: (id) => data.locationDetails.get(id),
      getGraph: () => graph,
      canEdit: () => hasBackend(),
      setStatus,
      navigateTo: (id) => selectLocation(id),
      reloadData: async () => {
        data = await loadFeatures();
        graph = rebuildGraph(data);
        updateFeatureData(map, data);
        setStatus(summarize(data));
      },
    };
    const wiki = new WikiPanel(appEl, host, () => setSelectedLocation(map, null));

    /** Select a location: highlight it, ease toward it, and open the panel. */
    const selectLocation = (id: string): void => {
      const detail = data.locationDetails.get(id);
      if (!detail) return;
      setSelectedLocation(map, id);
      if (detail.lngLat) map.easeTo({ center: detail.lngLat, duration: 500 });
      wiki.open(id);
    };

    onLocationClick(map, selectLocation);

    if (!hasBackend()) {
      setStatus("No backend configured — viewer only. Set VITE_SUPABASE_* in web/.env.");
    } else {
      setStatus(summarize(data));
      mountEditor(
        map,
        () => data,
        (next) => {
          data = next;
          graph = rebuildGraph(next);
          if (wiki.isOpen()) wiki.rerenderActive();
        },
      );
    }

    (window as unknown as { __map?: unknown }).__map = map;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setStatus(`Could not load features: ${msg}`, "error");
    console.error("[features]", err);
  }
}

/** Mount the editing toolbar; reloads + re-renders + rebuilds graph on change. */
function mountEditor(map: MlMap, getData: () => FeatureData, setData: (d: FeatureData) => void): void {
  const toolbar = document.getElementById("editor-toolbar");
  if (!toolbar) return;
  mountEditorToolbar(map, toolbar, {
    onStatus: setStatus,
    defaultFactionId: () => {
      const first = getData().factions.keys().next();
      return first.done ? null : first.value;
    },
    onChange: async () => {
      const next = await loadFeatures();
      setData(next); // also rebuilds the derived graph
      updateFeatureData(map, next);
      setStatus(summarize(next));
    },
  });
}

/** Build the new/old name-toggle button; returns the initial mode. */
function initNameToggle(map: MlMap): NameMode {
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
