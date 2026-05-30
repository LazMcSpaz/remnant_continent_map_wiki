# ADR 0004 — Derived climate cascade (Phase 2, first slice)

- **Status:** Accepted
- **Date:** 2026-05-30
- **Context:** Phase 2. First consumer of the authored climate/terrain inputs.

## Context

ADR 0003 hardened the authored layer to capture climate and terrain *inputs*.
This ADR adds the first *derived* consumer of them: a climate cascade that
turns those inputs into a temperature field, growing warmth, and crop
suitability — recomputed live, never stored. It's also the proof that the
three-layer architecture delivers on its core promise: move an input, watch the
derived layer recompute.

## Decision

Implement the cascade as **pure functions** in `web/src/derived/climate.ts`:

```
world_settings + terrain  ──►  effective latitude (distance from pole)
                          ──►  temperature field  (lat, season, tilt, lapse, elevation, offset)
                          ──►  growing warmth      (GDD-like, 0..100)
                          ──►  crop suitability     (warmth × soil × water × land cover)
```

- **Effective latitude** is angular distance from the authored `pole_geom`, so
  moving the pole remaps every region's latitude and shifts the whole field.
- **Crop suitability** returns its *limiting factor* (temperature/water/soil/
  land cover) so every result is narratable — a hard requirement of the project.
- Outputs are **never persisted**. `deriveClimate()` recomputes a per-region map
  on demand; the overlay and wiki panel read it.

### Rendering & interaction

- `derived/climate-overlay.ts` paints terrain regions as a choropleth
  (temperature blue→red, crops brown→green), inserted beneath the city markers
  so locations stay clickable. Kept separate from `layers/render.ts` so the
  authored/derived split is visible in code, not just data.
- `derived/climate-control.ts` is a toggle + metric switch + **season scrubber**.
  Scrubbing previews live (mutate the in-memory `season`, recompute — no DB
  round-trip) and commits to `world_settings` on release. This is the cascade
  made tangible.
- The wiki panel gains a **Climate tab** showing a clicked location's derived
  temperature and growing warmth.

## Model scope

Deliberately a *stylized world-model*, not a climatology engine: a smooth
latitude/elevation/season field with simple multiplicative crop factors. Every
output traces to an authored input. Refinements (continentality from coastline
distance, wind-driven precipitation, aspect-aware insolation) can be added as
more pure functions without touching storage.

## Consequences

- The README's Phase 2 climate goals are met in first-slice form; resource
  potential / city baselines can follow as more derived functions over the same
  inputs.
- Because derived values aren't stored, a Phase 4 simulation can read the same
  functions; nothing here blocks the deferred sim seam.
- Season is currently a single global `world_settings` row; per-snapshot climate
  (time slider) remains future work and doesn't require schema change.

## Addendum — terrain editor & elevation cascade

Editing terrain (`src/notes/terrain-panel.ts`) is the first editor whose changes
flow *downstream* into derived data, which surfaced cascade requirements:

- **Inputs that cascade:** elevation → temperature (lapse rate); land cover /
  soil fertility / surface water → crop suitability; **geometry** too, since a
  region's centroid sets its effective latitude. All terrain saves therefore
  route through `applyData` (reload → recompute climate → refresh open panels).
- **Closed a broken-cascade gap:** a city's climate sampled sea level because
  locations carry no elevation, so terrain elevation edits wouldn't reach the
  city on top. Fixed with `sampleElevation()` — point-in-region lookup gives the
  city the elevation of the terrain beneath it. Verified against PostGIS
  `ST_Contains`: 4/5 seeded cities resolve to a region; flattening Denvar's
  region (1600 m → 0) warms its derived temperature by ~10 °C.
- **No migration:** terrain physical fields are scalar columns, edited via plain
  PostgREST UPDATE under existing RLS; only geometry uses the RPC.
- **Single-selection UX:** opening the terrain panel closes the city panel and
  vice-versa; terrain click ignores clicks that also hit a city marker above it.
