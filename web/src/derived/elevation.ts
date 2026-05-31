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

/** Elevation in metres at a point, or null if the DEM tile is unavailable. */
export async function sampleElevation(lng: number, lat: number): Promise<number | null> {
  if (lat > 85 || lat < -85) return 0;
  const { xf, yf, x, y } = lngLatToTile(lng, lat, ZOOM);
  const data = await loadTile(ZOOM, x, y);
  if (!data) return null;
  const px = Math.min(TILE - 1, Math.max(0, Math.floor((xf - x) * TILE)));
  const py = Math.min(TILE - 1, Math.max(0, Math.floor((yf - y) * TILE)));
  const i = (py * TILE + px) * 4;
  const r = data.data[i];
  const g = data.data[i + 1];
  const b = data.data[i + 2];
  return r * 256 + g + b / 256 - 32768;
}

/** Sample elevation, treating "no data" as sea level (0). Convenience wrapper. */
export async function sampleElevationOrZero(lng: number, lat: number): Promise<number> {
  return (await sampleElevation(lng, lat)) ?? 0;
}
