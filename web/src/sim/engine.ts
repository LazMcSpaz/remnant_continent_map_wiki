// Phase 4 — the flow simulation engine.
//
// Turn-based, deterministic, fully inspectable: every number traces to a cause.
// One forward step:
//
//   1. PRODUCE/CONSUME — each city adds production and subtracts consumption
//      into its stockpiles; the per-resource net is its surplus (+) or need (−).
//   2. TRADE — for each resource, surplus moves toward deficit across the
//      route network. We route greedily along shortest (fewest-hop, then
//      shortest-length) paths of *usable* edges, capacity-limited; a severed
//      (destroyed) edge carries nothing, so cities behind a cut starve.
//   3. PRESSURE — unmet demand after trade becomes a 0..100 pressure readout;
//      a chokepoint that, when cut, strands demand shows up as pressure spikes.
//
// Pure: step(prev, graph, baselines) always yields the same SimState. No I/O,
// no map, no DB — it only reads the two contract inputs (see INTERFACE.md).

import type { NetworkGraph, GraphEdge } from "../derived/network-graph";
import { RESOURCES, type CityBaselines, type Flow, type ResourceKind, type SimState } from "./types";

/** Capacity (units/turn) a single edge can carry, by its graph capacity tier
 *  and status. Damaged edges are throttled; destroyed carry nothing. */
function edgeThroughput(edge: GraphEdge): number {
  if (edge.status === "destroyed") return 0;
  const base = edge.capacity * 40; // tier 1/2/3 → 40/80/120 units/turn
  return edge.status === "damaged" ? base * 0.5 : base;
}

interface Adj {
  edge: GraphEdge;
  to: string;
}

/** Undirected adjacency (goods can move either way along a route). */
function buildAdjacency(graph: NetworkGraph): Map<string, Adj[]> {
  const adj = new Map<string, Adj[]>();
  const add = (a: string, b: string, edge: GraphEdge) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push({ edge, to: b });
  };
  for (const e of graph.edges) {
    add(e.from, e.to, e);
    add(e.to, e.from, e);
  }
  return adj;
}

/** A node's stockpile, zero-initialized across all resources. */
function zeroResources(): Record<ResourceKind, number> {
  return { food: 0, water: 0, energy: 0, production: 0 };
}

/**
 * BFS shortest path (fewest hops) of edges with remaining capacity from `start`
 * to any node in `sinks`, returning the path of edges + the destination, or null.
 * Re-run per shipment so capacity already spent is respected.
 */
function findPath(
  start: string,
  sinks: Set<string>,
  adj: Map<string, Adj[]>,
  remaining: Map<string, number>,
): { dest: string; edges: GraphEdge[] } | null {
  if (sinks.has(start)) return { dest: start, edges: [] };
  const prev = new Map<string, { node: string; edge: GraphEdge }>();
  const seen = new Set<string>([start]);
  let frontier = [start];
  while (frontier.length) {
    const next: string[] = [];
    for (const node of frontier) {
      for (const { edge, to } of adj.get(node) ?? []) {
        if (seen.has(to)) continue;
        if ((remaining.get(edge.id) ?? 0) <= 0) continue; // no capacity left
        seen.add(to);
        prev.set(to, { node, edge });
        if (sinks.has(to)) {
          // Reconstruct.
          const edges: GraphEdge[] = [];
          let cur = to;
          while (cur !== start) {
            const p = prev.get(cur)!;
            edges.push(p.edge);
            cur = p.node;
          }
          edges.reverse();
          return { dest: to, edges };
        }
        next.push(to);
      }
    }
    frontier = next;
  }
  return null;
}

/** Map a node id to the location id it represents (junctions have none). */
function nodeLocation(graph: NetworkGraph, nodeId: string): string | null {
  return graph.nodes.find((n) => n.id === nodeId)?.locationId ?? null;
}

export interface StepOptions {
  /** Cap on shipments routed per resource per turn (keeps a step bounded). */
  maxShipmentsPerResource?: number;
}

/** The empty initial state (turn 0, everything at zero). */
export function initialState(): SimState {
  return { turn: 0, stockpiles: {}, flows: [], pressure: {}, balance: {} };
}

/**
 * One deterministic forward step. Carries `prev.stockpiles` forward (so surplus
 * banked last turn is still there), applies production/consumption, trades
 * across the network, and reports flows + pressure.
 */
export function step(
  prev: SimState,
  graph: NetworkGraph,
  baselines: CityBaselines,
  opts: StepOptions = {},
): SimState {
  const maxShip = opts.maxShipmentsPerResource ?? 500;

  // Node id ⇄ location id, for cities that are in the graph.
  const locNodes: Array<{ nodeId: string; locId: string }> = [];
  for (const n of graph.nodes) {
    if (n.locationId && baselines[n.locationId]) {
      locNodes.push({ nodeId: n.id, locId: n.locationId });
    }
  }

  // 1. PRODUCE / CONSUME into carried-forward stockpiles.
  const stock: Record<string, Record<ResourceKind, number>> = {};
  const net: Record<string, Record<ResourceKind, number>> = {}; // this turn's surplus/need
  for (const { locId } of locNodes) {
    const base = baselines[locId];
    const carried = prev.stockpiles[locId];
    stock[locId] = zeroResources();
    net[locId] = zeroResources();
    for (const r of RESOURCES) {
      const delta = base.production[r] - base.consumption[r];
      net[locId][r] = delta;
      // Stockpiles persist but don't grow without bound (perish: decay 15%/turn).
      const carryover = (carried?.[r] ?? 0) * 0.85;
      stock[locId][r] = carryover + delta;
    }
  }

  // 2. TRADE: per resource, move surplus toward deficit across usable edges.
  const adj = buildAdjacency(graph);
  const flows: Flow[] = [];
  const remaining = new Map<string, number>();
  for (const e of graph.edges) remaining.set(e.id, edgeThroughput(e));

  for (const r of RESOURCES) {
    // Sources: nodes with positive stock; sinks: nodes still in deficit.
    const surplusNode = new Map<string, number>();
    for (const { nodeId, locId } of locNodes) {
      const s = stock[locId][r];
      if (s > 0.01) surplusNode.set(nodeId, s);
    }
    if (surplusNode.size === 0) continue;

    let shipments = 0;
    // Greedy: repeatedly take a source and push to the nearest deficit sink.
    for (const { nodeId: srcNode, locId: srcLoc } of locNodes) {
      let avail = stock[srcLoc][r];
      if (avail <= 0.01) continue;
      while (avail > 0.01 && shipments < maxShip) {
        // Sinks recomputed each shipment (a sink may have just been satisfied).
        const sinks = new Set<string>();
        for (const { nodeId, locId } of locNodes) {
          if (nodeId !== srcNode && stock[locId][r] < -0.01) sinks.add(nodeId);
        }
        if (sinks.size === 0) break;
        const path = findPath(srcNode, sinks, adj, remaining);
        if (!path) break; // no usable route to any remaining deficit
        const destLoc = nodeLocation(graph, path.dest)!;
        const need = -stock[destLoc][r];
        // Bottleneck = min remaining capacity along the path.
        let cap = Infinity;
        for (const e of path.edges) cap = Math.min(cap, remaining.get(e.id) ?? 0);
        const amount = Math.min(avail, need, cap);
        if (amount <= 0.01) break;
        // Apply: move goods, spend capacity, record one flow per edge.
        stock[srcLoc][r] -= amount;
        stock[destLoc][r] += amount;
        avail -= amount;
        for (const e of path.edges) {
          remaining.set(e.id, (remaining.get(e.id) ?? 0) - amount);
          flows.push({
            edgeId: e.id, routeId: e.routeId, resource: r, amount,
            from: e.from, to: e.to,
          });
        }
        shipments++;
      }
    }
  }

  // 3. PRESSURE: unmet demand after trade → 0..100. Weighted toward essentials.
  const WEIGHT: Record<ResourceKind, number> = { food: 1.0, water: 1.0, energy: 0.6, production: 0.3 };
  const pressure: Record<string, number> = {};
  for (const { locId } of locNodes) {
    let unmet = 0;
    let demand = 0;
    for (const r of RESOURCES) {
      const c = baselines[locId].consumption[r];
      demand += c * WEIGHT[r];
      if (stock[locId][r] < 0) unmet += Math.min(c, -stock[locId][r]) * WEIGHT[r];
    }
    pressure[locId] = demand > 0 ? Math.max(0, Math.min(100, (unmet / demand) * 100)) : 0;
  }

  return { turn: prev.turn + 1, stockpiles: stock, flows, pressure, balance: net };
}

/** Run N steps from a starting state (convenience for jumping to a turn). */
export function run(
  from: SimState,
  turns: number,
  graph: NetworkGraph,
  baselines: CityBaselines,
  opts?: StepOptions,
): SimState {
  let s = from;
  for (let i = 0; i < turns; i++) s = step(s, graph, baselines, opts);
  return s;
}
