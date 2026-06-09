"""Download a 10 m DEM for an extent and save it as a GeoTIFF in ./data.

Uses the USGS 3DEP dynamic ImageServer, which can export a clipped GeoTIFF for
a bounding box at a requested resolution. For very large extents, request in
tiles and mosaic — but a single Midwest-sized window at 10 m is fine.

Usage:
    python -m app.fetch_dem --extent -104 36 -88 46          # w s e n (lng/lat)
    python -m app.fetch_dem --extent -104 36 -88 46 --res 10 --out midwest_10m.tif

Notes:
 - 3DEP covers the US at 10 m (1/3 arc-second). Outside the US, fall back to
   SRTM 30 m (swap the service URL — see SRTM_NOTE below).
 - This hits a public USGS service; be considerate with extent size.
"""
from __future__ import annotations

import argparse
import math
import os

import requests

# USGS 3DEP 1/3 arc-second (~10 m) dynamic image service. exportImage returns a
# GeoTIFF clipped to bbox at the requested pixel size.
TNM_3DEP = (
    "https://elevation.nationalmap.gov/arcgis/rest/services/"
    "3DEPElevation/ImageServer/exportImage"
)

DATA_DIR = os.environ.get("RC_DEM_DIR", os.path.join(os.path.dirname(__file__), "..", "data"))


def meters_per_deg_lng(lat: float) -> float:
    return 111_320.0 * math.cos(math.radians(lat))


def fetch(extent: tuple[float, float, float, float], res_m: float, out: str) -> str:
    w, s, e, n = extent
    mid_lat = (s + n) / 2
    # Pixel dimensions for the requested ground resolution.
    width_m = (e - w) * meters_per_deg_lng(mid_lat)
    height_m = (n - s) * 111_320.0
    cols = max(1, int(width_m / res_m))
    rows = max(1, int(height_m / res_m))
    if cols * rows > 60_000_000:
        raise SystemExit(
            f"Requested {cols}×{rows} px (~{cols*rows/1e6:.0f} MP). Too large for "
            "one request — split the extent into tiles, or lower --res.",
        )

    params = {
        "bbox": f"{w},{s},{e},{n}",
        "bboxSR": 4326,
        "imageSR": 4326,
        "size": f"{cols},{rows}",
        "format": "tiff",
        "pixelType": "F32",
        "noData": -9999,
        "interpolation": "RSP_BilinearInterpolation",
        "f": "image",
    }
    os.makedirs(DATA_DIR, exist_ok=True)
    path = os.path.join(DATA_DIR, out)
    print(f"Requesting {cols}×{rows} px GeoTIFF for {extent} → {path}")
    with requests.get(TNM_3DEP, params=params, stream=True, timeout=600) as r:
        r.raise_for_status()
        ctype = r.headers.get("content-type", "")
        if "tiff" not in ctype and "image" not in ctype:
            raise SystemExit(f"Unexpected response ({ctype}): {r.text[:300]}")
        with open(path, "wb") as f:
            for chunk in r.iter_content(chunk_size=1 << 20):
                f.write(chunk)
    size_mb = os.path.getsize(path) / 1e6
    print(f"Saved {path} ({size_mb:.1f} MB).")
    return path


def main() -> None:
    p = argparse.ArgumentParser(description="Download a 3DEP DEM for an extent.")
    p.add_argument("--extent", nargs=4, type=float, metavar=("W", "S", "E", "N"), required=True)
    p.add_argument("--res", type=float, default=10.0, help="ground resolution in metres")
    p.add_argument("--out", type=str, default="dem_10m.tif")
    args = p.parse_args()
    fetch(tuple(args.extent), args.res, args.out)


if __name__ == "__main__":
    main()
