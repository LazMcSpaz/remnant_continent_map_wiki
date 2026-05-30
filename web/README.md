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
  layers/            authored features (locations, routes, territories, terrain)
  derived/           network graph now; climate/resource potential later
  brush/ notes/ state/ sim/   see docs/architecture.md
```

## Authored inputs for future tools

The authored layer captures the **inputs** future derived tools need, so they
can be added later without re-authoring data (see ADR 0003):

- **`terrain_regions`** — an authored area layer of physical geography
  (elevation, slope/aspect, land cover, soil fertility/drainage, surface water,
  wind/solar exposure). Rendered as a faint land-cover fill beneath everything.
  Feeds future crop-suitability, energy-potential, and hydrology derivations.
- **`world_settings`** — global climate/energy knobs (movable pole, axial tilt,
  sea level, equator/pole base temps, lapse rate, prevailing wind). Moving the
  pole is what lets the (future) climate field recompute across the map.

Per the three-layer model, only these inputs are stored; temperature fields,
growing-degree-days, and suitability scores are derived at runtime.

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

## Wiki panel

Click a city marker to open the **tabbed wiki panel** (top-right); the marker
gets a selection halo. Tabs (arrow keys navigate the tablist; Esc closes):

- **Overview** — type, new/old-world names, faction, coordinates. *Editable.*
- **Population** — authored population stat. *Editable.*
- **Resources** — `resource_overrides` as 0–100 bars (Phase 2 will also derive
  these from geography; overrides pin them). *Editable.*
- **Connections** — routes touching this location, from the derived network
  graph, with length, travel time, and intact/damaged/severed status. Rows that
  lead to another city are **clickable** — they fly to and open that city.
- **Notes** — read/add/delete annotations (`notes` table) with comma-separated
  tags, light inline Markdown (`**bold**`, `*italic*`, `` `code` ``, links,
  `[[wiki-links]]`), and relative timestamps.

Edits write to the authored layer, then the panel reloads data, rebuilds the
derived graph, and re-renders in place. `src/notes/wiki-panel.ts` is pure DOM
and talks to a `WikiHost` (implemented in `main.ts`) so it never owns map or
data state — `LocationDetail` (authored), `NetworkGraph` (derived), and notes
stay distinct, consistent with the three-layer model.

## Save / load · import / export

Header buttons (when a backend is configured):

- **Save** — download the whole authored layer as a `.json` snapshot: a GeoJSON
  FeatureCollection (each feature tagged with `rcLayer`) plus a state blob for
  factions, travel modes, world settings, and notes.
- **Export GeoJSON** — download just the spatial features as a plain `.geojson`
  for other GIS tools.
- **Import** — load a snapshot file; features are **appended** to the current
  map (not replaced). IDs are regenerated and references (faction ownership,
  note targets) remapped, so two snapshots can be merged. Per-feature failures
  are collected and reported rather than aborting the import.

Only the authored layer is serialized — derived values (the network graph,
travel times) recompute on load, and simulated state (Phase 4) is out of scope.
See `src/state/snapshot.ts` (data) and `src/state/io.ts` (files + UI).
