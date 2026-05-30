# Data model

Indicative and evolving. This sketch expands the README's data-model section
into concrete table and GeoJSON shapes. Treat the *layer assignment* of each
table as fixed.

> **Status:** The authored layer is implemented in
> `supabase/migrations/0001_init_authored_schema.sql` and applied to the
> "Remnant Continent Atlas" Supabase project (PostGIS, SRID 4326). Typed for the
> client in `web/src/state/db-types.ts`. See ADR 0002. The derived and simulated
> sections below remain forward-looking.

Geometry is stored in PostGIS (`geometry`/`geography`, SRID 4326). Features
exported to the client are GeoJSON.

## Authored tables (source of truth)

### `factions`
| column | type | notes |
|--------|------|-------|
| `id` | uuid pk | |
| `name` | text | |
| `color` | text | hex, used for territory/route styling |
| `created_at` | timestamptz | |

### `locations`
| column | type | notes |
|--------|------|-------|
| `id` | uuid pk | |
| `geom` | geometry(Point or Polygon, 4326) | |
| `name` | text | new-world name (e.g. "Omara") |
| `old_world_name` | text | real-world name (e.g. "Omaha"); drives the name toggle |
| `type` | text | `city` \| `settlement` \| `poi` \| `cave` \| … |
| `faction_id` | uuid fk → factions | nullable |
| `resource_overrides` | jsonb | pins for derived city baselines (food/water/energy/production) |

### `routes`
| column | type | notes |
|--------|------|-------|
| `id` | uuid pk | |
| `geom` | geometry(LineString, 4326) | |
| `kind` | text | `rail` \| `road` \| `trail` |
| `owner_faction_id` | uuid fk → factions | nullable |
| `status` | text | `intact` \| `damaged` \| `destroyed` |
| `mode_ids` | uuid[] | applicable travel modes |
| `purpose` | text | drives color/label: `trade` \| `common` \| `owner` \| … |

### `territories`
| column | type | notes |
|--------|------|-------|
| `id` | uuid pk | |
| `geom` | geometry(Polygon/MultiPolygon, 4326) | |
| `faction_id` | uuid fk → factions | |
| `style` | jsonb | fill/stroke overrides |

### `travel_modes`
| column | type | notes |
|--------|------|-------|
| `id` | uuid pk | |
| `label` | text | e.g. "landship", "rail", "on foot" |
| `speed_kph` | numeric | used for travel-time computation |

### `world_settings`
Singleton. Global climate + energy **inputs** to the derived model (migrations
0001, 0007). Move the pole or change a knob and the whole derived climate layer
recomputes; none of the outputs are stored here.
| column | type | notes |
|--------|------|-------|
| `id` | uuid pk | |
| `pole_geom` | geometry(Point, 4326) | movable pole for the climate model |
| `season` | numeric | season phase (0..1) |
| `global_temp_offset` | numeric | global temperature knob (°C) |
| `axial_tilt_deg` | numeric | planetary axial tilt → seasonal swing |
| `sea_level_m` | numeric | global sea-level offset (cataclysm) |
| `equator_temp_c` | numeric | base sea-level temp at the effective equator |
| `pole_temp_c` | numeric | base sea-level temp at the effective pole |
| `lapse_rate_c_per_km` | numeric | temperature drop per km elevation |
| `prevailing_wind_deg` | numeric | prevailing wind bearing → wind energy |

### `terrain_regions` (authored area layer — physical-geography inputs)
Polygon coverage of inputs future derived tools need (climate field, crop
suitability, energy potential, hydrology). Migration 0008. **Inputs only** —
derived scores (temperature, growing-degree-days, solar/wind potential,
suitability) are computed at runtime, never stored.
| column | type | notes |
|--------|------|-------|
| `id` | uuid pk | |
| `geom` | geometry(MultiPolygon, 4326) | |
| `name` | text | nullable label |
| `elevation_m` | numeric | representative elevation (terrain reshaped by cataclysm) |
| `slope_deg`, `aspect_deg` | numeric | mean slope / aspect bearing (runoff, solar/wind exposure) |
| `land_cover` | text | forest\|grassland\|cropland\|wetland\|desert\|urban\|water\|barren\|tundra |
| `soil_fertility` | numeric | 0..100 authored fertility (crops) |
| `soil_drainage` | text | poor\|moderate\|well\|excessive |
| `surface_water` | numeric | 0..100 surface-water availability (crops + city water) |
| `wind_exposure`, `solar_exposure` | numeric | 0..100 energy-exposure inputs |
| `attributes` | jsonb | free-form authored extras (no migration per field) |

### Mask deltas (raster edits over base layers)
- `elevation_edits` — raster/mask deltas over the base DEM.
- `surface_edits` — add/remove water and forest.
- `decay_masks` — stylized destruction / rebuild levels (Phase 3).

Each: `id`, `geom`/`bounds`, `payload` (jsonb or raster ref), `created_at`.

### `notes` (polymorphic — annotates everything)
| column | type | notes |
|--------|------|-------|
| `id` | uuid pk | |
| `target_type` | text | `location` \| `route` \| `territory` \| `border` \| `point` \| … |
| `target_id` | uuid | nullable for free-floating geographic notes |
| `geom` | geometry | nullable; for notes pinned to a spot, not an entity |
| `body` | text | markdown |
| `tags` | text[] | |
| `links` | text[] | `[[wiki-style]]` cross-links resolved in the notes UI |

## Derived (computed at runtime — NOT stored as fact)

Never written back as authoritative data. May be cached, always reproducible.

- **temperature field** — from pole distance (effective latitude), season,
  global temp offset, and elevation.
- **snow line** — threshold over the temperature field; rendered as an overlay.
- **resource potential** — sun, wind, water availability, growing season.
- **city baselines** — production/consumption per resource, derived from
  potential, then modified by `locations.resource_overrides` (pins).
- **route travel times** — geodesic length (Turf.js) ÷ mode speed, gated by
  route `status`.
- **network graph** — nodes = locations, edges = routes carrying
  `{ owner, capacity, speed, status }`. Built in Phase 1; consumed by Phase 4.
  This is the single object the simulation reads.

## Simulated (Phase 4 — deferred)

- `sim_state` — per-turn city stockpiles, flow allocations, pressure readouts.
- `snapshots` — frozen simulated state keyed by turn; references the shared
  authored base rather than copying the world.

## Persistence / interchange format

- **Features:** GeoJSON (`FeatureCollection` per layer).
- **Settings, factions, masks, travel modes:** a JSON state blob.
- Together these enable export, versioning, and sharing, and are the unit of
  save/load and import/export in `web/src/state/`.
