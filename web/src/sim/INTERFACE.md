# `sim/` — Phase 4 stub interface (deferred, do not build yet)

This directory exists from day one **on purpose**. The README makes it a hard
design constraint that the emergent simulation can be added later without
reworking Phases 1–3. Keeping a documented, stubbed interface here is what makes
that seam visible and keeps later work additive.

**Status:** Not implemented. This file is a contract, not code.

## What the simulation will be

Turn-based, deterministic, and fully inspectable: a flow model over the network
graph where surpluses move toward deficits, a severed edge starves the cities
downstream of it, and a chokepoint accrues leverage. Every result must trace
back to a cause the author can narrate.

Explicitly **out of scope even when built:** real-time ticking, individual-agent
simulation, combat resolution, AI-driven faction decisions.

## What it consumes (already produced by earlier phases)

1. **The network graph** from `web/src/derived/` — nodes are locations, edges are
   routes carrying `{ owner, capacity, speed, status }`. The sim does **not**
   build its own graph.
2. **Derived city baselines** from `web/src/derived/` — production and
   consumption per resource per city.

## Intended interface (provisional)

```ts
// The two inputs the engine reads. Shapes owned by derived/, treated as a contract.
interface NetworkGraph {
  nodes: Array<{ id: string; locationId: string }>;
  edges: Array<{
    id: string;
    from: string;
    to: string;
    owner: string | null;
    capacity: number;
    speed: number;
    status: "intact" | "damaged" | "destroyed";
  }>;
}

interface CityBaselines {
  // per location id: production/consumption per resource
  [locationId: string]: {
    production: Record<ResourceKind, number>;
    consumption: Record<ResourceKind, number>;
  };
}

type ResourceKind = "food" | "water" | "energy" | "production";

// One deterministic forward step. Pure: same inputs => same output.
function step(prev: SimState, graph: NetworkGraph, baselines: CityBaselines): SimState;

interface SimState {
  turn: number;
  stockpiles: Record<string, Record<ResourceKind, number>>; // per location
  flows: Array<{ edgeId: string; resource: ResourceKind; amount: number }>;
  pressure: Record<string, number>; // per location: deficit/leverage readout
}
```

## What Phase 4 adds (and only this)

- A forward-stepping engine (`step` above), driven by the time slider.
- A `sim_state` table plus turn-keyed `snapshots` that share the authored base.

Nothing in `map/`, `layers/`, `derived/`, `brush/`, `notes/`, or `state/` should
need to change to add the simulation. If it does, the seam was violated upstream
— fix that, don't work around it here.
