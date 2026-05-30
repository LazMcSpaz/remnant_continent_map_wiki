# Architecture

This document is the canonical reference for *how the tool is structured*. The
README explains the vision and roadmap; this explains the seams that make the
roadmap buildable. If the two ever disagree, this file wins for implementation
questions and the README wins for scope questions.

## The three-layer model

Everything the tool knows belongs to exactly one of three layers. This is the
single most important rule in the codebase. Code, storage, and APIs are all
organized around it.

| Layer | Definition | Stored? | Examples |
|-------|------------|---------|----------|
| **Authored** | Facts only the author can set. | Yes — source of truth. | Elevation edits, faction borders, pole position, locations, route ownership/status, notes, travel modes |
| **Derived** | Pure functions of the authored layer. | No — recomputed on input change (may be cached). | Temperature field, snow line, resource potential, city baselines, route travel times, the network graph |
| **Simulated** | World state at a turn, produced by stepping the model forward. | Yes, but as snapshots keyed by turn, sharing the authored base. | City stockpiles, trade flow, deficits, pressure (Phase 4) |

### Why this matters

- **Overrides stay clean.** An override never edits a fact. It *pins* a derived
  value so it survives recomputation, and it is rendered as authored rather than
  computed. (Example: the Versari have fusion, so their energy baseline is pinned
  high and ignores the climate-derived solar/wind potential.)
- **The future simulation is additive.** Because authored / derived / simulated
  are already separate in storage and in code, Phase 4 adds a new engine and a
  `sim_state` table — it does not migrate or rework Phases 1–3.

## The cascade

Derived values form a dependency chain. Changing an authored input recomputes
everything downstream of it, and nothing upstream.

```
Editable elevation         (authored)
        ↓
Climate model              (derived: pole distance, season, temperature)
        ↓
Resource potential         (derived: sun, wind, water, growing season)
        ↓
City baselines             (derived, with manual overrides/pins)
        ↓
Trade flow                 (simulated — Phase 4)
        ↓
Emergent pressure          (simulated — Phase 4)
```

**Implementation intent:** the derived layer is a set of pure recompute
functions registered against their inputs, so a change to an authored input can
invalidate exactly the affected derived outputs rather than recomputing the
world. This is an optimization, not a requirement — correctness only demands
that derived values are never trusted as stored fact.

## Directory layout and responsibilities

```
web/src/
  map/        Basemap + imagery + renderer setup (MapLibre GL JS).
  layers/     Authored features: locations, routes, territories. Edit via Terra Draw.
  derived/    Pure recompute: the network graph (Phase 1) and the climate
              cascade (Phase 2 — temperature, growing warmth, crop suitability).
              Reads world_settings + terrain_regions; stores nothing.
  brush/      Phase 3 procedural mask painting (decay/rebuild, water/forest).
  notes/      Wiki interface + click-through annotations.
  state/      Snapshots, time slider, persistence, import/export (GeoJSON + JSON blob).
  sim/        Phase 4 stub. Documented interface only — see sim/INTERFACE.md.
```

### Extension points (the seams we must not violate)

1. **The network graph lives in `derived/`** and is built in Phase 1, because
   route measurement, travel times, and isochrones all need it anyway. The
   Phase 4 simulation *consumes* this graph; it does not build its own.
2. **`sim/` exists from day one** as a stub with a documented interface, so the
   simulation is never bolted on as an afterthought. See `web/src/sim/INTERFACE.md`.
3. **Derived city production/consumption is exposed through a stable internal
   API** that the simulation will read. Treat its shape as a contract.
4. **Persistence already separates the three layers**, so adding simulated state
   is a new table, never a schema migration of authored data.

## Data flow at runtime

```
Supabase (PostGIS)  ──load──►  authored state (in memory)
                                      │
                                      ▼
                              derived recompute  ──►  map overlays + readouts
                                      │
                                      ▼  (Phase 4)
                              sim engine  ──►  sim_state / snapshots
```

Authored edits write back to Supabase. Derived values are never persisted as
fact (caching is allowed but is always reproducible). Simulated state is
persisted only as turn-keyed snapshots that reference the shared authored base.

## Non-goals

Out of scope for the whole project: the story's supernatural undercurrent.
Out of scope even for Phase 4: real-time ticking, individual-agent simulation,
combat resolution, and AI-driven faction decisions. The model surfaces
*pressure*; the author supplies the human choices.
