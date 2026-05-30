# web — Remnant Continent atlas (frontend)

Vite + TypeScript + MapLibre GL JS. Phase 1: the **map spine**.

## Setup

```bash
cd web
npm install
cp .env.example .env   # optional — adjust the basemap source
npm run dev            # http://localhost:5173
```

With no `.env`, the app renders a raster OpenStreetMap basemap so it works out
of the box. To use OSM **vector** tiles (the intended direction), set
`VITE_MAP_STYLE_URL` in `.env` to a MapLibre style URL (e.g. a self-hosted
PMTiles style). See `.env.example`.

## Scripts

| Command | Does |
|---------|------|
| `npm run dev` | Dev server with HMR. |
| `npm run build` | Typecheck (`tsc --noEmit`) then production build to `dist/`. |
| `npm run typecheck` | Types only. |
| `npm run preview` | Serve the built `dist/`. |

## Structure

```
src/
  config.ts          env-driven map config + Midwest area-of-interest constants
  main.ts            app entry: boots the basemap, shows load status
  styles.css         shell styles (dark)
  map/basemap.ts     MapLibre setup; returns { map, ready }
  layers/            authored features (locations, routes, territories) — next
  derived/           climate, resource potential, network graph — later
  brush/ notes/ state/ sim/   see docs/architecture.md
```

Feature layers and derived overlays attach to the `map` instance returned by
`createBasemap()`. The basemap module knows nothing about them — see
`docs/architecture.md` for the three-layer model and the seams.

## Editing

With a backend configured, a floating toolbar (top-left of the map) enables
Terra Draw editing of the authored layer:

- **+ Location** — click to drop a point; you're prompted for new-world and
  old-world names.
- **+ Route** — click vertices, double-click to finish a line.
- **+ Territory** — click vertices, double-click to finish a polygon (assigned
  to the first faction for now).

Geometry is written to Supabase via `create_*` RPCs (GeoJSON → PostGIS), then
the authored data reloads and the derived network graph rebuilds. Without a
backend the toolbar stays hidden and the app is read-only.
