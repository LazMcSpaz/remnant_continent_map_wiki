// War-room basemap restyle. The MapTiler vector style does the hard cartography
// (zoom-dependent road tapering, water polygons, generalization); we just
// repaint its layers to match the setting:
//
//   • near-black land + water substrate, so authored features (routes,
//     territories, city markers) and the derived overlays glow on top;
//   • thin, cool-grey roads/rail that read as a network, not clutter;
//   • luminous waterways; hidden real-world labels (only our new-world names
//     show, as upright HTML markers).
//
// It's data-driven: we classify each layer by type + source-layer name (the
// OpenMapTiles schema MapTiler uses) and recolor, rather than hardcoding layer
// ids — so it survives minor style revisions. Applied once on load and re-run
// if the style reloads.

import type { Map as MlMap, LayerSpecification } from "maplibre-gl";

/** Shared water color — used for BOTH the real basemap water and our newly
 *  drowned seas, so new and existing water read identically. Brightened a
 *  couple of shades from the original near-black so water is legible. */
export const WATER_COLOR = "#15324a";

/** War-room palette. */
export const WAR_ROOM = {
  land: "#0e141b",
  landAlt: "#121922", // parks/landuse, a hair lighter so they read faintly
  water: WATER_COLOR,
  waterLine: "#3a7fa0", // rivers/canals — luminous cool
  roadMajor: "#3a4654",
  roadMinor: "#28323d",
  rail: "#39424d",
  boundary: "#2a3340",
  building: "#161d26",
} as const;

/** Does this source-layer name look like the given category? (OpenMapTiles.) */
function isWaterPoly(sl: string): boolean {
  return sl === "water" || sl === "ocean";
}
function isWaterLine(sl: string): boolean {
  return sl === "waterway";
}
function isRoad(sl: string): boolean {
  return sl === "transportation";
}
function isBuilding(sl: string): boolean {
  return sl === "building";
}
function isBoundary(sl: string): boolean {
  return sl === "boundary";
}
function isLanduse(sl: string): boolean {
  return sl === "landuse" || sl === "landcover" || sl === "park";
}

/** Brighter road color used when the Roads layer is toggled on. */
const ROAD_ON_MAJOR = "#8a8f96";
const ROAD_ON_MINOR = "#6b717a";

/**
 * Toggle the basemap road lines (`source-layer === "transportation"`) between
 * the war-room dim palette and a clearly-visible brighter palette.
 * Safe to call at any zoom / style version.
 */
export function setRoadsVisible(map: MlMap, visible: boolean): void {
  const style = map.getStyle();
  if (!style?.layers) return;
  for (const layer of style.layers as LayerSpecification[]) {
    if (layer.id.startsWith("rc-")) continue;
    const sl = (layer as { "source-layer"?: string })["source-layer"] ?? "";
    if (layer.type !== "line" || sl !== "transportation") continue;
    try {
      if (visible) {
        map.setPaintProperty(layer.id, "line-color", [
          "match",
          ["get", "class"],
          ["motorway", "trunk", "primary"], ROAD_ON_MAJOR,
          ROAD_ON_MINOR,
        ]);
        map.setPaintProperty(layer.id, "line-opacity", 1);
      } else {
        map.setPaintProperty(layer.id, "line-color", [
          "match",
          ["get", "class"],
          ["motorway", "trunk", "primary"], WAR_ROOM.roadMajor,
          WAR_ROOM.roadMinor,
        ]);
        map.setPaintProperty(layer.id, "line-opacity", 0.9);
      }
    } catch {
      // Layer doesn't support the property — skip.
    }
  }
}

/**
 * Toggle the basemap's real-world label layers (type === "symbol"). They are
 * hidden by `applyWarRoomStyle`; this restores them when the user opts in.
 * Layers starting with `rc-` (our own overlays) are never touched.
 */
export function setRealNamesVisible(map: MlMap, visible: boolean): void {
  const style = map.getStyle();
  if (!style?.layers) return;
  for (const layer of style.layers as LayerSpecification[]) {
    if (layer.id.startsWith("rc-")) continue;
    if (layer.type !== "symbol") continue;
    try {
      map.setLayoutProperty(layer.id, "visibility", visible ? "visible" : "none");
    } catch {
      // Layer doesn't support visibility — skip.
    }
  }
}

/**
 * Repaint the loaded basemap into the war-room look and hide real labels.
 * Safe to call again after a style reload. Only touches basemap layers (those
 * with a vector source-layer); our own `rc-*` layers are left alone.
 */
export function applyWarRoomStyle(map: MlMap): void {
  const style = map.getStyle();
  if (!style?.layers) return;

  for (const layer of style.layers as LayerSpecification[]) {
    const id = layer.id;
    if (id.startsWith("rc-")) continue; // our own overlays
    const sl = (layer as { "source-layer"?: string })["source-layer"] ?? "";

    try {
      // Hide ALL symbol layers (place/road/water labels, shields, POIs). Our
      // new-world names render as HTML markers; real text is what felt wrong.
      if (layer.type === "symbol") {
        map.setLayoutProperty(id, "visibility", "none");
        continue;
      }

      if (layer.type === "background") {
        map.setPaintProperty(id, "background-color", WAR_ROOM.land);
        continue;
      }

      if (layer.type === "fill") {
        if (isWaterPoly(sl)) {
          map.setPaintProperty(id, "fill-color", WAR_ROOM.water);
          map.setPaintProperty(id, "fill-opacity", 1);
        } else if (isBuilding(sl)) {
          map.setPaintProperty(id, "fill-color", WAR_ROOM.building);
          map.setPaintProperty(id, "fill-opacity", 0.6);
        } else if (isLanduse(sl)) {
          map.setPaintProperty(id, "fill-color", WAR_ROOM.landAlt);
          map.setPaintProperty(id, "fill-opacity", 0.5);
        } else {
          // Generic land/earth fills → the base land tone.
          map.setPaintProperty(id, "fill-color", WAR_ROOM.land);
        }
        continue;
      }

      if (layer.type === "line") {
        if (isWaterLine(sl)) {
          map.setPaintProperty(id, "line-color", WAR_ROOM.waterLine);
          map.setPaintProperty(id, "line-opacity", 0.85);
        } else if (isRoad(sl)) {
          // Major vs minor by the class field when present; default to minor.
          map.setPaintProperty(id, "line-color", [
            "match",
            ["get", "class"],
            ["motorway", "trunk", "primary"], WAR_ROOM.roadMajor,
            WAR_ROOM.roadMinor,
          ]);
          map.setPaintProperty(id, "line-opacity", 0.9);
        } else if (isBoundary(sl)) {
          map.setPaintProperty(id, "line-color", WAR_ROOM.boundary);
          map.setPaintProperty(id, "line-opacity", 0.6);
        } else {
          map.setPaintProperty(id, "line-color", WAR_ROOM.roadMinor);
        }
        continue;
      }

      if (layer.type === "fill-extrusion") {
        map.setPaintProperty(id, "fill-extrusion-color", WAR_ROOM.building);
        map.setPaintProperty(id, "fill-extrusion-opacity", 0.5);
      }
    } catch {
      // A property a given layer doesn't support — skip it, keep going.
    }
  }
}
