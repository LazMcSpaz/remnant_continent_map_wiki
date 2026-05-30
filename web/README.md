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
