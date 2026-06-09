"""Request/response models for the compute backend.

These mirror the web app's notion of world settings + terrain edits, so the
client can hand its current state to the backend and get back GeoJSON water
features. Kept deliberately small — only what the derivation needs.
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class ElevationEdit(BaseModel):
    """A soft-brush elevation delta, matching web/src/derived/terrain.ts."""

    lng: float
    lat: float
    radius_km: float = Field(alias="radiusKm")
    delta_m: float = Field(alias="deltaM")

    model_config = {"populate_by_name": True}


class WorldSettings(BaseModel):
    """The post-shift knobs that move the sea level + climate."""

    pole_lng: float = -75.0
    pole_lat: float = -10.0
    sea_level_m: float = 0.0
    # Equatorial-bulge amplitude (m) of the realigned sea surface. Matches the
    # SEA_BULGE_M constant the web climate model uses.
    sea_bulge_m: float = 220.0


class DeriveRequest(BaseModel):
    world: WorldSettings = WorldSettings()
    edits: list[ElevationEdit] = []
    # Optional bbox [w, s, e, n] to derive only a sub-window (faster Recalculate
    # over an edited region). Omit for the full loaded DEM extent.
    bbox: list[float] | None = None
    # Rendering knobs.
    river_min_strength: float = 0.5  # 0..1 fraction of max accumulation to draw
    lake_min_area_km2: float = 5.0
    smooth: bool = True


class DeriveResponse(BaseModel):
    rivers: dict[str, Any]      # GeoJSON FeatureCollection<LineString>
    lakes: dict[str, Any]       # GeoJSON FeatureCollection<Polygon>
    sea: dict[str, Any]         # GeoJSON FeatureCollection<Polygon>
    coastline: dict[str, Any]   # GeoJSON FeatureCollection<LineString>
    meta: dict[str, Any]


class DemInfo(BaseModel):
    loaded: bool
    path: str | None = None
    extent: list[float] | None = None  # [w, s, e, n]
    resolution_m: float | None = None
    crs: str | None = None


class Health(BaseModel):
    status: Literal["ok"] = "ok"
    dem: DemInfo
