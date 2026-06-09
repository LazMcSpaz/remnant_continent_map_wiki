// Tests for chokepoint detection + travel-time isochrones. Reconstructs the
// "two clusters joined by one bridge" scenario validated during development:
// the lone bridge must score 1.0 on both betweenness and cut-impact, while the
// redundant triangle edges stay low.
import { describe, it, expect } from "vitest";
import { analyzeNetwork, computeIsochrones } from "./network-analysis";
import type { NetworkGraph, GraphEdge, GraphNode } from "./network-graph";
import { TRAVEL_MODES } from "./travel";

function node(id: string, lng = 0, lat = 0): GraphNode {
  return { id: `loc:${id}`, locationId: id, name: id, lngLat: [lng, lat] };
}
function edge(id: string, a: string, b: string, km = 40, status: GraphEdge["status"] = "intact"): GraphEdge {
  return {
    id: `edge:${id}`, routeId: id, from: `loc:${a}`, to: `loc:${b}`,
    owner: null, speed: 60, capacity: 2, status, lengthKm: km,
  };
}

// Cluster {A,B,C} (triangle) — CD bridge — cluster {D,E,F} (triangle).
function bridgeGraph(): NetworkGraph {
  const nodes = ["A", "B", "C", "D", "E", "F"].map((n, i) => node(n, i, 0));
  const edges = [
    edge("AB", "A", "B"), edge("BC", "B", "C"), edge("AC", "A", "C"),
    edge("CD", "C", "D", 80), // the lone bridge
    edge("DE", "D", "E"), edge("EF", "E", "F"), edge("DF", "D", "F"),
  ];
  return { nodes, edges };
}

describe("chokepoint detection", () => {
  it("flags the lone bridge at the top on both signals", () => {
    const a = analyzeNetwork(bridgeGraph());
    const cd = a.edges.find((e) => e.routeId === "CD")!;
    expect(cd.betweenness).toBeCloseTo(1, 5);
    expect(cd.cutImpact).toBeCloseTo(1, 5);
    expect(a.ranked[0].routeId).toBe("CD");
  });
  it("keeps redundant triangle edges low", () => {
    const a = analyzeNetwork(bridgeGraph());
    const ab = a.edges.find((e) => e.routeId === "AB")!;
    // A triangle edge always has an alternative path → low cut impact.
    expect(ab.cutImpact).toBeLessThan(0.5);
    expect(ab.score).toBeLessThan(cdScore(a));
  });
});

function cdScore(a: ReturnType<typeof analyzeNetwork>): number {
  return a.edges.find((e) => e.routeId === "CD")!.score;
}

describe("travel-time isochrones", () => {
  it("reaches further cities at higher time, damaged legs slower", () => {
    // Chain A-B-C-D, 100 km legs, BC damaged (double time).
    const nodes = ["A", "B", "C", "D"].map((n, i) => node(n, i, 0));
    const edges = [
      edge("AB", "A", "B", 100),
      edge("BC", "B", "C", 100, "damaged"),
      edge("CD", "C", "D", 100),
    ];
    const foot = TRAVEL_MODES.find((m) => m.id === "foot")!;
    const iso = computeIsochrones({ nodes, edges }, "loc:A", foot);
    const byId = new Map(iso.cities.map((c) => [c.locationId, c.hours]));
    expect(byId.get("A")).toBeCloseTo(0, 5);
    // B = one normal 100 km leg (~20.7 h); C adds a damaged (doubled) leg.
    expect(byId.get("B")!).toBeCloseTo(20.7, 1);
    expect(byId.get("C")! - byId.get("B")!).toBeCloseTo(41.4, 1);
    expect(byId.get("D")!).toBeGreaterThan(byId.get("C")!);
  });
  it("excludes unreachable nodes", () => {
    const nodes = [node("A"), node("B"), node("X", 50, 50)];
    const edges = [edge("AB", "A", "B")]; // X is disconnected
    const foot = TRAVEL_MODES.find((m) => m.id === "foot")!;
    const iso = computeIsochrones({ nodes, edges }, "loc:A", foot);
    expect(iso.cities.find((c) => c.locationId === "X")).toBeUndefined();
  });
});
