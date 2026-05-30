# ADR 0002 — Supabase + PostGIS as the authored-layer backend

- **Status:** Accepted
- **Date:** 2026-05-30
- **Context:** Phase 1. Persisting the authored layer.

## Context

The README names Supabase (Postgres + PostGIS) as the intended backend, so
spatial queries and later network analysis can run as SQL on the server. We need
the authored layer (the source of truth) to persist, while keeping derived
values out of storage and leaving room for the Phase 4 simulated layer.

## Decision

Use a dedicated Supabase project, **"Remnant Continent Atlas"**
(ref `butvhkwqgidjmwchuypf`), with PostGIS enabled.

- Migration `0001_init_authored_schema.sql` creates **only the authored layer**:
  `factions`, `travel_modes`, `locations`, `routes`, `territories`,
  `world_settings`, `elevation_edits`, `surface_edits`, `decay_masks`, `notes`.
- Derived values (temperature field, snow line, resource potential, city
  baselines, travel times, network graph) are **not** tables — they are computed
  at runtime per the three-layer model.
- The simulated layer (`sim_state`, `snapshots`) is deferred to Phase 4 and will
  be **new tables**, not a migration of authored data.
- Geometry is PostGIS, SRID 4326.
- The client uses the **publishable** key; the secret service_role key never
  ships to the browser. The app runs as a viewer with no backend when env vars
  are unset (offline-first).

## Security posture (Phase 1)

- RLS is **enabled on every authored table**. Current policies grant full access
  to the `authenticated` role and nothing to `anon`.
- These policies are permissive (`using (true)`) because there is no auth or
  per-user ownership model yet. **Before exposing the app publicly**, either add
  Supabase Auth and tighten policies to real ownership rules, or, if the tool
  stays single-user, scope access deliberately. Tracked as a follow-up.
- Supabase's linter also flags the stock `public.spatial_ref_sys` (PostGIS
  reference table, RLS off) and PostGIS in the `public` schema. These are
  expected defaults of the PostGIS extension and are read-only reference data;
  not changing them without reason.

## Consequences

- Spatial indexing (GiST) and PostGIS functions are available now; pgRouting is
  installed and available for Phase 4 network analysis.
- The repo migration file and the live database are kept in sync; regenerate
  `web/src/state/db-types.ts` after any future migration.
