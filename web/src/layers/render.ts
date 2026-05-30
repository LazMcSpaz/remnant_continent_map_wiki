// Renders authored feature layers onto the MapLibre map as GeoJSON sources +
// styled layers. Pure presentation: it reads FeatureData and draws. Editing
// (Terra Draw) comes in a later step; for now layers are display + hover/click.

import type { Map as MlMap, MapGeoJSONFeature, GeoJSONSource } from "maplibre-gl";
import maplibregl from "maplibre-gl";
import type { FeatureData } from "./features";

export const SRC = {
  territories: "rc-territories",
  routes: "rc-routes",
  locations: "rc-locations",
} as const;

const LAYER = {
  territoryFill: "rc-territory-fill",
  territoryLine: "rc-territory-line",
  routeLine: "rc-route-line",
  locationCircle: "rc-location-circle",
  locationHighlight: "rc-location-highlight",
  locationLabel: "rc-location-label",
} as const;

/** Whether to show new-world (fiction) or old-world (real) place names. */
export type NameMode = "new" | "old";

export function addFeatureLayers(map: MlMap, data: FeatureData, nameMode: NameMode): void {
  map.addSource(SRC.territories, { type: "geojson", data: data.territories });
  map.addSource(SRC.routes, { type: "geojson", data: data.routes });
  map.addSource(SRC.locations, { type: "geojson", data: data.locations });

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

  // Routes: width by kind, dashed when damaged, faded+dashed when destroyed.
  map.addLayer({
    id: LAYER.routeLine,
    type: "line",
    source: SRC.routes,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": [
        "match",
        ["get", "purpose"],
        "trade", "#e0af68",
        "common", "#6ea8fe",
        "owner", "#bb9af7",
        "#9aa6b2",
      ],
      "line-width": ["match", ["get", "kind"], "rail", 3.5, "road", 2.5, 1.5],
      "line-opacity": ["match", ["get", "status"], "destroyed", 0.35, 1],
      "line-dasharray": [
        "match",
        ["get", "status"],
        "damaged", ["literal", [2, 1.5]],
        "destroyed", ["literal", [1, 1.5]],
        ["literal", [1, 0]],
      ],
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

  // Labels: toggle between new-world and old-world names.
  map.addLayer({
    id: LAYER.locationLabel,
    type: "symbol",
    source: SRC.locations,
    layout: {
      "text-field": nameField(nameMode),
      "text-size": 12,
      "text-offset": [0, 1.2],
      "text-anchor": "top",
      "text-font": ["Open Sans Regular", "Noto Sans Regular"],
    },
    paint: {
      "text-color": "#e7ecf3",
      "text-halo-color": "#0e1116",
      "text-halo-width": 1.2,
    },
  });

  wireInteractions(map);
}

function nameField(mode: NameMode): maplibregl.ExpressionSpecification {
  // Fall back to the other name when the preferred one is absent.
  return mode === "old"
    ? ["coalesce", ["get", "oldWorldName"], ["get", "name"]]
    : ["get", "name"];
}

/** Switch place labels between fiction and real-world names without a reload. */
export function setNameMode(map: MlMap, mode: NameMode): void {
  if (map.getLayer(LAYER.locationLabel)) {
    map.setLayoutProperty(LAYER.locationLabel, "text-field", nameField(mode));
  }
}

/** Replace data in place (after an edit/reload) without re-adding layers. */
export function updateFeatureData(map: MlMap, data: FeatureData): void {
  (map.getSource(SRC.territories) as GeoJSONSource | undefined)?.setData(data.territories);
  (map.getSource(SRC.routes) as GeoJSONSource | undefined)?.setData(data.routes);
  (map.getSource(SRC.locations) as GeoJSONSource | undefined)?.setData(data.locations);
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
