# The Remnant Continent — Worldbuilding Atlas

An interactive, editable map and reference tool for *The Remnant Continent*, a
post-cataclysm fiction set on a transformed version of the real American
Midwest. Because the world maps onto real geography — Omaha, Kansas City, Des
Moines, Lincoln, Denver, the Missouri corridor, the Great Lakes — the tool is
built on real open geographic data, then re-skinned and edited to reflect the
fiction.

*(Working name. Rename freely.)*

**Status:** Planning / pre–Phase 1. Nothing is built yet; this document is the
agreed design and roadmap.

---

## What this is

A browser-based tool that is part **reference atlas** and part **world model**.
You can:

- Draw and edit factions, territories, locations, roads, and rail on a real
  basemap.
- Mark route segments as owned by a faction, or as damaged/destroyed so a path
  becomes unusable.
- Model climate by placing a new pole and adjusting season and global
  temperature, then watch snow cover and growing conditions shift across the
  regions.
- Edit elevation, since the cataclysm reshaped the terrain.
- Paint stylized destruction, decay, and rebuilding onto the map, and add or
  remove natural surfaces like water and forest — all procedurally, not with AI
  image generation.
- Give cities resource values (food, water, energy, production) that can be
  **auto-computed from geography** as a starting point and then overridden for
  story reasons.
- Draw routes, assign named travel modes with custom speeds (landships, rail,
  on foot), and read off travel times — colored and labeled by purpose (trade
  route, common path, owner).
- Attach notes to anything — a city, a road, a border, an unnamed cave — and
  read them through a wiki-style interface or by clicking the thing itself.
- Save named snapshots and move between them on a time slider, turning the map
  into a living timeline of the story.

What it deliberately is **not** (for now): a depiction of the story's
supernatural undercurrent. That layer is intentionally out of scope.

---

## Core design principle: three data layers

Everything in the tool belongs to exactly one of three layers. Keeping them
separate is the single most important architectural decision, and it is what
makes overrides clean and the future simulation possible.

| Layer | Meaning | Examples |
|-------|---------|----------|
| **Authored** | Truth only you can set. Stored as fact. | Elevation edits, faction borders, pole position, locations, route ownership, notes |
| **Derived** | Computed from the authored layer. Never stored as fact; always recomputed when an input changes. | Temperature field, snow line, resource potential, city baselines, route travel times, the network graph |
| **Simulated** | The state of the world at a given turn, produced by running the model forward. | City stockpiles, trade flow, deficits and pressure (future) |

The cascade runs top to bottom:

```
Editable elevation         (authored)
        ↓
Climate model              (derived: pole distance, season, temperature)
        ↓
Resource potential         (derived: sun, wind, water, growing season)
        ↓
City baselines             (derived, with manual overrides)
        ↓
Trade flow                 (simulated — future)
        ↓
Emergent pressure          (simulated — future)
```

Move the pole and the entire derived layer recomputes beneath it. An override
(for example, the Versari having fusion so energy is a non-issue) does not edit
a fact — it **pins** a derived value so it survives recomputation, and it is
shown visually as authored rather than computed.

A **snapshot** is the simulated layer (and any authored changes) frozen at a
turn. The authored base is shared across snapshots, so the time slider stores
only what changed, not a full copy of the world each time.

---

## Designed for a simulation we haven't built yet

The emergent simulation is **Phase 4 and deliberately deferred**, but the
framework is being built so it can be added later without reworking the earlier
phases. This is a hard design constraint, not an aspiration.

The mechanism: Phase 1 already builds a **network graph** — locations are nodes,
routes are edges carrying `owner`, `capacity`, `speed`, and an
`intact / damaged / destroyed` status. That graph is needed anyway for route
measurement, travel times, isochrones, and chokepoint detection. The simulation,
when it comes, simply:

1. reads that existing graph,
2. reads the existing derived city baselines (production and consumption), and
3. adds a forward-stepping engine plus a `sim_state` table for per-turn results.

Nothing in Phases 1–3 has to change. To guarantee this stays true as we build:

- The `sim/` directory exists from day one as a stub with a documented
  interface, so it is never an afterthought bolted onto a finished app.
- Derived values (especially city production/consumption and the network graph)
  are exposed through a stable internal API that the simulation will consume.
- Persistence already separates authored / derived / simulated, so adding
  simulated state is a new table, not a schema migration of existing data.

The intended simulation, when built, stays narrowly scoped on purpose:
**turn-based, deterministic, and fully inspectable** — a flow model over the
graph where surpluses move toward deficits, a severed edge starves the cities
downstream, and a chokepoint accrues leverage. Every result must trace back to a
cause you can narrate. Explicitly out of scope even then: real-time ticking,
individual-agent simulation, combat resolution, and AI-driven faction decisions.
The model surfaces *pressure*; the author supplies the human choices.

---

## Roadmap

Each phase is usable on its own.

### Phase 1 — The map spine
- Real basemap (OSM vector data) plus a satellite/imagery layer.
- Editable feature layers: locations (add / rename / remove, with an
  old-world ↔ new-world name toggle, e.g. Omaha ↔ Omara), routes (road / rail),
  and territory polygons per faction.
- Route ownership and `intact / damaged / destroyed` status.
- Route drawing with geodesic length measurement; named travel modes (label +
  speed); multi-mode travel times; color/label routes by purpose.
- The **network graph** is constructed here (the foundation for Phase 4).
- Notes attached to any feature, persisted to the database; wiki view +
  click-through.
- Save / load and export / import (GeoJSON + a JSON state blob).

### Phase 2 — The derived cascade
- Editable elevation, starting from a real DEM (the cataclysm reshapes terrain).
- Climate model: movable pole, season, global temperature; effective-latitude
  computation; elevation-aware temperature; snow line rendered as an overlay.
- Resource potential and computed **city baselines** (sun, wind, water, growing
  season) with manual overrides.

### Phase 3 — The procedural brush
- Mask-based painting: brush an area, choose decay/rebuild level or surface
  type, and a procedural fill composites a stylized texture over the basemap.
- Natural-surface editing (add / remove water and forest) using the same
  mask-plus-fill mechanism.
- Not photorealistic and not AI-generated — intentionally map-like.

### Phase 4 — Network analysis & simulation (deferred)
- Travel-time isochrones from a chosen origin and mode.
- Chokepoint / centrality detection over the network graph (expected to flag the
  Kansit river crossing on its own).
- Flow simulation: production and consumption per turn, surplus routing across
  intact edges, deficit and pressure readouts, all inspectable and tied to the
  time slider / snapshots.

---

## Tech stack (intended)

- **Map rendering:** [MapLibre GL JS](https://maplibre.org/) (GPU vector maps),
  with [Leaflet](https://leafletjs.com/) as a possible alternative for simpler
  canvas-overlay work.
- **Drawing:** [Terra Draw](https://terradraw.io/) for feature editing across
  either renderer.
- **Geospatial math:** [Turf.js](https://turfjs.org/) for length, distance, and
  measurement.
- **Overlays / brush:** HTML `<canvas>` for the climate overlay and the
  procedural mask layers.
- **Backend / database:** [Supabase](https://supabase.com/) (Postgres) with the
  **PostGIS** extension, so spatial queries and network analysis can run as SQL
  on the server. Optional Edge Functions for heavier spatial work (and, later,
  simulation steps).
- **Persistence format:** GeoJSON for features + a JSON state blob for settings,
  factions, masks, and travel modes — enabling export, versioning, and sharing.

### Data sources
- **Vector features (roads, rail, waterways, place names):** OpenStreetMap.
- **Elevation:** an open DEM such as SRTM.
- **Imagery:** open satellite sources (e.g. Sentinel-2, Landsat) or a tile
  service such as ESRI World Imagery.

> **Check data licensing and terms before shipping.** OSM, imagery providers,
> and DEM sources each carry their own attribution and usage requirements.

---

## Suggested repository layout

```
.
├── README.md
├── docs/
│   ├── architecture.md        # three-layer model, cascade, extension points
│   ├── data-model.md          # tables + GeoJSON schemas
│   └── decisions/             # short architecture decision records
├── web/
│   └── src/
│       ├── map/               # basemap, imagery, renderer setup
│       ├── layers/            # authored features: locations, routes, territories
│       ├── derived/           # climate, resource potential, network graph
│       ├── brush/             # procedural mask painting (Phase 3)
│       ├── notes/             # wiki interface + click-through
│       ├── state/             # snapshots, time slider, persistence, import/export
│       └── sim/               # Phase 4 stub — documented interface, not yet built
├── supabase/
│   ├── migrations/            # schema (PostGIS-enabled)
│   └── functions/             # edge functions (spatial queries; sim later)
└── data/
    └── README.md              # how to fetch DEM / OSM extracts (large files gitignored)
```

The presence of `web/src/sim/` and `derived/` from the start is intentional:
the derived layer feeds the simulation, and the stub keeps the seam visible so
later work stays additive.

---

## Data model sketch

Indicative, not final — see `docs/data-model.md` once it exists.

**Authored**
- `factions` — name, color.
- `locations` — geometry (point/polygon), name, old-world name, type
  (city / settlement / poi / cave / …), faction, resource overrides.
- `routes` — geometry (line), kind (rail / road / trail), owner faction,
  status (intact / damaged / destroyed), applicable travel modes.
- `territories` — polygon, faction, style.
- `travel_modes` — label, speed.
- `world_settings` — pole position, season, global temperature.
- `elevation_edits`, `surface_edits`, `decay_masks` — raster mask deltas over
  the base layers.
- `notes` — `target_type`, `target_id`, body, tags, links (one polymorphic
  table annotates everything; supports `[[wiki-style]]` cross-links).

**Derived** (computed at runtime, not stored as fact)
- temperature field, snow line, resource potential, city baselines, route
  travel times, network graph.

**Simulated** (future, Phase 4)
- `sim_state` — per-turn city stockpiles, flow allocations, pressure readouts.
- `snapshots` — frozen simulated state keyed by turn; shares the authored base.

---

## Notes on running it

This is a **personal, local-first** tool. The browser app (`web/`) is the UI;
the heavy geospatial work runs in a **local Python compute backend** (`server/`)
that reads high-resolution DEMs (10 m 3DEP) from your disk and does real
hydrology — flow accumulation, depression-fill lakes, post-shift coastline — at
a fidelity a browser tab can't reach. The web app calls it via `VITE_COMPUTE_URL`
and renders the GeoJSON it returns; with no backend configured it falls back to
the lighter browser-only DEM sampling.

```
web/     Vite + TS + MapLibre UI (authoring, overlays, simulation)
server/  Python (FastAPI + GDAL/pysheds) local compute — see server/README.md
```

Run `server/` (DEM download + service) and `web/` (dev server) together on your
machine. See each directory's README for setup.

## License

TBD.
