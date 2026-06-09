"""Post-shift coastline + sea polygons from the composite DEM vs the sea-level
field. Marching-squares on (composite − sea) at 0 gives the shoreline; the sea
side becomes filled polygons. Smoothed to match the web rendering.

Server-side replacement for the d3-contour coastline trace, on real high-res DEM.
"""
from __future__ import annotations

import numpy as np

from .dem import DemWindow
from .hydrology import _chaikin, _to_lnglat


def derive(win: DemWindow, composite: np.ndarray, sea: np.ndarray, req) -> dict:
    """Return {'sea': FC<Polygon>, 'coastline': FC<LineString>}."""
    from skimage import measure

    field = composite - sea  # >0 land, <=0 water
    field = np.where(np.isnan(field), 1.0, field)  # nodata → treat as land

    sea_feats: list = []
    coast_feats: list = []
    for contour in measure.find_contours(field, 0.0):
        rows = contour[:, 0]
        cols = contour[:, 1]
        lng, lat = _to_lnglat(win, cols, rows)
        line = list(zip(lng.tolist(), lat.tolist()))
        if len(line) < 4:
            continue
        if req.smooth:
            line = _chaikin(line, iters=2)
        coast_feats.append({
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": line},
            "properties": {},
        })

    # Sea polygons: contour the negated field so the sea (<=0) is the >=0 region.
    for contour in measure.find_contours((-field), 0.0):
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
        sea_feats.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [ring]},
            "properties": {},
        })

    return {
        "sea": {"type": "FeatureCollection", "features": sea_feats},
        "coastline": {"type": "FeatureCollection", "features": coast_feats},
    }
