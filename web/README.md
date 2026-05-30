# web — Remnant Continent atlas (frontend)

Vite + TypeScript + MapLibre GL JS. Phase 1: the **map spine**.

Deploys to Cloudflare Pages as a static build — see `docs/deploy.md`
(root `web`, build `npm run build`, output `web/dist`). Security headers/CSP
ship in `public/_headers`.

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

## Map extent & layers

The map spans **continental North America** (pannable across Canada/US/Mexico)
and opens zoomed on the Midwest corridor where the seed data lives. A **Layers**
panel (top-left) toggles each feature group — Climate zones, Terrain,
Territories, Routes, City names — on/off; hiding a layer also makes it
un-clickable, so you can isolate exactly what you want to select without
pixel-hunting between overlapping features.

## Routes

- **Creating** a route is a guided wizard: **+ Route** → place the **start**
  then the **end** (clicks snap to nearby cities and route endpoints) → choose
  **Follow roads** (OSRM road-snapped) or **Landship route** (hover path that
  routes *around* forest + mountain terrain) → pick the **owning faction**.
  Landship barriers are terrain regions that are forest, high-elevation
  (≥1500 m), or steep (≥15°), so landship routing sharpens as you author more
  terrain. Configure the OSRM server with `VITE_OSRM_URL`.
- **Click a route** to open its panel: edit class (**major/minor/secret**),
  status, kind, and purpose; see derived length + **travel time**, which always
  computes and updates with the chosen **travel mode** (on foot, caravan,
  mounted, landship, motorized, rail — each with a stylized mph). Read/add/delete
  notes. Class feeds graph capacity and on-map styling (major thicker, secret
  fainter). The route click target is widened a few px so thin lines are easy to
  select.
- **Breaks** — in a route's panel, choose a kind (**natural / blockade / toll**)
  and "Place break", then click the spot on the route; the point snaps onto the
  line. Breaks are **annotations** — markers that record a barrier/toll. They do
  **not** close the route or stop travel time; lift or delete them as needed.
  They ride on the Routes layer (no separate toggle).
- **Corridors (route groups)** — the **Corridors** panel (top-left) lists named
  corridors and has "New corridor": name it, then click route segments to add
  them (Esc to finish). A corridor's panel shows its derived **total length and
  end-to-end travel** (at the current mode), its **segments**, labels, and notes.
  A corridor flags as closed only if a member segment is physically **destroyed**.

The whole route system — segments, classes, breaks, and corridors — is included
in Save / Export and restored on Import (ids remapped, breaks re-snapped onto
their routes, corridor membership rebuilt).

## Derived climate cascade (Phase 2)

`src/derived/climate.ts` turns the authored inputs into a temperature field,
growing warmth, and crop suitability — pure functions, never stored. The
control bottom-left toggles a **choropleth overlay** (temperature blue→red or
crop suitability brown→green over the terrain regions) and a **season scrubber**:
drag it and the whole derived field recomputes live (committed to
`world_settings.season` on release). Moving the pole would remap the field the
same way. A clicked city's **Climate tab** shows its derived temperature and
growing warmth. See ADR 0004.

## Terrain editor (cascade in action)

Click a **terrain region** (a land-cover area) to open the terrain panel
(`src/notes/terrain-panel.ts`). It edits the authored physical **inputs** —
elevation, slope/aspect, land cover, soil fertility/drainage, surface water,
wind/solar exposure — and shows the **derived** climate they produce
(temperature, crop suitability + its limiting factor).

Saving cascades: the edit reloads authored data and recomputes the derived
climate, so the choropleth overlay and any open city Climate tab move with it.
Because a city has no elevation of its own, its temperature is sampled from the
terrain region beneath it (`sampleElevation`) — so flattening a region's
elevation (the cataclysm) warms the cities sitting on it. Scalar inputs save via
plain PostgREST UPDATE; geometry still goes through the GeoJSON→PostGIS RPC.

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
- **Resources** — **derived from geography** (food from crop suitability, water
  from surface water, energy from wind+solar, production from buildable land),
  with `resource_overrides` shown as **pins** (📌) that override the baseline and
  survive recompute. A baseline tick marks where geography sits under a pin.
  Edit to pin/unpin; blank = use the baseline. *Recomputes with terrain/season.*
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
  factions, travel modes, world settings, notes, route breaks, and corridors.
- **Export GeoJSON** — download just the spatial features as a plain `.geojson`
  for other GIS tools.
- **Import** — load a snapshot file; features are **appended** to the current
  map (not replaced). IDs are regenerated and references (faction ownership,
  note targets) remapped, so two snapshots can be merged. Per-feature failures
  are collected and reported rather than aborting the import.

Only the authored layer is serialized — derived values (the network graph,
travel times) recompute on load, and simulated state (Phase 4) is out of scope.
See `src/state/snapshot.ts` (data) and `src/state/io.ts` (files + UI).
