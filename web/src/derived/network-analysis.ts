// DERIVED: network analysis (Phase 4, the analysis half).
//
// Chokepoint / centrality detection over the route graph. Pure functions of the
// NetworkGraph — no map, no DB. Two complementary signals:
//
//   • betweenness — how many shortest city-to-city paths run through an edge (or
//     node). A high-traffic bottleneck that everything funnels through scores
//     high. Weighted by travel time (the real cost), over *usable* edges.
//   • cut impact — how many city-pairs lose their connection (or get materially
//     slower) if a single edge is removed. This is the truest chokepoint signal:
//     the README expects the Kansit river crossing to surface on its own here,
//     because severing it strands everything beyond it.
//
// Both are reported 0..1 normalized so they drive a heat scale and a ranked
// list. Deterministic: same graph ⇒ same scores.

import type { NetworkGraph, GraphEdge, GraphNode } from "./network-graph";
import { edgeTravelHours } from "./network-graph";
import { travelHours, type TravelMode } from "./travel";

export interface EdgeScore {
  edgeId: string;
  routeId: string;
  /** Fraction of shortest city-pair paths using this edge (0..1). */
  betweenness: number;
  /** Fraction of connected city-pairs that this edge alone keeps connected
   *  (0..1) — i.e. they have no alternative route if it's cut. */
  cutImpact: number;
  /** Combined 0..1 chokepoint score (max of the two signals). */
  score: number;
  from: string;
  to: string;
}

export interface NodeScore {
  nodeId: string;
  locationId: string | null;
  name: string;
  /** Fraction of shortest city-pair paths passing *through* this node (0..1). */
  betweenness: number;
}

export interface NetworkAnalysis {
  edges: EdgeScore[];
  nodes: NodeScore[];
  /** Edges ranked by chokepoint score, highest first. */
  ranked: EdgeScore[];
}

interface Adj {
  edgeId: string;
  to: string;
  cost: number;
}

/** Build usable-edge adjacency (destroyed edges excluded — they carry nothing). */
function buildAdjacency(graph: NetworkGraph): Map<string, Adj[]> {
  const adj = new Map<string, Adj[]>();
  const add = (a: string, b: string, e: GraphEdge, cost: number) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push({ edgeId: e.id, to: b, cost });
  };
  for (const e of graph.edges) {
    if (e.status === "destroyed") continue;
    const cost = Math.max(0.01, edgeTravelHours(e));
    add(e.from, e.to, e, cost);
    add(e.to, e.from, e, cost);
  }
  return adj;
}

/** Dijkstra from a source over the adjacency; returns dist + the edge used to
 *  reach each node (predecessor edge), for path reconstruction. */
function dijkstra(
  source: string,
  adj: Map<string, Adj[]>,
): { dist: Map<string, number>; viaEdge: Map<string, string>; prev: Map<string, string> } {
  const dist = new Map<string, number>([[source, 0]]);
  const viaEdge = new Map<string, string>();
  const prev = new Map<string, string>();
  const visited = new Set<string>();
  // Simple array-based PQ (graphs here are small; clarity over micro-perf).
  const pq: Array<{ node: string; d: number }> = [{ node: source, d: 0 }];
  while (pq.length) {
    let bi = 0;
    for (let i = 1; i < pq.length; i++) if (pq[i].d < pq[bi].d) bi = i;
    const { node } = pq.splice(bi, 1)[0];
    if (visited.has(node)) continue;
    visited.add(node);
    for (const { edgeId, to, cost } of adj.get(node) ?? []) {
      const nd = (dist.get(node) ?? Infinity) + cost;
      if (nd < (dist.get(to) ?? Infinity)) {
        dist.set(to, nd);
        viaEdge.set(to, edgeId);
        prev.set(to, node);
        pq.push({ node: to, d: nd });
      }
    }
  }
  return { dist, viaEdge, prev };
}

/** City nodes only (places, not bare junctions) — the trade/travel endpoints. */
function cityNodes(graph: NetworkGraph): GraphNode[] {
  return graph.nodes.filter((n) => n.locationId != null);
}

/**
 * Full network analysis. Betweenness counts shortest-path edge/node usage over
 * all ordered city pairs; cut impact counts, per edge, how many connected pairs
 * have *no* alternative (their shortest path with the edge removed is gone or
 * far longer). Both normalized 0..1.
 */
export function analyzeNetwork(graph: NetworkGraph): NetworkAnalysis {
  const adj = buildAdjacency(graph);
  const cities = cityNodes(graph);

  const edgeBetween = new Map<string, number>();
  const nodeBetween = new Map<string, number>();
  // Baseline shortest-path cost for each connected ordered city pair.
  const pairCost = new Map<string, number>(); // "src|dst" → cost

  for (const src of cities) {
    const { dist, viaEdge, prev } = dijkstra(src.id, adj);
    for (const dst of cities) {
      if (dst.id === src.id) continue;
      const d = dist.get(dst.id);
      if (d == null || !isFinite(d)) continue; // unreachable
      pairCost.set(`${src.id}|${dst.id}`, d);
      // Walk the path back, tallying edge + intermediate-node usage.
      let cur = dst.id;
      while (cur !== src.id) {
        const e = viaEdge.get(cur);
        if (e) edgeBetween.set(e, (edgeBetween.get(e) ?? 0) + 1);
        const p = prev.get(cur);
        if (p == null) break;
        if (p !== src.id) nodeBetween.set(p, (nodeBetween.get(p) ?? 0) + 1);
        cur = p;
      }
    }
  }

  // Cut impact: remove each edge, recount connectivity for the pairs that used
  // it on their shortest path (only those can be affected). A pair is "stranded"
  // if it becomes unreachable, or its detour is >50% longer than the baseline.
  const cutStranded = new Map<string, number>();
  const candidates = graph.edges.filter((e) => e.status !== "destroyed" && (edgeBetween.get(e.id) ?? 0) > 0);
  for (const cut of candidates) {
    const adj2 = buildAdjacencyExcept(graph, cut.id);
    let stranded = 0;
    // Re-run Dijkstra from each city once on the reduced graph.
    const distFrom = new Map<string, Map<string, number>>();
    for (const src of cities) distFrom.set(src.id, dijkstra(src.id, adj2).dist);
    for (const src of cities) {
      for (const dst of cities) {
        if (dst.id === src.id) continue;
        const base = pairCost.get(`${src.id}|${dst.id}`);
        if (base == null) continue; // wasn't connected anyway
        const d2 = distFrom.get(src.id)!.get(dst.id);
        if (d2 == null || !isFinite(d2) || d2 > base * 1.5 + 0.01) stranded++;
      }
    }
    cutStranded.set(cut.id, stranded);
  }

  const maxBetween = Math.max(1, ...edgeBetween.values());
  const maxNodeBetween = Math.max(1, ...nodeBetween.values());
  const maxStranded = Math.max(1, ...cutStranded.values());

  const edges: EdgeScore[] = graph.edges
    .filter((e) => e.status !== "destroyed")
    .map((e) => {
      const between = (edgeBetween.get(e.id) ?? 0) / maxBetween;
      const cut = (cutStranded.get(e.id) ?? 0) / maxStranded;
      return {
        edgeId: e.id,
        routeId: e.routeId,
        betweenness: between,
        cutImpact: cut,
        score: Math.max(between, cut),
        from: e.from,
        to: e.to,
      };
    });

  const nodes: NodeScore[] = cities.map((n) => ({
    nodeId: n.id,
    locationId: n.locationId,
    name: n.name,
    betweenness: (nodeBetween.get(n.id) ?? 0) / maxNodeBetween,
  }));

  const ranked = [...edges].sort((a, b) => b.score - a.score);
  return { edges, nodes, ranked };
}

/** Adjacency excluding one edge id (for cut-impact recomputation). */
function buildAdjacencyExcept(graph: NetworkGraph, excludeId: string): Map<string, Adj[]> {
  const adj = new Map<string, Adj[]>();
  const add = (a: string, b: string, e: GraphEdge, cost: number) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push({ edgeId: e.id, to: b, cost });
  };
  for (const e of graph.edges) {
    if (e.status === "destroyed" || e.id === excludeId) continue;
    const cost = Math.max(0.01, edgeTravelHours(e));
    add(e.from, e.to, e, cost);
    add(e.to, e.from, e, cost);
  }
  return adj;
}

/** Look up a node by id (for naming an edge's endpoints in the UI). */
export function nodeName(graph: NetworkGraph, nodeId: string): string {
  return graph.nodes.find((n) => n.id === nodeId)?.name ?? "junction";
}

// --- Travel-time isochrones -------------------------------------------------

export interface IsochroneNode {
  nodeId: string;
  locationId: string | null;
  name: string;
  lngLat: [number, number];
  /** Hours to reach from the origin at the chosen mode (0 at the origin). */
  hours: number;
}

export interface IsochroneEdge {
  routeId: string;
  /** Max hours of the two endpoints — the band the edge belongs to. */
  hours: number;
}

export interface Isochrones {
  originNodeId: string;
  mode: TravelMode;
  /** Reachable nodes with their time-to-reach (origin included at 0 h). */
  nodes: IsochroneNode[];
  /** Edges on the reachable network, tagged by band for coloring. */
  edges: IsochroneEdge[];
  /** Reachable nodes that are real cities (for a ranked list), nearest first. */
  cities: IsochroneNode[];
}

/** Adjacency with edge cost = travel hours at an explicit mode (not the global). */
function buildAdjacencyAtMode(graph: NetworkGraph, mode: TravelMode): Map<string, Adj[]> {
  const adj = new Map<string, Adj[]>();
  const add = (a: string, b: string, e: GraphEdge, cost: number) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push({ edgeId: e.id, to: b, cost });
  };
  for (const e of graph.edges) {
    if (e.status === "destroyed") continue;
    const cost = Math.max(0.001, travelHours(e.lengthKm, e.status, mode));
    add(e.from, e.to, e, cost);
    add(e.to, e.from, e, cost);
  }
  return adj;
}

/**
 * Travel-time isochrones from an origin node at a given mode: shortest-time to
 * every reachable node (Dijkstra), so the UI can band the map by hours. Pure.
 */
export function computeIsochrones(
  graph: NetworkGraph,
  originNodeId: string,
  mode: TravelMode,
): Isochrones {
  const adj = buildAdjacencyAtMode(graph, mode);
  const { dist } = dijkstra(originNodeId, adj);

  const nodes: IsochroneNode[] = [];
  for (const n of graph.nodes) {
    const h = dist.get(n.id);
    if (h == null || !isFinite(h)) continue; // unreachable from the origin
    nodes.push({ nodeId: n.id, locationId: n.locationId, name: n.name, lngLat: n.lngLat, hours: h });
  }
  const reachable = new Set(nodes.map((n) => n.nodeId));

  const edges: IsochroneEdge[] = [];
  for (const e of graph.edges) {
    if (e.status === "destroyed") continue;
    if (!reachable.has(e.from) || !reachable.has(e.to)) continue;
    const hours = Math.max(dist.get(e.from) ?? 0, dist.get(e.to) ?? 0);
    edges.push({ routeId: e.routeId, hours });
  }

  const cities = nodes
    .filter((n) => n.locationId != null)
    .sort((a, b) => a.hours - b.hours);

  return { originNodeId, mode, nodes, edges, cities };
}
