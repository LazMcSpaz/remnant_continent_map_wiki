"""Real hydrology on the composite DEM: depression filling, flow direction +
accumulation, river extraction, and inland lakes — the server-side, high-res
replacement for web/src/derived/hydrology.ts.

Uses pysheds (C-backed) for the heavy raster passes, then vectorizes channels to
smoothed GeoJSON LineStrings and lake basins to smoothed polygons. Runs at the
DEM's native resolution (10 m), bounded only by your machine.
"""
from __future__ import annotations

import math

import numpy as np

from .dem import DemWindow


def _to_lnglat(win: DemWindow, col: np.ndarray, row: np.ndarray):
    """Pixel (col,row) → lng/lat arrays."""
    from rasterio.warp import transform as warp_transform

    wx = win.transform.a * col + win.transform.b * row + win.transform.c
    wy = win.transform.d * col + win.transform.e * row + win.transform.f
    lng, lat = warp_transform(win.crs, "EPSG:4326", np.asarray(wx).ravel(), np.asarray(wy).ravel())
    return np.asarray(lng), np.asarray(lat)


def derive(win: DemWindow, composite: np.ndarray, sea: np.ndarray, req) -> dict:
    """Run the full hydrology pipeline.

    composite: edited elevation (m). sea: per-pixel sea level (m).
    Returns dict with 'rivers', 'lakes' GeoJSON FeatureCollections + meta.
    """
    from pysheds.grid import Grid
    from pysheds.view import Raster, ViewFinder

    elev = composite.astype("float64")
    nan = np.isnan(elev)
    # Treat ocean (below sea level) + nodata as the drainage base: clamp to a low
    # value so flow leaves the land there.
    is_sea = (~nan) & (elev <= sea)
    work = elev.copy()
    work[nan] = np.nanmin(elev[~nan]) - 1000 if np.any(~nan) else 0.0

    vf = ViewFinder(shape=work.shape, affine=win.transform, crs=win.crs, nodata=np.nan)
    grid = Grid(viewfinder=vf)
    dem = Raster(work, viewfinder=vf)

    # 1. Fill depressions + resolve flats. The pit-fill amount IS the lake depth.
    filled = grid.fill_pits(dem)
    flooded = grid.fill_depressions(filled)
    inflated = grid.resolve_flats(flooded)
    lake_depth = np.asarray(flooded) - np.asarray(filled)

    # 2. Flow direction (D8) + accumulation.
    fdir = grid.flowdir(inflated)
    acc = np.asarray(grid.accumulation(fdir))

    # 3. Rivers: cells whose accumulation exceeds a fraction of the max → channel
    #    network, traced to smoothed polylines.
    rivers = _extract_rivers(win, fdir, acc, is_sea, req)

    # 4. Lakes: connected basins (lake_depth above a floor) that are large + fed.
    lakes = _extract_lakes(win, lake_depth, acc, is_sea, req)

    return {
        "rivers": rivers,
        "lakes": lakes,
        "meta": {
            "shape": list(work.shape),
            "res_m": win.res_m,
            "max_accumulation": float(acc.max()),
        },
    }


def _extract_rivers(win: DemWindow, fdir, acc, is_sea, req) -> dict:
    """Threshold accumulation → channel mask → ordered polylines (smoothed)."""
    from skimage.morphology import skeletonize

    thresh = req.river_min_strength * acc.max()
    channel = (acc >= max(thresh, 1.0)) & (~is_sea)
    if not channel.any():
        return {"type": "FeatureCollection", "features": []}
    # Skeletonize to 1-px channels, then walk D8 downstream to order points.
    skel = skeletonize(channel)
    feats = _trace_downstream(win, skel, fdir, acc, req.smooth)
    return {"type": "FeatureCollection", "features": feats}


# D8 direction → (drow, dcol). pysheds default dirmap is (64,128,1,2,4,8,16,32)
# for (N, NE, E, SE, S, SW, W, NW); map each code to its row/col step.
_D8 = {
    64: (-1, 0), 128: (-1, 1), 1: (0, 1), 2: (1, 1),
    4: (1, 0), 8: (1, -1), 16: (0, -1), 32: (-1, -1),
}


def _trace_downstream(win: DemWindow, skel, fdir, acc, smooth: bool) -> list:
    """Follow skeleton channel cells downstream into ordered LineStrings."""
    h, w = skel.shape
    fdir = np.asarray(fdir)
    visited = np.zeros_like(skel, dtype=bool)
    feats: list = []

    def downstream(r, c):
        code = int(fdir[r, c])
        step = _D8.get(code)
        if step is None:
            return None
        nr, nc = r + step[0], c + step[1]
        if 0 <= nr < h and 0 <= nc < w:
            return nr, nc
        return None

    # Headwaters: channel cells with no channel cell flowing INTO them.
    inflow = np.zeros_like(skel, dtype=np.int32)
    ys, xs = np.nonzero(skel)
    for r, c in zip(ys, xs):
        nxt = downstream(r, c)
        if nxt and skel[nxt]:
            inflow[nxt] += 1

    for r, c in zip(ys, xs):
        if inflow[r, c] > 0 or visited[r, c]:
            continue
        path = [(r, c)]
        visited[r, c] = True
        cur = (r, c)
        guard = 0
        while guard < h * w:
            guard += 1
            nxt = downstream(*cur)
            if not nxt or not skel[nxt]:
                break
            path.append(nxt)
            visited[nxt] = True
            cur = nxt
        if len(path) < 2:
            continue
        rows = np.array([p[0] for p in path])
        cols = np.array([p[1] for p in path])
        lng, lat = _to_lnglat(win, cols.astype(float), rows.astype(float))
        coords = list(zip(lng.tolist(), lat.tolist()))
        if smooth:
            coords = _chaikin(coords, iters=2)
        strength = float(acc[path[-1]] / max(acc.max(), 1.0) * 100.0)
        feats.append({
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": coords},
            "properties": {"strength": strength},
        })
    return feats


def _extract_lakes(win: DemWindow, lake_depth, acc, is_sea, req) -> dict:
    """Filled basins → large, well-fed lake polygons (smoothed)."""
    from skimage import measure
    from skimage.morphology import remove_small_objects

    MIN_DEPTH_M = 5.0
    cand = (lake_depth > MIN_DEPTH_M) & (~is_sea)
    if not cand.any():
        return {"type": "FeatureCollection", "features": []}

    # Min area in pixels from km².
    px_area_km2 = (win.res_m / 1000.0) ** 2
    min_px = max(4, int(req.lake_min_area_km2 / max(px_area_km2, 1e-9)))
    cand = remove_small_objects(cand, min_size=min_px)
    if not cand.any():
        return {"type": "FeatureCollection", "features": []}

    feats: list = []
    for contour in measure.find_contours(cand.astype(float), 0.5):
        rows = contour[:, 0]
        cols = contour[:, 1]
        lng, lat = _to_lnglat(win, cols, rows)
        ring = list(zip(lng.tolist(), lat.tolist()))
        if len(ring) < 4:
            continue
        if req.smooth:
            ring = _chaikin(ring, iters=2, closed=True)
        if ring[0] != ring[-1]:
            ring.append(ring[0])
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [ring]},
            "properties": {},
        })
    return {"type": "FeatureCollection", "features": feats}


def _chaikin(coords: list, iters: int = 2, closed: bool = False) -> list:
    """Chaikin corner-cutting for smooth curves (matches the web smoothing)."""
    pts = coords[:]
    if closed and len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    for _ in range(iters):
        if len(pts) < 3:
            break
        out = []
        n = len(pts)
        rng = range(n) if closed else range(n - 1)
        for i in rng:
            p = pts[i]
            q = pts[(i + 1) % n]
            out.append((p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25))
            out.append((p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75))
        if not closed:
            out.insert(0, pts[0])
            out.append(pts[-1])
        pts = out
    if closed and pts:
        pts.append(pts[0])
    return pts
