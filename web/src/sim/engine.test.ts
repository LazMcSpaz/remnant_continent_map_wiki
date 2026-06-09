// Tests for the flow-simulation engine — locks in the scenarios validated by
// hand during development: a severed chokepoint starves cities behind it,
// relationship stance gates how much surplus crosses faction lines, wealth
// accrues to the producer, and a step is deterministic.
import { describe, it, expect } from "vitest";
import { run, initialState } from "./engine";
import type { CityBaselines, RelationFn } from "./types";
import type { NetworkGraph, GraphEdge, GraphNode } from "../derived/network-graph";

function node(id: string): GraphNode {
  return { id: `loc:${id}`, locationId: id, name: id, lngLat: [0, 0] };
}
function edge(id: string, a: string, b: string, status: GraphEdge["status"] = "intact"): GraphEdge {
  return {
    id: `edge:${id}`, routeId: id, from: `loc:${a}`, to: `loc:${b}`,
    owner: null, speed: 60, capacity: 2, status, lengthKm: 100,
  };
}
function baseline(prod: Partial<Record<string, number>>, cons: Partial<Record<string, number>>, faction: string | null = null) {
  const z = { food: 0, water: 0, energy: 0, production: 0 };
  return {
    production: { ...z, ...prod },
    consumption: { ...z, ...cons },
    population: 10000,
    factionId: faction,
  };
}

describe("chokepoint starvation", () => {
  // A (food surplus) — B (middle) — C (food deficit).
  const nodes = [node("A"), node("B"), node("C")];
  const baselines: CityBaselines = {
    A: baseline({ food: 50, water: 10 }, { food: 10, water: 10, energy: 6 }),
    B: baseline({ food: 12, water: 12, energy: 8 }, { food: 10, water: 10, energy: 6 }),
    C: baseline({ food: 2, water: 8, energy: 30 }, { food: 25, water: 12, energy: 6 }),
  };

  it("feeds C through B when the network is intact", () => {
    const g: NetworkGraph = { nodes, edges: [edge("AB", "A", "B"), edge("BC", "B", "C")] };
    const s = run(initialState(), 3, g, baselines);
    expect(s.pressure.C).toBeLessThan(40);
    // Food flowed across BC.
    expect(s.flows.some((f) => f.routeId === "BC" && f.resource === "food")).toBe(true);
  });

  it("starves C when the B-C edge is severed", () => {
    const g: NetworkGraph = { nodes, edges: [edge("AB", "A", "B"), edge("BC", "B", "C", "destroyed")] };
    const s = run(initialState(), 3, g, baselines);
    expect(s.pressure.C).toBeGreaterThan(70);
    expect(s.stockpiles.C.food).toBeLessThan(0);
    // Nothing crosses a destroyed edge.
    expect(s.flows.some((f) => f.routeId === "BC")).toBe(false);
  });
});

describe("determinism", () => {
  it("same inputs yield the same pressures", () => {
    const nodes = [node("A"), node("B")];
    const g: NetworkGraph = { nodes, edges: [edge("AB", "A", "B")] };
    const baselines: CityBaselines = {
      A: baseline({ food: 30 }, { food: 10 }),
      B: baseline({ food: 2 }, { food: 20 }),
    };
    const a = run(initialState(), 3, g, baselines);
    const b = run(initialState(), 3, g, baselines);
    expect(a.pressure).toEqual(b.pressure);
    expect(a.stockpiles).toEqual(b.stockpiles);
  });
});

describe("relationship-gated trade", () => {
  // One big food producer (FX) connected to three deficit cities at different
  // stances. Ally should end up best supplied, hostile worst.
  const nodes = [node("X"), node("Aly"), node("Tns"), node("Hos")];
  const mk = (food: number, fac: string) =>
    baseline({ food, water: 10, energy: 8 }, { food: 30, water: 10, energy: 6 }, fac);
  const baselines: CityBaselines = {
    X: mk(120, "FX"), Aly: mk(2, "FA"), Tns: mk(2, "FT"), Hos: mk(2, "FH"),
  };
  const g: NetworkGraph = {
    nodes,
    edges: [edge("XA", "X", "Aly"), edge("XT", "X", "Tns"), edge("XH", "X", "Hos")],
  };
  const relation: RelationFn = (a, b) => {
    if (a && b && a === b) return "self";
    if (!a || !b) return "friendly";
    const key = [a, b].sort().join("|");
    const m: Record<string, "allies" | "tense" | "hostile"> = {
      "FA|FX": "allies", "FT|FX": "tense", "FH|FX": "hostile",
    };
    return m[key] ?? "friendly";
  };

  it("supplies allies more than tense, and hostile not at all", () => {
    const s = run(initialState(), 2, g, baselines, { relation });
    // Less negative food stock = better supplied.
    expect(s.stockpiles.Aly.food).toBeGreaterThan(s.stockpiles.Tns.food);
    expect(s.stockpiles.Tns.food).toBeGreaterThan(s.stockpiles.Hos.food);
    // Hostile city received nothing.
    expect(s.flows.some((f) => f.routeId === "XH")).toBe(false);
  });

  it("accrues wealth to the producing/exporting faction", () => {
    const s = run(initialState(), 2, g, baselines, { relation });
    expect(s.wealth.FX).toBeGreaterThan(s.wealth.FA ?? 0);
  });
});
