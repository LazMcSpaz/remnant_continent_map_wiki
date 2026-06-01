// App entry point — Phase 1 map spine.
// Boots the MapLibre basemap, loads authored feature layers from Supabase,
// renders them, builds the derived network graph, and enables Terra Draw
// editing that writes back to the authored layer.

import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";
import type { Map as MlMap } from "maplibre-gl";
import type { Point } from "geojson";
import { createBasemap } from "./map/basemap";
import { loadFeatures, hasBackend, type FeatureData } from "./layers/features";
import { addFeatureLayers, updateFeatureData, setNameMode, onLocationClick, setSelectedLocation, onTerrainClick, setSelectedTerrain, onRouteClick, setSelectedRoute, setHighlightedRoutes, type NameMode } from "./layers/render";
import { buildNetworkGraph, edgeTravelHours, aggregateGroup, type NetworkGraph } from "./derived/network-graph";
import { mountEditorToolbar } from "./layers/editor";
import { WikiPanel, type WikiHost } from "./notes/wiki-panel";
import { mountIOToolbar } from "./state/io";
import { ClimateOverlay } from "./derived/climate-overlay";
import { WorldOverlay } from "./derived/world-overlay";
import { CoastOverlay } from "./derived/coast-overlay";
import { RiversOverlay } from "./derived/rivers-overlay";
import { ChokepointOverlay } from "./derived/chokepoint-overlay";
import { IsochroneOverlay } from "./derived/isochrone-overlay";
import { mountIsochroneControl, type IsochroneHost } from "./notes/isochrone-control";
import { TRAVEL_MODES } from "./derived/travel";
import { SimController } from "./sim/sim-controller";
import { mountSimControl } from "./sim/sim-control";
import { mountClimateControl } from "./derived/climate-control";
import { mountLayersPanel } from "./derived/layers-control";
import { TerrainPanel, type TerrainHost } from "./notes/terrain-panel";
import { RoutePanel, type RouteHost, type RouteDetail } from "./notes/route-panel";
import { GroupPanel, type GroupHost, type GroupMemberView } from "./notes/group-panel";
import { mountCorridorsControl, type CorridorsHost } from "./notes/corridors-control";
import { mountFactionsControl, type FactionsHost } from "./notes/factions-control";
import { updateFaction, setFactionRelation, createFaction, setLocationFaction } from "./layers/features";
import { buildRelationFn } from "./sim/relations";
import { deriveFactionStats } from "./derived/faction-stats";
import { createRouteGroup, addRouteGroupMember, createRoute } from "./layers/features";
import { RouteWizard } from "./layers/route-wizard";
import type { Position } from "geojson";
import { getSession, onAuthChange, signOut } from "./state/auth";
import { createLoginGate } from "./state/login-gate";
import { climateInputs } from "./derived/climate";
import { sampleClimate } from "./derived/climate-sample";
import { growingWarmth } from "./derived/climate";
import { deriveCityResources } from "./derived/resources";
import { addRouteBreak, setRouteBreakActive, deleteRouteBreak } from "./layers/features";
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
  const intact = graph.edges.filter((e) => e.status !== "destroyed").length;
  console.info(
    `[graph] ${graph.nodes.length} nodes, ${graph.edges.length} edges (${intact} not destroyed).`,
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

    // Panels anchor to the map area (below the header), not the whole app, so
    // they never overlap the header bar.
    const panelMount = document.querySelector<HTMLElement>(".map-area")
      ?? document.getElementById("app")
      ?? document.body;
    // The fictional world drawn as crisp vector art (coastline + biomes + rivers).
    const world = new WorldOverlay(map, setStatus);
    // The post-shift drowned coast, drawn over the real vector basemap. On by
    // default — it's the premise of the world — so build it now.
    const coast = new CoastOverlay(map, setStatus);
    coast.setVisible(true, data);
    // Derived climate overlay (Phase 2): a static raster, baked once on toggle.
    const climate = new ClimateOverlay(map, setStatus);
    climate.recompute(data);
    // Derived hydrology overlay: rivers from DEM flow accumulation.
    const rivers = new RiversOverlay(map, setStatus);
    rivers.recompute(data);
    // Phase 4 — flow simulation over the network graph.
    const sim = new SimController(map, () => data, () => graph, setStatus);
    // Phase 4 analysis — chokepoint / centrality detection over the graph.
    const chokepoints = new ChokepointOverlay(map, setStatus);
    chokepoints.recompute(graph, data.routes);
    // Phase 4 analysis — travel-time isochrones from a chosen origin + mode.
    const isochrones = new IsochroneOverlay(map);

    const host: WikiHost = {
      getDetail: (id) => data.locationDetails.get(id),
      getGraph: () => graph,
      getClimate: async (detail) => {
        if (!detail.lngLat) return null;
        const inp = climateInputs(data.worldSettings);
        const c = await sampleClimate(detail.lngLat, inp); // samples the DEM
        return {
          tempC: c.tempC,
          warmth: growingWarmth(c.growSeasonTempC),
          precip: c.precip,
          effLat: c.effLat,
          elevationM: c.elevationM,
          isWater: c.isWater,
          biomeLabel: c.biome.label,
          windBand: c.windBand,
          windBearing: c.windBearing,
          seasonLabel: seasonName(inp.season),
        };
      },
      getResources: async (detail) => {
        if (!detail.lngLat) return null;
        const inp = climateInputs(data.worldSettings);
        const overrides = (detail.resources ?? {}) as Record<string, number>;
        return deriveCityResources(detail.lngLat, overrides, inp);
      },
      getPressure: (detail) => {
        if (!sim.isVisible()) return null;
        const p = sim.pressureFor(detail.id);
        return p == null ? null : { pressure: p, turn: sim.maxTurn() };
      },
      listFactions: () => [...data.factions.values()].map((f) => ({ id: f.id, name: f.name })),
      setLocationFaction: (locationId, factionId) => setLocationFaction(locationId, factionId),
      createFaction: (name, tier) => createFaction(name, tier),
      canEdit: () => hasBackend(),
      setStatus,
      navigateTo: (id) => selectLocation(id),
      reloadData: async () => applyData(await loadFeatures()),
    };
    const wiki = new WikiPanel(panelMount, host, () => setSelectedLocation(map, null));

    // While placing a break, the next map click is consumed by placement — the
    // normal select handlers must ignore it. While adding members to a corridor,
    // route clicks add to that corridor instead of opening the route panel.
    let placingBreak = false;
    let addingToGroupId: string | null = null;
    let wizard: RouteWizard | null = null;
    const busy = () => placingBreak || addingToGroupId !== null || (wizard?.isActive() ?? false);

    /** Clear every panel + selection highlight (before opening a new one). */
    const clearSelections = (): void => {
      wiki.close();
      terrainPanel.close();
      routePanel.close();
      groupPanel.close();
      setSelectedLocation(map, null);
      setSelectedTerrain(map, null);
      setSelectedRoute(map, null);
      setHighlightedRoutes(map, []);
    };

    /** Select a location: highlight it, ease toward it, and open the panel. */
    const selectLocation = (id: string): void => {
      if (busy()) return;
      const detail = data.locationDetails.get(id);
      if (!detail) return;
      clearSelections();
      setSelectedLocation(map, id);
      if (detail.lngLat) map.easeTo({ center: detail.lngLat, duration: 500 });
      wiki.open(id);
    };

    onLocationClick(map, selectLocation);

    // Route panel. Class/status feed the network graph, so saving recomputes it.
    const findRoute = (id: string): RouteDetail | undefined => {
      const f = data.routes.features.find((ff) => ff.properties.id === id);
      if (!f) return undefined;
      const edge = graph.edges.find((e) => e.routeId === id);
      return {
        props: f.properties,
        lengthKm: edge?.lengthKm ?? null,
        travelHours: edge ? edgeTravelHours(edge) : 0,
      };
    };
    const routeHost: RouteHost = {
      getRoute: findRoute,
      getChokepoint: (routeId) => {
        const a = chokepoints.getAnalysis();
        const e = a?.edges.find((x) => x.routeId === routeId);
        return e ? { score: e.score, betweenness: e.betweenness, cutImpact: e.cutImpact } : null;
      },
      factions: () => [...data.factions.values()],
      getBreaks: (routeId) => data.routeBreaks.filter((b) => b.route_id === routeId),
      beginPlaceBreak: (routeId, kind) => {
        placingBreak = true;
        setStatus("Click the spot on the route to place the break.");
        map.getCanvas().style.cursor = "crosshair";
        map.once("click", (e) => {
          const point: Point = { type: "Point", coordinates: [e.lngLat.lng, e.lngLat.lat] };
          addRouteBreak(routeId, point, kind)
            .then(async () => {
              applyData(await loadFeatures());
              setStatus("Break placed.");
            })
            .catch((err: unknown) => setStatus(err instanceof Error ? err.message : String(err), "error"))
            .finally(() => {
              placingBreak = false;
              map.getCanvas().style.cursor = "";
            });
        });
      },
      setBreakActive: (id, active) => setRouteBreakActive(id, active),
      deleteBreak: (id) => deleteRouteBreak(id),
      reloadData: async () => applyData(await loadFeatures()),
      canEdit: () => hasBackend(),
      setStatus,
    };
    const routePanel = new RoutePanel(panelMount, routeHost, () => setSelectedRoute(map, null));
    const selectRoute = (id: string): void => {
      if ((placingBreak || (wizard?.isActive() ?? false)) || !findRoute(id)) return;
      // In corridor add-members mode, route clicks add to the corridor instead.
      if (addingToGroupId) {
        const gid = addingToGroupId;
        addRouteGroupMember(gid, id)
          .then(async () => {
            applyData(await loadFeatures());
            setStatus("Added segment to corridor. Click more, or press Esc to finish.");
          })
          .catch((err: unknown) => setStatus(err instanceof Error ? err.message : String(err), "error"));
        return;
      }
      clearSelections();
      setSelectedRoute(map, id);
      routePanel.open(id);
    };
    onRouteClick(map, selectRoute);

    // Corridors (route groups). Aggregate state is derived from members.
    const memberIdsOf = (groupId: string): string[] =>
      data.groupMembers.filter((m) => m.group_id === groupId).map((m) => m.route_id);

    const groupHost: GroupHost = {
      getGroup: (id) => data.routeGroups.find((g) => g.id === id),
      getMembers: (id): GroupMemberView[] =>
        memberIdsOf(id).map((rid) => {
          const f = data.routes.features.find((ff) => ff.properties.id === rid);
          const edge = graph.edges.find((e) => e.routeId === rid);
          const severed = edge ? edge.status === "destroyed" : false;
          const p = f?.properties;
          return { routeId: rid, label: p ? `${p.routeClass} ${p.kind}` : "route", severed };
        }),
      getAggregate: (id) => aggregateGroup(memberIdsOf(id), graph),
      beginAddMembers: (groupId) => {
        addingToGroupId = groupId;
        setStatus("Click routes to add to the corridor. Press Esc to finish.");
      },
      reloadData: async () => applyData(await loadFeatures()),
      canEdit: () => hasBackend(),
      setStatus,
    };
    const groupPanel = new GroupPanel(panelMount, groupHost, () => setHighlightedRoutes(map, []));

    const selectGroup = (id: string): void => {
      if (!data.routeGroups.some((g) => g.id === id)) return;
      clearSelections();
      setHighlightedRoutes(map, memberIdsOf(id));
      groupPanel.open(id);
    };

    const corridorsHost: CorridorsHost = {
      listGroups: () => data.routeGroups,
      isClosed: (id) => aggregateGroup(memberIdsOf(id), graph).closed,
      openGroup: selectGroup,
      newCorridor: () => {
        const name = window.prompt("Corridor name:")?.trim();
        if (!name) return;
        createRouteGroup(name, [])
          .then(async (gid) => {
            applyData(await loadFeatures());
            selectGroup(gid);
            groupHost.beginAddMembers(gid);
          })
          .catch((err: unknown) => setStatus(err instanceof Error ? err.message : String(err), "error"));
      },
      canEdit: () => hasBackend(),
    };
    const corridorsControl = mountCorridorsControl(
      document.getElementById("corridors-panel") ?? document.createElement("div"),
      corridorsHost,
    );

    // Factions panel: economy attributes (tech, influence) + relationship matrix.
    const factionsHost: FactionsHost = {
      listFactions: () => {
        const stats = deriveFactionStats(data.locationDetails.values());
        return [...data.factions.values()].map((f) => {
          const s = stats.get(f.id);
          return {
            faction: f,
            techLevel: s?.techLevel ?? null,
            influence: s?.influence ?? 0,
            cityCount: s?.cityCount ?? 0,
            wealth: sim.isVisible() ? sim.wealthFor(f.id) : null,
          };
        });
      },
      relation: (a, b) => {
        const lv = buildRelationFn(data.factionRelations)(a, b);
        return lv === "self" ? "friendly" : lv; // db stance has no "self"
      },
      setTier: async (id, tier) => {
        await updateFaction(id, { tier });
        applyData(await loadFeatures());
      },
      setColor: async (id, color) => {
        await updateFaction(id, { color });
        applyData(await loadFeatures());
      },
      setRelation: async (a, b, level) => {
        await setFactionRelation(a, b, level);
        applyData(await loadFeatures());
      },
      canEdit: () => hasBackend(),
    };
    const factionsControl = mountFactionsControl(
      document.getElementById("factions-panel") ?? document.createElement("div"),
      factionsHost,
    );

    // Reachability isochrones: route from a chosen origin city at a travel mode.
    const isochroneHost: IsochroneHost = {
      originCities: () =>
        [...data.locationDetails.values()]
          .filter((d) => d.lngLat != null)
          .map((d) => ({ id: d.id, name: d.name }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      run: (originLocationId, modeId) => {
        const mode = TRAVEL_MODES.find((m) => m.id === modeId) ?? TRAVEL_MODES[0];
        const iso = isochrones.show(graph, data.routes, `loc:${originLocationId}`, mode);
        return iso.cities.map((c) => ({
          locationId: c.locationId as string,
          name: c.name,
          hours: c.hours,
        }));
      },
      clear: () => isochrones.clear(),
    };
    mountIsochroneControl(
      document.getElementById("isochrone-panel") ?? document.createElement("div"),
      isochroneHost,
    );

    // Esc ends corridor add-members mode.
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && addingToGroupId) {
        addingToGroupId = null;
        setStatus("Finished adding segments.");
      }
    });

    // Multi-step route creation wizard (launched by the +Route tool button).
    const MOUNTAIN_ELEV_M = 1500;
    const STEEP_SLOPE_DEG = 15;
    wizard = new RouteWizard(map, panelMount, {
      factions: () => [...data.factions.values()],
      barrierRings: () => {
        const rings: Position[][] = [];
        for (const r of data.terrainRegions) {
          const isBarrier =
            r.land_cover === "forest" ||
            (r.elevation_m ?? 0) >= MOUNTAIN_ELEV_M ||
            (r.slope_deg ?? 0) >= STEEP_SLOPE_DEG;
          if (!isBarrier) continue;
          for (const poly of r.geometry.coordinates) if (poly[0]) rings.push(poly[0]);
        }
        return rings;
      },
      snapPoints: () => {
        const pts: Position[] = [];
        for (const f of data.locations.features) {
          if (f.geometry.type === "Point") pts.push(f.geometry.coordinates);
        }
        for (const f of data.routes.features) {
          const c = f.geometry.coordinates;
          if (c.length) {
            pts.push(c[0]);
            pts.push(c[c.length - 1]);
          }
        }
        return pts;
      },
      createRoute: (geometry, opts) => createRoute(geometry, opts),
      reloadData: async () => applyData(await loadFeatures()),
      setStatus,
    });

    // Terrain editor panel. Editing physical inputs cascades into the derived
    // climate: reloadData → recompute → both panels refresh.
    const terrainHost: TerrainHost = {
      getRegion: (id) => data.terrainRegions.find((r) => r.id === id),
      getDerived: (id) => climate.get(id),
      reloadData: async () => applyData(await loadFeatures()),
      canEdit: () => hasBackend(),
      setStatus,
    };
    const terrainPanel = new TerrainPanel(panelMount, terrainHost, () => setSelectedTerrain(map, null));

    const selectTerrain = (id: string): void => {
      if (busy() || !data.terrainRegions.some((r) => r.id === id)) return;
      clearSelections();
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
      rivers.recompute(next);
      chokepoints.recompute(graph, next.routes);
      // Refresh an active isochrone overlay against the rebuilt graph, unless its
      // origin city no longer exists.
      if (isochrones.isActive()) {
        const origin = isochrones.getIsochrones()?.originNodeId;
        const mode = isochrones.getIsochrones()?.mode;
        const stillThere = origin && graph.nodes.some((n) => n.id === origin);
        if (origin && mode && stillThere) isochrones.show(graph, next.routes, origin, mode);
        else isochrones.clear();
      }
      if (wiki.isOpen()) wiki.rerenderActive();
      if (terrainPanel.isOpen()) terrainPanel.refresh();
      if (routePanel.isOpen()) routePanel.refresh();
      if (groupPanel.isOpen()) groupPanel.refresh();
      corridorsControl.refresh();
      factionsControl.refresh();
      sim.onDataChanged();
      // Keep the open corridor's member highlight in sync after edits.
      const gid = groupPanel.currentGroupId();
      if (gid) setHighlightedRoutes(map, memberIdsOf(gid));
      setStatus(summarize(next));
    };

    mountClimate(climate, () => data, () => {
      if (wiki.isOpen()) wiki.rerenderActive();
    });

    // Layers panel: toggle terrain / territories / routes / labels / climate.
    const layersEl = document.getElementById("layers-panel");
    if (layersEl) {
      mountLayersPanel(
        layersEl,
        map,
        climate,
        rivers,
        sim,
        (visible) => chokepoints.setVisible(visible, graph, data.routes),
        (visible) => world.setVisible(visible, data),
        (visible) => coast.setVisible(visible, data),
      );
    }

    // Flow-simulation control (turn slider, play/step/reset).
    const simEl = document.getElementById("sim-control");
    if (simEl) mountSimControl(simEl, sim);

    if (!hasBackend()) {
      setStatus("No backend configured — viewer only. Set VITE_SUPABASE_* in web/.env.");
    } else {
      setStatus(summarize(data));
      initSignOut();
      mountEditor(map, () => data, applyData, () => wizard?.start());
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
function mountEditor(
  map: MlMap,
  getData: () => FeatureData,
  applyData: (d: FeatureData) => void,
  onRouteWizard: () => void,
): void {
  const toolbar = document.getElementById("editor-toolbar");
  if (!toolbar) return;
  mountEditorToolbar(map, toolbar, {
    onStatus: setStatus,
    defaultFactionId: () => {
      const first = getData().factions.keys().next();
      return first.done ? null : first.value;
    },
    onChange: async () => applyData(await loadFeatures()),
    onRouteWizard,
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
    onMetric: (metric) => climate.setMetric(metric),
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

/**
 * Entry. The deployed app is fully private: when a backend is configured, the
 * map only boots after a session exists; otherwise the login gate is shown.
 * With no backend (local dev sans env), boot directly as an offline viewer.
 */
async function init(): Promise<void> {
  let booted = false;
  const bootOnce = () => {
    if (booted) return;
    booted = true;
    void boot();
  };

  if (!hasBackend()) {
    bootOnce(); // offline viewer; no auth possible
    return;
  }

  const appEl = document.getElementById("app") ?? document.body;

  // Reveal the app: hide the gate and boot once. Driven both by a successful
  // sign-in (the gate's callback) and by the auth-state subscription, so it
  // never depends on a single signal firing.
  let gate: ReturnType<typeof createLoginGate> | null = null;
  const enter = () => {
    gate?.hide();
    bootOnce();
  };
  gate = createLoginGate(appEl, enter);

  // React to auth changes: sign-in/refresh → enter; sign-out after entering →
  // reload to a clean, data-free state.
  onAuthChange((session) => {
    if (session) enter();
    else if (booted) window.location.reload();
  });

  // Initial check (onAuthChange isn't guaranteed to fire immediately).
  if ((await getSession()) !== null) enter();
  else gate.show();
}

/** Wire the header sign-out button (visible once signed in). */
function initSignOut(): void {
  const btn = document.getElementById("sign-out");
  if (!(btn instanceof HTMLButtonElement)) return;
  btn.hidden = false;
  btn.addEventListener("click", () => void signOut());
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void init());
} else {
  void init();
}
