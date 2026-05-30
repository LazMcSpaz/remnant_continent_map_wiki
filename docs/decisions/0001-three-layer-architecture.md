# ADR 0001 — Three-layer architecture (authored / derived / simulated)

- **Status:** Accepted
- **Date:** 2026-05-30
- **Context:** Pre–Phase 1. Establishing the foundational structure before app code.

## Context

The tool is part reference atlas, part world model, and must support a future
emergent simulation (Phase 4) that can be added *without reworking* the earlier
phases. We need a structure that keeps authored facts, computed values, and
future simulation state cleanly separated.

## Decision

Adopt the three-layer model as the organizing principle for storage, code, and
APIs:

- **Authored** — facts only the author sets; the source of truth; persisted.
- **Derived** — pure functions of the authored layer; never stored as fact;
  recomputed on input change (caching allowed but always reproducible).
- **Simulated** — per-turn world state from stepping the model forward;
  persisted as turn-keyed snapshots that share the authored base.

Consequences enforced from day one:

1. The **network graph is a derived artifact** built in Phase 1 (needed for
   route measurement / travel times / isochrones) and is the single object the
   Phase 4 simulation consumes.
2. `web/src/sim/` ships as a **documented stub** (`INTERFACE.md`), not empty and
   not implemented, so the simulation seam is visible.
3. **Overrides pin derived values** rather than editing facts; pinned values are
   rendered as authored.
4. Persistence separates the three layers, so adding simulated state is a **new
   table, not a migration** of authored data.

## Alternatives considered

- **Flatten everything into stored state.** Rejected: overrides become
  destructive edits, recomputation is impossible, and the simulation could not
  be added additively.
- **Defer the network graph to Phase 4.** Rejected: it is needed for Phase 1
  travel times anyway, and building it twice invites divergence.

## Consequences

- Slightly more upfront structure (the `derived/` and `sim/` seams exist before
  they are full).
- Clean recomputation and a genuinely additive Phase 4, which is the explicit
  hard constraint from the README.
