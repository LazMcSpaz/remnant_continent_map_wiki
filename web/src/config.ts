// Runtime configuration, sourced from Vite env vars (see web/.env.example).
// Nothing map-source-related is hardcoded in app logic; it all flows through
// here so the basemap can be swapped (raster dev fallback → OSM vector tiles)
// without touching the map setup code.

export interface MapConfig {
  /** Full MapLibre vector style URL, if provided. Takes precedence. */
  styleUrl: string | null;
  /** Raster XYZ tile template used when no style URL is set. */
  rasterTileUrl: string;
  /** Attribution string for the raster fallback. */
  rasterAttribution: string;
}

/** Area of interest: continental North America, opening on the Midwest where
 *  the current data lives. The fiction maps onto real Midwest geography, but the
 *  map is pannable across the continent so you can build anywhere. */
export const AOI = {
  /** Initial center — the Missouri corridor (Omaha ↔ Kansas City). */
  center: [-95.9, 41.0] as [number, number],
  /** Open zoomed on the Midwest, not staring at an empty continent. */
  zoom: 4.2,
  minZoom: 2.5,
  maxZoom: 16,
  /** [west, south, east, north] — Alaska/Canada down to Panama, coast to coast. */
  maxBounds: [-170, 5, -50, 75] as [number, number, number, number],
  /**
   * Fixed extent the static climate overlay is computed over (once). Covers the
   * populated band of North America where the fiction lives — from northern
   * Mexico to southern Canada, coast to coast. Bounded so the one-time DEM load
   * stays light; panning beyond it simply shows no overlay there.
   */
  climateExtent: [-126, 22, -64, 52] as [number, number, number, number],
};

function str(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}

export function readMapConfig(): MapConfig {
  const env = import.meta.env;
  const styleUrl = str(env.VITE_MAP_STYLE_URL, "");
  return {
    styleUrl: styleUrl === "" ? null : styleUrl,
    // CARTO "Voyager — no labels": real roads, highways, and rail (which the
    // routes tool depends on) but NO baked-in place names — so the new-north
    // rotation can't flip any text upside-down, and the real-world labels stop
    // fighting the fiction. {s} cycles a/b/c/d subdomains. Override with
    // VITE_RASTER_TILE_URL (e.g. back to OSM) if desired.
    rasterTileUrl: str(
      env.VITE_RASTER_TILE_URL,
      "https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}.png",
    ),
    rasterAttribution: str(
      env.VITE_RASTER_ATTRIBUTION,
      "© OpenStreetMap contributors © CARTO",
    ),
  };
}
