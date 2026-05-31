// Basemap + renderer setup (MapLibre GL JS).
//
// This is the "map spine" the rest of Phase 1 hangs off. It deliberately knows
// nothing about authored features, derived overlays, or the network graph —
// those live in their own modules (layers/, derived/) and attach to the map
// instance this module returns.

import maplibregl, { type StyleSpecification } from "maplibre-gl";
import { AOI, readMapConfig, type MapConfig } from "../config";
import { bearingToPole, DEFAULT_POLE } from "../derived/climate";

/** Expand a `{s}` subdomain template into explicit a/b/c/d tile URLs (MapLibre
 *  doesn't interpolate {s} itself). A URL without {s} is returned as-is. */
function expandSubdomains(url: string): string[] {
  if (!url.includes("{s}")) return [url];
  return ["a", "b", "c", "d"].map((s) => url.replace("{s}", s));
}

/** Build a minimal raster style as a dev fallback when no vector style is set. */
function rasterStyle(cfg: MapConfig): StyleSpecification {
  return {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: expandSubdomains(cfg.rasterTileUrl),
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
    // Orient "up" toward the NEW North Pole (Peru), not geographic north, so the
    // map reads in the post-shift frame. Computed at the area-of-interest centre
    // (a single bearing can only be exact at one point on a sphere). The compass
    // in the NavigationControl resets to true north if desired; a URL #hash
    // overrides this on shared links.
    bearing: bearingToPole(AOI.center, DEFAULT_POLE),
    attributionControl: false,
    hash: "map", // sync view to URL so a location is shareable
  });

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "imperial" }), "bottom-left");
  map.addControl(
    new maplibregl.AttributionControl({ compact: true }),
    "bottom-right",
  );

  // The `hash` option parses the URL (#map=zoom/lat/lng/bearing/pitch) AFTER the
  // constructor's `bearing`, so a stored hash with no bearing component resets
  // us to true north. If the hash didn't specify a bearing, (re)apply the pole
  // orientation; an explicit bearing in the URL still wins (shared links).
  if (!hashHasBearing()) {
    map.setBearing(bearingToPole(AOI.center, DEFAULT_POLE));
  }

  enableMiddleMousePan(map);

  const ready = new Promise<void>((resolve) => {
    map.on("load", () => resolve());
  });

  return { map, ready };
}

/** True when the URL hash (#map=zoom/lat/lng/bearing/…) carries a bearing. */
function hashHasBearing(): boolean {
  const m = /(?:^|&)map=([^&]+)/.exec(window.location.hash.replace(/^#/, ""));
  if (!m) return false;
  // zoom/lat/lng[/bearing[/pitch]] — a 4th field means a bearing was stored.
  return m[1].split("/").length >= 4;
}

/** Pan the map by dragging with the middle mouse button (button 1). */
function enableMiddleMousePan(map: maplibregl.Map): void {
  const canvas = map.getCanvas();
  let panning = false;
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener("mousedown", (e) => {
    if (e.button !== 1) return;
    e.preventDefault(); // suppress the browser's middle-click autoscroll
    panning = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.style.cursor = "grabbing";
  });
  window.addEventListener("mousemove", (e) => {
    if (!panning) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    map.panBy([-dx, -dy], { duration: 0 });
  });
  window.addEventListener("mouseup", (e) => {
    if (e.button === 1 && panning) {
      panning = false;
      canvas.style.cursor = "";
    }
  });
}
