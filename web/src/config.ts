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

/** Area of interest: the Midwest corridor the fiction maps onto. */
export const MIDWEST = {
  /** Roughly centered on the Missouri corridor (Omaha ↔ Kansas City). */
  center: [-95.9, 41.0] as [number, number],
  zoom: 5,
  minZoom: 3,
  maxZoom: 16,
  /** [west, south, east, north] — Denver to the Great Lakes, broadly. */
  maxBounds: [-110.0, 35.0, -82.0, 49.5] as [number, number, number, number],
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
