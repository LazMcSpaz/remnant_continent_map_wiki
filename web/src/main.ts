// App entry point — Phase 1 map spine.
// Boots the MapLibre basemap, loads authored feature layers from Supabase,
// renders them, builds the derived network graph, and enables Terra Draw
// editing that writes back to the authored layer.

import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";
import type { Map as MlMap } from "maplibre-gl";
import { createBasemap } from "./map/basemap";
import { loadFeatures, hasBackend, type FeatureData } from "./layers/features";
import { addFeatureLayers, updateFeatureData, setNameMode, onLocationClick, setSelectedLocation, onTerrainClick, setSelectedTerrain, type NameMode } from "./layers/render";
import { buildNetworkGraph, edgeTravelHours, type NetworkGraph } from "./derived/network-graph";
import { mountEditorToolbar } from "./layers/editor";
import { WikiPanel, type WikiHost } from "./notes/wiki-panel";
import { mountIOToolbar } from "./state/io";
import { ClimateOverlay } from "./derived/climate-overlay";
import { mountClimateControl } from "./derived/climate-control";
import { TerrainPanel, type TerrainHost } from "./notes/terrain-panel";
import { climateInputs, temperatureAt, growingWarmth, sampleElevation } from "./derived/climate";
import { updateWorldSettings } from "./layers/features";

const SEASON_NAMES = ["Midwinter", "Spring", "Midsummer", "Autumn"];
function seasonName(season: number): string {
  return SEASON_NAMES[Math.round(season * 4) % 4];
}

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
    // Derived climate overlay (Phase 2): recomputes from authored inputs.
    const climate = new ClimateOverlay(map);
    climate.recompute(data);

    const host: WikiHost = {
      getDetail: (id) => data.locationDetails.get(id),
      getGraph: () => graph,
      getClimate: (detail) => {
        if (!detail.lngLat) return null;
        const inp = climateInputs(data.worldSettings);
        // Locations carry no elevation of their own; sample it from the terrain
        // region beneath the city so terrain elevation edits cascade into the
        // city's derived climate.
        const elev = sampleElevation(detail.lngLat, data.terrainRegions);
        const tempC = temperatureAt(detail.lngLat, elev, inp);
        return {
          tempC,
          warmth: growingWarmth(tempC),
          season: inp.season,
          seasonLabel: seasonName(inp.season),
        };
      },
      canEdit: () => hasBackend(),
      setStatus,
      navigateTo: (id) => selectLocation(id),
      reloadData: async () => applyData(await loadFeatures()),
    };
    const wiki = new WikiPanel(appEl, host, () => setSelectedLocation(map, null));

    /** Select a location: highlight it, ease toward it, and open the panel. */
    const selectLocation = (id: string): void => {
      const detail = data.locationDetails.get(id);
      if (!detail) return;
      terrainPanel.close();
      setSelectedTerrain(map, null);
      setSelectedLocation(map, id);
      if (detail.lngLat) map.easeTo({ center: detail.lngLat, duration: 500 });
      wiki.open(id);
    };

    onLocationClick(map, selectLocation);

    // Terrain editor panel. Editing physical inputs cascades into the derived
    // climate: reloadData → recompute → both panels refresh.
    const terrainHost: TerrainHost = {
      getRegion: (id) => data.terrainRegions.find((r) => r.id === id),
      getDerived: (id) => climate.get(id),
      reloadData: async () => applyData(await loadFeatures()),
      canEdit: () => hasBackend(),
      setStatus,
    };
    const terrainPanel = new TerrainPanel(appEl, terrainHost, () => setSelectedTerrain(map, null));

    const selectTerrain = (id: string): void => {
      if (!data.terrainRegions.some((r) => r.id === id)) return;
      // Opening terrain closes the city panel (and vice versa) to avoid overlap.
      wiki.close();
      setSelectedTerrain(map, id);
      terrainPanel.open(id);
    };
    onTerrainClick(map, selectTerrain);

    /** Apply freshly-loaded data everywhere: render, graph, climate, panels. */
    const applyData = (next: FeatureData): void => {
      data = next;
      graph = rebuildGraph(next);
      updateFeatureData(map, next);
      climate.recompute(next);
      if (wiki.isOpen()) wiki.rerenderActive();
      if (terrainPanel.isOpen()) terrainPanel.refresh();
      setStatus(summarize(next));
    };

    mountClimate(climate, () => data, () => {
      if (wiki.isOpen()) wiki.rerenderActive();
    });

    if (!hasBackend()) {
      setStatus("No backend configured — viewer only. Set VITE_SUPABASE_* in web/.env.");
    } else {
      setStatus(summarize(data));
      mountEditor(map, () => data, applyData);
      mountIO(async () => applyData(await loadFeatures()));
    }

    (window as unknown as { __map?: unknown }).__map = map;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setStatus(`Could not load features: ${msg}`, "error");
    console.error("[features]", err);
  }
}

/** Mount the editing toolbar; applyData re-renders, rebuilds the graph, etc. */
function mountEditor(map: MlMap, getData: () => FeatureData, applyData: (d: FeatureData) => void): void {
  const toolbar = document.getElementById("editor-toolbar");
  if (!toolbar) return;
  mountEditorToolbar(map, toolbar, {
    onStatus: setStatus,
    defaultFactionId: () => {
      const first = getData().factions.keys().next();
      return first.done ? null : first.value;
    },
    onChange: async () => applyData(await loadFeatures()),
  });
}

/** Mount the save / export / import toolbar. */
function mountIO(onImported: () => Promise<void>): void {
  const toolbar = document.getElementById("io-toolbar");
  if (!toolbar) return;
  mountIOToolbar(toolbar, {
    setStatus,
    onImported,
    confirm: (message) => window.confirm(message),
  });
}

/** Mount the derived-climate control: toggle, metric, season scrubber. */
function mountClimate(
  climate: ClimateOverlay,
  getData: () => FeatureData,
  onRecompute: () => void,
): void {
  const container = document.getElementById("climate-control");
  if (!container) return;
  const initial = getData().worldSettings?.season ?? 0;
  mountClimateControl(container, initial, {
    canEdit: hasBackend(),
    onToggle: (visible) => climate.setVisible(visible),
    onMetric: (metric) => climate.setMetric(metric, getData()),
    // Live preview: mutate the in-memory season input and recompute the derived
    // field — no DB round-trip, so scrubbing is smooth. This is the cascade in
    // action: change an authored input, the derived layer recomputes instantly.
    onSeasonPreview: (season) => {
      const ws = getData().worldSettings;
      if (ws) ws.season = season;
      climate.recompute(getData());
      onRecompute();
    },
    // Commit to world_settings on release so the change persists.
    onSeasonCommit: async (season) => {
      const ws = getData().worldSettings;
      if (!ws) return;
      try {
        await updateWorldSettings(ws.id, { season });
        setStatus(`Season set to ${season.toFixed(2)}.`);
      } catch (err) {
        setStatus(err instanceof Error ? err.message : String(err), "error");
      }
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
