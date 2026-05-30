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
Singleton (one row, or one per snapshot context).
| column | type | notes |
|--------|------|-------|
| `id` | uuid pk | |
| `pole_geom` | geometry(Point, 4326) | movable pole for the climate model |
| `season` | text/numeric | season phase |
| `global_temp_offset` | numeric | global temperature knob |

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
