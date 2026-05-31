// Elevation sampling from Terrarium terrain-RGB tiles (free, no key). Runs in
// the browser: fetch the PNG tile for a point, decode the pixel to metres.
// Tiles are cached. Returns null on failure so callers can fall back to sea
// level (climate still computes from latitude alone).
//
//   elevation = (R * 256 + G + B / 256) - 32768   [Terrarium encoding]
//
// Configure the tile source with VITE_DEM_URL; the host must also be allowed in
// connect-src/img-src (web/public/_headers).

const DEM_URL =
  (typeof import.meta.env.VITE_DEM_URL === "string" && import.meta.env.VITE_DEM_URL.trim()) ||
  "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png";

const ZOOM = 8; // ~600 m/px at the equator — plenty for climate
const TILE = 256;

const tileCache = new Map<string, Promise<ImageData | null>>();

function lngLatToTile(lng: number, lat: number, z: number) {
  const n = 2 ** z;
  const latRad = (lat * Math.PI) / 180;
  const xf = ((lng + 180) / 360) * n;
  const yf = ((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n;
  return { xf, yf, x: Math.floor(xf), y: Math.floor(yf), n };
}

function tileUrl(z: number, x: number, y: number): string {
  return DEM_URL.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
}

function loadTile(z: number, x: number, y: number): Promise<ImageData | null> {
  const key = `${z}/${x}/${y}`;
  const existing = tileCache.get(key);
  if (existing) return existing;
  const p = new Promise<ImageData | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = TILE;
        c.height = TILE;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0);
        resolve(ctx.getImageData(0, 0, TILE, TILE));
      } catch {
        resolve(null); // tainted canvas / CORS — fall back
      }
    };
    img.onerror = () => resolve(null);
    img.src = tileUrl(z, x, y);
  });
  tileCache.set(key, p);
  return p;
}

/** Decode the elevation (m) of one pixel of a loaded tile. */
function decodePixel(data: ImageData, xf: number, yf: number, x: number, y: number): number {
  const px = Math.min(TILE - 1, Math.max(0, Math.floor((xf - x) * TILE)));
  const py = Math.min(TILE - 1, Math.max(0, Math.floor((yf - y) * TILE)));
  const i = (py * TILE + px) * 4;
  return data.data[i] * 256 + data.data[i + 1] + data.data[i + 2] / 256 - 32768;
}

/**
 * Elevation in metres at a point, or null if the DEM tile is unavailable.
 * `z` overrides the tile zoom. Defaults to ZOOM for point lookups.
 */
export async function sampleElevation(lng: number, lat: number, z: number = ZOOM): Promise<number | null> {
  if (lat > 85 || lat < -85) return 0;
  const { xf, yf, x, y } = lngLatToTile(lng, lat, z);
  const data = await loadTile(z, x, y);
  if (!data) return null;
  return decodePixel(data, xf, yf, x, y);
}

/**
 * A block of DEM tiles covering a bbox, preloaded so a region can be sampled
 * **synchronously** (no per-pixel awaits). The static climate overlay loads one
 * block once, then rasterizes the whole field from it. `z` is chosen as high as
 * possible while keeping the tile count under `maxTiles`.
 */
export interface DemBlock {
  z: number;
  tiles: Map<string, ImageData | null>;
}

/** Load every DEM tile covering [west,south,east,north] at a bounded zoom. */
export async function loadDemBlock(
  west: number,
  south: number,
  east: number,
  north: number,
  maxZoom = 6,
  maxTiles = 240,
): Promise<DemBlock> {
  let z = maxZoom;
  for (; z > 3; z--) {
    const a = lngLatToTile(west, north, z);
    const b = lngLatToTile(east, south, z);
    const nx = Math.abs(b.x - a.x) + 1;
    const ny = Math.abs(b.y - a.y) + 1;
    if (nx * ny <= maxTiles) break;
  }
  const a = lngLatToTile(west, north, z);
  const b = lngLatToTile(east, south, z);
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  const tiles = new Map<string, ImageData | null>();
  const jobs: Promise<void>[] = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      jobs.push(loadTile(z, x, y).then((d) => void tiles.set(`${x}/${y}`, d)));
    }
  }
  await Promise.all(jobs);
  return { z, tiles };
}

/** Synchronous elevation (m) from a preloaded block, or null if missing. */
export function elevationFromBlock(block: DemBlock, lng: number, lat: number): number | null {
  if (lat > 85 || lat < -85) return 0;
  const { xf, yf, x, y } = lngLatToTile(lng, lat, block.z);
  const t = block.tiles.get(`${x}/${y}`);
  if (!t) return null;
  return decodePixel(t, xf, yf, x, y);
}

/** Sample elevation, treating "no data" as sea level (0). Convenience wrapper. */
export async function sampleElevationOrZero(lng: number, lat: number): Promise<number> {
  return (await sampleElevation(lng, lat)) ?? 0;
}
