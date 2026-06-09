# server — Remnant Continent local compute backend

A **local** Python service that does the heavy geospatial work the browser
can't: real digital-elevation processing, hydrology (flow accumulation,
watershed, depression filling → rivers + lakes), and post-shift coastline
extraction — over high-resolution DEMs stored on your machine.

This replaces the browser-side DEM sampling + hand-rolled hydrology. The web app
stops sampling tiles itself and instead asks this service for the derived water
features. Everything runs on your PC, so it's bounded by your RAM/disk, not a
browser tab — which is what unlocks **10 m 3DEP** detail.

> **Status:** scaffold. Designed to run on your machine (it needs GDAL + the geo
> stack + downloaded DEM data, none of which live in the cloud sandbox). See
> Setup below.

## What it does

```
DEM (10 m 3DEP GeoTIFF, local)
  │  + world settings (pole, sea level)  + terrain edits (brush deltas)
  ▼
composite elevation  ──►  depression-fill + flow accumulation (pysheds/RichDEM)
                      ──►  rivers (vectorized, smoothed)
                      ──►  inland lakes (filled basins, area/inflow gated)
                      ──►  post-shift coastline (sea-level threshold → polygons)
  ▼
GeoJSON over HTTP  ──►  the web app renders it (no browser DEM work)
```

## Setup (on your PC)

Prereqs: Python 3.11+, and GDAL available to Python. The cleanest path is conda
(it ships GDAL binaries); pip works too if you have system GDAL.

```bash
cd server
python -m venv .venv && source .venv/bin/activate   # or conda create
pip install -r requirements.txt

# 1. Fetch DEM for your working extent (US core at 10 m, see data/README).
python -m app.fetch_dem --extent -104 36 -88 46   # w s e n  (example: Midwest)

# 2. Run the service.
uvicorn app.main:app --reload --port 8000
```

Then point the web app at it: set `VITE_COMPUTE_URL=http://localhost:8000` in
`web/.env` and run the web app as usual. With that set, the app uses this
backend for water/coast instead of browser DEM sampling.

## Endpoints (provisional)

| Method | Path | Does |
|---|---|---|
| `GET` | `/health` | liveness + which DEM(s) are loaded |
| `POST` | `/derive/water` | body: world settings + edits → GeoJSON {rivers, lakes, sea, coastline} |
| `GET` | `/dem/info` | extent + resolution of the loaded DEM |

## Layout

```
server/
  app/
    main.py          FastAPI app + routes
    dem.py           load/window DEM, apply edits, post-shift sea level
    hydrology.py     fill + flow accumulation + rivers + lakes (pysheds/RichDEM)
    coastline.py     sea-level threshold → smoothed polygons
    schemas.py       request/response models
    fetch_dem.py     download + mosaic 3DEP tiles for an extent
  data/              downloaded DEMs (gitignored) — see data/README.md
  requirements.txt
```
