// Basemap + renderer setup (MapLibre GL JS).
//
// This is the "map spine" the rest of Phase 1 hangs off. It deliberately knows
// nothing about authored features, derived overlays, or the network graph —
// those live in their own modules (layers/, derived/) and attach to the map
// instance this module returns.

import maplibregl, { type StyleSpecification } from "maplibre-gl";
import { AOI, readMapConfig, type MapConfig } from "../config";

/** Build a minimal raster style as a dev fallback when no vector style is set. */
function rasterStyle(cfg: MapConfig): StyleSpecification {
  return {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: [cfg.rasterTileUrl],
        tileSize: 256,
        attribution: cfg.rasterAttribution,
      },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": "#0e1116" } },
      { id: "osm", type: "raster", source: "osm" },
    ],
  };
}

export interface BasemapHandle {
  map: maplibregl.Map;
  /** Resolves once the style has loaded and the map is interactive. */
  ready: Promise<void>;
}

/**
 * Create the MapLibre map, centered on the Midwest area of interest.
 * Uses a vector style URL if configured, otherwise a raster OSM fallback so the
 * app renders out of the box for local development.
 */
export function createBasemap(container: HTMLElement): BasemapHandle {
  const cfg = readMapConfig();

  const map = new maplibregl.Map({
    container,
    style: cfg.styleUrl ?? rasterStyle(cfg),
    center: AOI.center,
    zoom: AOI.zoom,
    minZoom: AOI.minZoom,
    maxZoom: AOI.maxZoom,
    maxBounds: AOI.maxBounds,
    attributionControl: false,
    hash: "map", // sync view to URL so a location is shareable
  });

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
  map.addControl(
    new maplibregl.AttributionControl({ compact: true }),
    "bottom-right",
  );

  const ready = new Promise<void>((resolve) => {
    map.on("load", () => resolve());
  });

  return { map, ready };
}
