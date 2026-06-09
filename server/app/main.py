"""FastAPI app: serve derived water/coast features from the local DEM.

Run: `uvicorn app.main:app --reload --port 8000`
The web app calls POST /derive/water with its world settings + edits.
"""
from __future__ import annotations

import time

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from . import coastline, dem, hydrology
from .schemas import DeriveRequest, DeriveResponse, DemInfo, Health

app = FastAPI(title="Remnant Continent compute backend", version="0.1.0")

# Local dev only — the web app runs on a different localhost port.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", response_model=Health)
def health() -> Health:
    return Health(dem=DemInfo(**dem.dem_info()))


@app.get("/dem/info", response_model=DemInfo)
def dem_info() -> DemInfo:
    return DemInfo(**dem.dem_info())


@app.post("/derive/water", response_model=DeriveResponse)
def derive_water(req: DeriveRequest) -> DeriveResponse:
    t0 = time.time()
    try:
        bbox = tuple(req.bbox) if req.bbox else None
        win = dem.load_window(bbox)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    composite = dem.apply_edits(win, req.edits)
    sea = dem.sea_level_field(win, req.world)

    hydro = hydrology.derive(win, composite, sea, req)
    coast = coastline.derive(win, composite, sea, req)

    return DeriveResponse(
        rivers=hydro["rivers"],
        lakes=hydro["lakes"],
        sea=coast["sea"],
        coastline=coast["coastline"],
        meta={
            **hydro["meta"],
            "elapsed_s": round(time.time() - t0, 2),
            "bbox": req.bbox,
            "n_edits": len(req.edits),
        },
    )
