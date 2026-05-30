// Renders authored feature layers onto the MapLibre map as GeoJSON sources +
// styled layers. Pure presentation: it reads FeatureData and draws. Editing
// (Terra Draw) comes in a later step; for now layers are display + hover/click.

import type { Map as MlMap, MapGeoJSONFeature, GeoJSONSource } from "maplibre-gl";
import maplibregl from "maplibre-gl";
import type { FeatureData } from "./features";

export const SRC = {
  terrain: "rc-terrain",
  territories: "rc-territories",
  routes: "rc-routes",
  locations: "rc-locations",
} as const;

const LAYER = {
  terrainFill: "rc-terrain-fill",
  terrainLine: "rc-terrain-line",
  terrainHighlight: "rc-terrain-highlight",
  territoryFill: "rc-territory-fill",
  territoryLine: "rc-territory-line",
  routeLine: "rc-route-line",
  routeLineDashed: "rc-route-line-dashed",
  routeHighlight: "rc-route-highlight",
  locationCircle: "rc-location-circle",
  locationHighlight: "rc-location-highlight",
} as const;

/** Land-cover fill expression for the authored terrain area layer. */
const LAND_COVER_FILL: maplibregl.ExpressionSpecification = [
  "match",
  ["get", "landCover"],
  "forest", "#2f6b3f",
  "grassland", "#7d9b4e",
  "cropland", "#caa54a",
  "wetland", "#3f7d7a",
  "desert", "#c8a06a",
  "urban", "#7a7a85",
  "water", "#2b5d8a",
  "barren", "#8a7d6b",
  "tundra", "#9aa7a0",
  "#6b6b75",
];

/** Whether to show new-world (fiction) or old-world (real) place names. */
export type NameMode = "new" | "old";

export function addFeatureLayers(map: MlMap, data: FeatureData, nameMode: NameMode): void {
  map.addSource(SRC.terrain, { type: "geojson", data: data.terrain });
  map.addSource(SRC.territories, { type: "geojson", data: data.territories });
  map.addSource(SRC.routes, { type: "geojson", data: data.routes });
  map.addSource(SRC.locations, { type: "geojson", data: data.locations });

  // Terrain (authored area inputs): land-cover fill, drawn beneath everything.
  // A faint base so it informs without dominating the basemap.
  map.addLayer({
    id: LAYER.terrainFill,
    type: "fill",
    source: SRC.terrain,
    paint: {
      "fill-color": LAND_COVER_FILL,
      "fill-opacity": 0.22,
    },
  });
  map.addLayer({
    id: LAYER.terrainLine,
    type: "line",
    source: SRC.terrain,
    paint: { "line-color": "#ffffff", "line-width": 0.5, "line-opacity": 0.25 },
  });
  // Selected-terrain outline; filtered to the chosen region id.
  map.addLayer({
    id: LAYER.terrainHighlight,
    type: "line",
    source: SRC.terrain,
    filter: ["==", ["get", "id"], "__none__"],
    paint: { "line-color": "#ffd166", "line-width": 2.5, "line-opacity": 0.95 },
  });

  // Territories: translucent fill + outline, colored by faction.
  map.addLayer({
    id: LAYER.territoryFill,
    type: "fill",
    source: SRC.territories,
    paint: { "fill-color": ["get", "factionColor"], "fill-opacity": 0.18 },
  });
  map.addLayer({
    id: LAYER.territoryLine,
    type: "line",
    source: SRC.territories,
    paint: { "line-color": ["get", "factionColor"], "line-width": 1.5, "line-opacity": 0.7 },
  });

  // Routes. line-dasharray can't be data-driven in MapLibre, so we use two
  // layers with mutually-exclusive status filters: intact = solid, everything
  // else = dashed (and destroyed is also faded via opacity).
  const routeColor: maplibregl.ExpressionSpecification = [
    "match",
    ["get", "purpose"],
    "trade", "#e0af68",
    "common", "#6ea8fe",
    "owner", "#bb9af7",
    "#9aa6b2",
  ];
  // Width by class: major routes read as trunk lines, secret as faint paths.
  const routeWidth: maplibregl.ExpressionSpecification = [
    "match", ["get", "routeClass"], "major", 4, "minor", 2.5, "secret", 1.5, 2.5,
  ];
  // Secret routes are dimmer; destroyed dimmer still.
  const routeOpacity: maplibregl.ExpressionSpecification = [
    "case",
    ["==", ["get", "status"], "destroyed"], 0.35,
    ["==", ["get", "routeClass"], "secret"], 0.6,
    1,
  ];

  // Selection halo for routes, drawn beneath the route lines.
  map.addLayer({
    id: LAYER.routeHighlight,
    type: "line",
    source: SRC.routes,
    filter: ["==", ["get", "id"], "__none__"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#ffd166", "line-width": ["+", routeWidth, 5], "line-opacity": 0.8 },
  });
  map.addLayer({
    id: LAYER.routeLine,
    type: "line",
    source: SRC.routes,
    filter: ["==", ["get", "status"], "intact"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": routeColor, "line-width": routeWidth, "line-opacity": routeOpacity },
  });
  map.addLayer({
    id: LAYER.routeLineDashed,
    type: "line",
    source: SRC.routes,
    filter: ["!=", ["get", "status"], "intact"],
    layout: { "line-cap": "butt", "line-join": "round" },
    paint: {
      "line-color": routeColor,
      "line-width": routeWidth,
      "line-opacity": routeOpacity,
      "line-dasharray": [2, 1.5],
    },
  });

  // Selection halo, drawn under the markers; filtered to the selected id.
  map.addLayer({
    id: LAYER.locationHighlight,
    type: "circle",
    source: SRC.locations,
    filter: ["==", ["get", "id"], "__none__"],
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 9, 10, 15],
      "circle-color": "#ffffff",
      "circle-opacity": 0.18,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
      "circle-stroke-opacity": 0.9,
    },
  });

  // Locations: circle markers colored by faction.
  map.addLayer({
    id: LAYER.locationCircle,
    type: "circle",
    source: SRC.locations,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 4, 10, 8],
      "circle-color": ["get", "factionColor"],
      "circle-stroke-color": "#0e1116",
      "circle-stroke-width": 1.5,
    },
  });

  // Labels are HTML markers (see renderLabels), not a glyph symbol layer —
  // avoids any external font/glyphs dependency on the raster style.
  renderLabels(map, data, nameMode);

  wireInteractions(map);
}

// --- City labels as HTML markers -------------------------------------------
// A glyph-based symbol layer needs a `glyphs` font server, which is a fragile
// external dependency on the raster fallback style. With only a handful of
// places, lightweight HTML markers are simpler and dependency-free.

let labelMarkers: maplibregl.Marker[] = [];
let labelMode: NameMode = "new";
let labelsVisible = true;

/** Feature groups that can be toggled as whole layers from the layers panel. */
export type LayerGroup = "terrain" | "territories" | "routes" | "labels";
const GROUP_LAYERS: Record<LayerGroup, string[]> = {
  terrain: [LAYER.terrainFill, LAYER.terrainLine, LAYER.terrainHighlight],
  territories: [LAYER.territoryFill, LAYER.territoryLine],
  routes: [LAYER.routeLine, LAYER.routeLineDashed, LAYER.routeHighlight],
  labels: [],
};

/** Show/hide a whole feature group (also makes it un-clickable when hidden). */
export function setGroupVisible(map: MlMap, group: LayerGroup, visible: boolean): void {
  for (const id of GROUP_LAYERS[group]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
  }
  if (group === "labels") {
    labelsVisible = visible;
    for (const m of labelMarkers) m.getElement().style.display = visible ? "" : "none";
  }
}

function applyLabelText(el: HTMLElement, mode: NameMode): void {
  const name = el.dataset.name ?? "";
  const old = el.dataset.old ?? "";
  el.textContent = mode === "old" ? old || name : name;
}

/** Rebuild the city-name markers from the current locations + name mode. */
export function renderLabels(map: MlMap, data: FeatureData, mode: NameMode): void {
  labelMode = mode;
  for (const m of labelMarkers) m.remove();
  labelMarkers = [];
  for (const f of data.locations.features) {
    if (f.geometry.type !== "Point") continue;
    const el = document.createElement("div");
    el.className = "map-label";
    el.dataset.name = f.properties.name;
    el.dataset.old = f.properties.oldWorldName ?? "";
    applyLabelText(el, mode);
    if (!labelsVisible) el.style.display = "none";
    const marker = new maplibregl.Marker({ element: el, anchor: "top", offset: [0, 8] })
      .setLngLat(f.geometry.coordinates as [number, number])
      .addTo(map);
    labelMarkers.push(marker);
  }
}

/** Switch place labels between fiction and real-world names without a reload. */
export function setNameMode(_map: MlMap, mode: NameMode): void {
  labelMode = mode;
  for (const marker of labelMarkers) applyLabelText(marker.getElement(), mode);
}

/** Replace data in place (after an edit/reload) without re-adding layers. */
export function updateFeatureData(map: MlMap, data: FeatureData): void {
  (map.getSource(SRC.terrain) as GeoJSONSource | undefined)?.setData(data.terrain);
  (map.getSource(SRC.territories) as GeoJSONSource | undefined)?.setData(data.territories);
  (map.getSource(SRC.routes) as GeoJSONSource | undefined)?.setData(data.routes);
  (map.getSource(SRC.locations) as GeoJSONSource | undefined)?.setData(data.locations);
  renderLabels(map, data, labelMode); // rebuild HTML name markers
}

function wireInteractions(map: MlMap): void {
  const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });

  const showLocation = (e: { features?: MapGeoJSONFeature[]; lngLat: maplibregl.LngLat }) => {
    const f = e.features?.[0];
    if (!f) return;
    const p = f.properties as Record<string, string | null>;
    const old = p.oldWorldName ? ` <span style="opacity:.6">(was ${p.oldWorldName})</span>` : "";
    popup
      .setLngLat(e.lngLat)
      .setHTML(`<strong>${p.name ?? "?"}</strong>${old}<br><small>${p.type ?? ""}</small>`)
      .addTo(map);
  };

  map.on("mouseenter", LAYER.locationCircle, (e) => {
    map.getCanvas().style.cursor = "pointer";
    showLocation(e);
  });
  map.on("mouseleave", LAYER.locationCircle, () => {
    map.getCanvas().style.cursor = "";
    popup.remove();
  });
}

/** Register a handler fired with the location id when a city marker is clicked. */
export function onLocationClick(map: MlMap, handler: (locationId: string) => void): void {
  map.on("click", LAYER.locationCircle, (e) => {
    const f = e.features?.[0];
    const id = f?.properties?.id;
    if (typeof id === "string") handler(id);
  });
}

/** Highlight the selected location marker (or clear with null). */
export function setSelectedLocation(map: MlMap, locationId: string | null): void {
  if (!map.getLayer(LAYER.locationHighlight)) return;
  map.setFilter(LAYER.locationHighlight, [
    "==",
    ["get", "id"],
    locationId ?? "__none__",
  ]);
}

/** Register a handler fired with the route id when a route line is clicked. */
export function onRouteClick(map: MlMap, handler: (routeId: string) => void): void {
  const onClick = (e: maplibregl.MapMouseEvent) => {
    // Don't steal clicks meant for a city marker on top of the line.
    if (map.getLayer(LAYER.locationCircle)) {
      const onCity = map.queryRenderedFeatures(e.point, { layers: [LAYER.locationCircle] });
      if (onCity.length > 0) return;
    }
    const hit = map.queryRenderedFeatures(e.point, {
      layers: [LAYER.routeLine, LAYER.routeLineDashed].filter((id) => map.getLayer(id)),
    });
    const id = hit[0]?.properties?.id;
    if (typeof id === "string") handler(id);
  };
  for (const layer of [LAYER.routeLine, LAYER.routeLineDashed]) {
    map.on("click", layer, onClick);
    map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
  }
}

/** Outline the selected route (or clear with null). */
export function setSelectedRoute(map: MlMap, routeId: string | null): void {
  if (!map.getLayer(LAYER.routeHighlight)) return;
  map.setFilter(LAYER.routeHighlight, ["==", ["get", "id"], routeId ?? "__none__"]);
}

/** Register a handler fired with the terrain region id when its fill is clicked. */
export function onTerrainClick(map: MlMap, handler: (terrainId: string) => void): void {
  map.on("click", LAYER.terrainFill, (e) => {
    // A city marker sits above the terrain fill; if the click also hit one, let
    // the location handler win and ignore it here.
    if (map.getLayer(LAYER.locationCircle)) {
      const onCity = map.queryRenderedFeatures(e.point, { layers: [LAYER.locationCircle] });
      if (onCity.length > 0) return;
    }
    const f = e.features?.[0];
    const id = f?.properties?.id;
    if (typeof id === "string") handler(id);
  });
  map.on("mouseenter", LAYER.terrainFill, () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", LAYER.terrainFill, () => {
    map.getCanvas().style.cursor = "";
  });
}

/** Outline the selected terrain region (or clear with null). */
export function setSelectedTerrain(map: MlMap, terrainId: string | null): void {
  if (!map.getLayer(LAYER.terrainHighlight)) return;
  map.setFilter(LAYER.terrainHighlight, ["==", ["get", "id"], terrainId ?? "__none__"]);
}
