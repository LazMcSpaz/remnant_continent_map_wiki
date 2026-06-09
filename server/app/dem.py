"""DEM loading + the composite elevation field.

Loads a local DEM GeoTIFF (e.g. mosaicked 10 m 3DEP), windows it to a bbox,
applies the brush edits as soft Gaussian deltas, and computes the post-shift
sea level surface. This is the server-side analogue of web/src/derived/terrain.ts
+ the sea-level model — but on real high-res data, with no browser memory limit.

The module keeps ONE DEM open per process (lazy, cached). For the US core that's
a single mosaic; multiple datasets can be added later.
"""
from __future__ import annotations

import math
import os
from dataclasses import dataclass
from functools import lru_cache

import numpy as np

# rasterio is imported lazily inside functions so the module imports even before
# the geo stack is installed (lets the API boot + report a clear error).

DATA_DIR = os.environ.get("RC_DEM_DIR", os.path.join(os.path.dirname(__file__), "..", "data"))
EARTH_R_KM = 6371.0
DEG2RAD = math.pi / 180.0


@dataclass
class DemWindow:
    """An elevation array with the geo-referencing needed to vectorize results."""

    elev: np.ndarray          # 2D float32, metres; NaN = nodata
    transform: object         # rasterio Affine (pixel → world)
    crs: object               # rasterio CRS
    bounds: tuple[float, float, float, float]  # (w, s, e, n) in DEM CRS
    res_m: float


def _find_dem() -> str | None:
    """First *.tif in the data dir (the mosaicked DEM)."""
    if not os.path.isdir(DATA_DIR):
        return None
    tifs = sorted(f for f in os.listdir(DATA_DIR) if f.lower().endswith((".tif", ".tiff")))
    return os.path.join(DATA_DIR, tifs[0]) if tifs else None


@lru_cache(maxsize=1)
def dem_path() -> str | None:
    return _find_dem()


def dem_info() -> dict:
    import rasterio  # noqa: WPS433 (lazy)

    path = dem_path()
    if not path or not os.path.exists(path):
        return {"loaded": False, "path": None, "extent": None, "resolution_m": None, "crs": None}
    with rasterio.open(path) as ds:
        b = ds.bounds
        # Approx ground resolution; DEMs are often in a projected CRS (metres) or
        # geographic (degrees). Report metres where we can.
        res = float(abs(ds.transform.a))
        res_m = res if ds.crs and ds.crs.is_projected else res * 111_320.0
        return {
            "loaded": True,
            "path": path,
            "extent": [b.left, b.bottom, b.right, b.top],
            "resolution_m": res_m,
            "crs": str(ds.crs),
        }


def load_window(bbox_lnglat: tuple[float, float, float, float] | None) -> DemWindow:
    """Read the DEM (optionally windowed to a lng/lat bbox) into memory.

    bbox is in EPSG:4326; we transform it to the DEM CRS for the read window.
    """
    import rasterio
    from rasterio.warp import transform_bounds
    from rasterio.windows import from_bounds

    path = dem_path()
    if not path or not os.path.exists(path):
        raise FileNotFoundError(
            f"No DEM found in {DATA_DIR}. Run `python -m app.fetch_dem` first.",
        )

    with rasterio.open(path) as ds:
        if bbox_lnglat is not None:
            w, s, e, n = transform_bounds("EPSG:4326", ds.crs, *bbox_lnglat)
            win = from_bounds(w, s, e, n, transform=ds.transform).round_offsets().round_lengths()
            elev = ds.read(1, window=win, masked=True)
            transform = ds.window_transform(win)
            bounds = rasterio.windows.bounds(win, ds.transform)
        else:
            elev = ds.read(1, masked=True)
            transform = ds.transform
            bounds = tuple(ds.bounds)

        arr = elev.filled(np.nan).astype("float32")
        nodata = ds.nodata
        if nodata is not None:
            arr[arr == nodata] = np.nan
        res = float(abs(ds.transform.a))
        res_m = res if ds.crs and ds.crs.is_projected else res * 111_320.0
        return DemWindow(elev=arr, transform=transform, crs=ds.crs, bounds=bounds, res_m=res_m)


def apply_edits(win: DemWindow, edits: list) -> np.ndarray:
    """Add soft Gaussian brush deltas to the elevation array (in place copy).

    Each edit raises/lowers a circular region with sigma = radius/2, matching the
    web brush. Coordinates are converted from lng/lat to the DEM pixel grid.
    """
    import rasterio
    from rasterio.warp import transform as warp_transform

    if not edits:
        return win.elev
    out = win.elev.copy()
    h, w = out.shape
    inv = ~win.transform  # world → pixel

    # Precompute a per-pixel lng/lat is expensive; instead, for each edit, work in
    # the DEM's own units. Convert the edit centre + a radius offset to DEM CRS.
    for ed in edits:
        cx, cy = warp_transform("EPSG:4326", win.crs, [ed.lng], [ed.lat])
        cx, cy = cx[0], cy[0]
        # Radius in DEM units: project a point radius_km north of centre.
        north_lat = ed.lat + (ed.radius_km / 111.32)
        nx, ny = warp_transform("EPSG:4326", win.crs, [ed.lng], [north_lat])
        radius_units = math.hypot(nx[0] - cx, ny[0] - cy)
        if radius_units <= 0:
            continue
        sigma = radius_units / 2.0

        # Pixel bbox of the brush footprint.
        col_c, row_c = inv * (cx, cy)
        rad_px = radius_units / win.res_m if win.crs.is_projected else radius_units / abs(win.transform.a)
        r0 = max(0, int(row_c - rad_px))
        r1 = min(h, int(row_c + rad_px) + 1)
        c0 = max(0, int(col_c - rad_px))
        c1 = min(w, int(col_c + rad_px) + 1)
        if r0 >= r1 or c0 >= c1:
            continue

        rows = np.arange(r0, r1)
        cols = np.arange(c0, c1)
        cc, rr = np.meshgrid(cols, rows)
        # pixel → world for the patch
        wx = win.transform.a * cc + win.transform.b * rr + win.transform.c
        wy = win.transform.d * cc + win.transform.e * rr + win.transform.f
        d2 = (wx - cx) ** 2 + (wy - cy) ** 2
        weight = np.exp(-d2 / (2 * sigma * sigma))
        weight[d2 > radius_units * radius_units] = 0.0
        out[r0:r1, c0:c1] += (ed.delta_m * weight).astype("float32")
    return out


def pole_distance_deg(lng: np.ndarray, lat: np.ndarray, pole_lng: float, pole_lat: float) -> np.ndarray:
    """Angular distance (deg, 0..180) from the post-shift pole — vectorized."""
    a_lat = lat * DEG2RAD
    p_lat = pole_lat * DEG2RAD
    dlng = (lng - pole_lng) * DEG2RAD
    h = np.sin((p_lat - a_lat) / 2) ** 2 + np.cos(a_lat) * np.cos(p_lat) * np.sin(dlng / 2) ** 2
    km = 2 * EARTH_R_KM * np.arcsin(np.clip(np.sqrt(h), 0, 1))
    return (km / (math.pi * EARTH_R_KM)) * 180.0


def sea_level_field(win: DemWindow, world) -> np.ndarray:
    """Post-shift sea level per pixel: base + bulge·sin²(distance-from-pole).

    Matches web/src/derived/climate.ts seaLevelAt. Returns an array shaped like
    the DEM window, in metres.
    """
    import rasterio
    from rasterio.warp import transform as warp_transform

    h, w = win.elev.shape
    # Build pixel-centre lng/lat grids (subsample for speed, then upsample).
    rows = np.arange(h)
    cols = np.arange(w)
    cc, rr = np.meshgrid(cols, rows)
    wx = win.transform.a * cc + win.transform.b * rr + win.transform.c
    wy = win.transform.d * cc + win.transform.e * rr + win.transform.f
    # Transform DEM coords → lng/lat for the climate formula.
    lng, lat = warp_transform(win.crs, "EPSG:4326", wx.ravel(), wy.ravel())
    lng = np.asarray(lng).reshape(h, w)
    lat = np.asarray(lat).reshape(h, w)
    d = pole_distance_deg(lng, lat, world.pole_lng, world.pole_lat)
    return world.sea_level_m + world.sea_bulge_m * np.sin(d * DEG2RAD) ** 2
