// DERIVED: faction figures aggregated from their member cities. A faction's
// authored attributes used to live on the faction; now tech and influence are
// properties of each CITY, and the faction's are recomputed here:
//
//   tech      = population-weighted average of member cities' tech levels
//               (a big advanced capital outweighs a tiny village; falls back to
//                a plain average when no populations are recorded)
//   influence = sum of member cities' influence
//
// Pure: a function of the location details. Never stored.

import type { LocationDetail } from "../layers/features";

export interface FactionStats {
  /** Pop-weighted average tech level (1..10), or null if the faction has no cities. */
  techLevel: number | null;
  /** Summed influence across member cities. */
  influence: number;
  /** Number of member cities. */
  cityCount: number;
  /** Total population across member cities. */
  population: number;
}

/** Aggregate per-faction stats from all location details, keyed by faction id. */
export function deriveFactionStats(details: Iterable<LocationDetail>): Map<string, FactionStats> {
  // Accumulators per faction.
  const acc = new Map<string, { wTech: number; wSum: number; flatTech: number; influence: number; count: number; pop: number }>();
  for (const d of details) {
    if (!d.factionId) continue;
    const a = acc.get(d.factionId) ?? { wTech: 0, wSum: 0, flatTech: 0, influence: 0, count: 0, pop: 0 };
    const pop = d.population && d.population > 0 ? d.population : 0;
    a.wTech += d.techLevel * pop;
    a.wSum += pop;
    a.flatTech += d.techLevel;
    a.influence += d.influence;
    a.count += 1;
    a.pop += pop;
    acc.set(d.factionId, a);
  }
  const out = new Map<string, FactionStats>();
  for (const [id, a] of acc) {
    const techLevel = a.wSum > 0 ? a.wTech / a.wSum : a.count > 0 ? a.flatTech / a.count : null;
    out.set(id, { techLevel, influence: a.influence, cityCount: a.count, population: a.pop });
  }
  return out;
}

/** Tech level for one faction (pop-weighted average), defaulting to 5 when the
 *  faction has no cities — keeps the simulation's production scaling sane. */
export function factionTech(stats: Map<string, FactionStats>, factionId: string | null): number {
  if (!factionId) return 5;
  return stats.get(factionId)?.techLevel ?? 5;
}
