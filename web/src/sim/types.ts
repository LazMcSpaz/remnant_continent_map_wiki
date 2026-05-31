// Phase 4 simulation — shared types (the contract from sim/INTERFACE.md).
//
// The engine consumes two things produced by earlier phases: the derived
// NetworkGraph (web/src/derived/network-graph.ts) and per-city baselines
// (production/consumption per resource). It never builds its own graph and
// never reads authored/derived state directly — only these shapes.

import type { ResourceKind } from "../derived/resources";

export type { ResourceKind };
export const RESOURCES: ResourceKind[] = ["food", "water", "energy", "production"];

/** Production & consumption per resource for one city, in abstract units/turn. */
export interface CityBaseline {
  production: Record<ResourceKind, number>;
  consumption: Record<ResourceKind, number>;
  /** Population the consumption was scaled from (for inspectability). */
  population: number;
  /** Owning faction id (null = unaligned). Gates inter-faction trade. */
  factionId: string | null;
}

/** Per-location baselines, keyed by location id. */
export type CityBaselines = Record<string, CityBaseline>;

/** Relationship stance between factions (mirrors db RelationLevel). */
export type RelationLevel = "self" | "allies" | "friendly" | "tense" | "hostile";

/**
 * How much of a surplus a faction will share across a given stance — the
 * fraction of an otherwise-available shipment that actually flows. Same faction
 * shares fully; hostile factions don't trade at all.
 */
export const SHARE_FACTOR: Record<RelationLevel, number> = {
  self: 1.0,
  allies: 0.85,
  friendly: 0.6,
  tense: 0.25,
  hostile: 0,
};

/** Resolves the stance between two faction ids (order-independent). */
export type RelationFn = (a: string | null, b: string | null) => RelationLevel;

/** One resource shipment across one edge in a turn (for narratable flows). */
export interface Flow {
  edgeId: string;
  routeId: string;
  resource: ResourceKind;
  amount: number;
  /** Direction the goods moved (node ids). */
  from: string;
  to: string;
}

/** The simulated state at a given turn. Deterministic function of its inputs. */
export interface SimState {
  turn: number;
  /** Per location id → per resource stockpile (can go negative = unmet demand). */
  stockpiles: Record<string, Record<ResourceKind, number>>;
  /** Trade that happened producing this state. */
  flows: Flow[];
  /** Per location id → 0..100 pressure (deficit/starvation readout). */
  pressure: Record<string, number>;
  /** Per location id → per resource net after trade (surplus + / deficit −). */
  balance: Record<string, Record<ResourceKind, number>>;
  /** Per faction id → accumulated wealth (who benefits from surplus). */
  wealth: Record<string, number>;
}
