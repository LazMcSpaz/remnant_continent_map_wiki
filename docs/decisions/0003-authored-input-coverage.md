# ADR 0003 — Authored input coverage for future derived tools

- **Status:** Accepted
- **Date:** 2026-05-30
- **Context:** Phase 1 hardening, ahead of Phase 2 (the derived cascade).

## Context

Future tools — the climate field after a pole shift, crop-growth/suitability,
energy potential, hydrology — are **derived**, but they can only be computed if
the authored **inputs** they read are captured and stored now. Discovering a
missing input later means a migration plus re-authoring. The three-layer model
says: store inputs (unrecomputable facts), never derived outputs.

## Decision

Provision authored storage for the climate, energy, and hydrology input
domains, as an **area layer** plus global settings:

1. **`world_settings` expansion (migration 0007)** — axial tilt, sea level,
   equator/pole base temperatures, lapse rate, prevailing wind. With the movable
   `pole_geom`, these are the complete inputs for an effective-latitude climate
   field that recomputes when the pole moves.
2. **`terrain_regions` area layer (migration 0008)** — polygon coverage of
   physical-geography inputs: elevation/slope/aspect, land cover, soil fertility
   and drainage, surface water, and wind/solar exposure, plus a free-form
   `attributes` jsonb. This gives "how well crops grow in an area" real area
   data rather than only city points.

Granularity chosen: **area layer only** (not per-location physical attributes),
keeping locations focused on settlement facts. Crop/agronomy inputs are folded
into `terrain_regions` (soil + land cover + water) rather than a separate table.

### What is NOT stored (stays derived)

Temperature field, snow line, growing-degree-days, crop suitability, solar/wind
potential, city resource baselines. All computed at runtime in `web/src/derived/`
from `world_settings` + `terrain_regions` (+ elevation edits in Phase 2).

## Consequences

- The derived climate/crop/energy tools (Phase 2) can be added without schema
  changes — they read existing authored inputs, mirroring how the network graph
  already reads routes/locations.
- `terrain_regions` follows the established authored-table pattern: GeoJSON
  view, GeoJSON→PostGIS write RPCs (search_path pinned), RLS enabled, included
  in save/load + import/export.
- Import currently preserves terrain physical fields inside the `attributes`
  jsonb bag (the create RPC takes geometry/name/attributes); promoting them back
  to typed columns on import is a future refinement, noted so it isn't lost.
- Phase 1 RLS posture is unchanged (permissive `authenticated`); the auth
  hardening from ADR 0002 still gates public exposure.

## Hosting note

Deployment target is **Cloudflare Pages**. The Vite build already emits a static
`dist/`, so this is a static deploy with build-time `VITE_*` env (Supabase URL +
publishable key, basemap source) and no server runtime. Recorded here so schema
and client choices stay compatible (e.g. no server-only secrets in the client;
all writes go through Supabase RLS).
