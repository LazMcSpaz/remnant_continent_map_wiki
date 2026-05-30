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
};

function str(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}

export function readMapConfig(): MapConfig {
  const env = import.meta.env;
  const styleUrl = str(env.VITE_MAP_STYLE_URL, "");
  return {
    styleUrl: styleUrl === "" ? null : styleUrl,
    rasterTileUrl: str(
      env.VITE_RASTER_TILE_URL,
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    ),
    rasterAttribution: str(env.VITE_RASTER_ATTRIBUTION, "© OpenStreetMap contributors"),
  };
}
