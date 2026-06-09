// Pure module: aggregate per-faction data into FactionSummary records for the
// faction dashboard panel. No DOM, fully testable.
//
// Relationship counts use the same symmetric logic as buildRelationFn: a missing
// pair means the baseline "friendly" stance; absent rows are NOT counted in any
// non-friendly bucket. Only non-friendly pairings appear in the ally/tense/hostile
// tallies (friendly is the default, so we count the explicit stances only).
//
// Sort order: by influence desc (summed influence is the primary power metric in
// this world's economy model; cityCount / pop break ties deterministically).

import type { Faction, FactionRelation } from "../state/db-types";
import type { LocationDetail, TerritoryProps } from "../layers/features";
import type { FeatureCollection, MultiPolygon } from "geojson";
import { deriveFactionStats } from "./faction-stats";

export interface FactionSummary {
  id: string;
  name: string;
  color: string;
  tier: Faction["tier"];
  /** Number of member cities. */
  cityCount: number;
  /** Total population across member cities. */
  population: number;
  /** Pop-weighted average tech level (null if the faction has no cities). */
  techLevel: number | null;
  /** Summed influence across member cities. */
  influence: number;
  /** Sim wealth at the current turn (null if sim not running). */
  wealth: number | null | undefined;
  /** Number of territory polygons (MultiPolygon features) belonging to this faction. */
  territoryCount: number;
  /** Count of other factions with explicit "allies" stance. */
  allies: number;
  /** Count of other factions with explicit "friendly" stance (listed explicitly; the
   *  implicit/default friendly is NOT counted here — only authored rows). */
  friendly: number;
  /** Count of other factions with "tense" stance. */
  tense: number;
  /** Count of other factions with "hostile" stance. */
  hostile: number;
}

export interface SummarizeFactionInput {
  factions: Map<string, Faction>;
  locationDetails: Map<string, LocationDetail>;
  relations: FactionRelation[];
  territories: FeatureCollection<MultiPolygon, TerritoryProps>;
  /** Returns the sim wealth for a faction, or null when the sim is not active. */
  wealthOf?: ((id: string) => number | null) | undefined;
}

/** Aggregate everything into a sorted list of FactionSummary records.
 *  Sorted by influence desc; ties broken by population desc, then name asc. */
export function summarizeFactions(input: SummarizeFactionInput): FactionSummary[] {
  const { factions, locationDetails, relations, territories, wealthOf } = input;

  // Derive per-faction city/pop/tech/influence stats.
  const stats = deriveFactionStats(locationDetails.values());

  // Count territory polygons per faction.
  const terrCount = new Map<string, number>();
  for (const feat of territories.features) {
    const fid = feat.properties.factionId;
    if (fid) terrCount.set(fid, (terrCount.get(fid) ?? 0) + 1);
  }

  // Build relationship tallies per faction by scanning authored rows.
  // Each row covers both directions (symmetric).
  const allies = new Map<string, number>();
  const friendly = new Map<string, number>();
  const tense = new Map<string, number>();
  const hostile = new Map<string, number>();

  const bump = (map: Map<string, number>, id: string): void => {
    map.set(id, (map.get(id) ?? 0) + 1);
  };

  for (const r of relations) {
    const a = r.faction_a;
    const b = r.faction_b;
    // Only count factions that actually exist in the current dataset.
    if (!factions.has(a) || !factions.has(b)) continue;
    const lv = r.level;
    if (lv === "allies") {
      bump(allies, a);
      bump(allies, b);
    } else if (lv === "friendly") {
      bump(friendly, a);
      bump(friendly, b);
    } else if (lv === "tense") {
      bump(tense, a);
      bump(tense, b);
    } else if (lv === "hostile") {
      bump(hostile, a);
      bump(hostile, b);
    }
  }

  const summaries: FactionSummary[] = [];
  for (const f of factions.values()) {
    const s = stats.get(f.id);
    const wealth = wealthOf ? wealthOf(f.id) : undefined;
    summaries.push({
      id: f.id,
      name: f.name,
      color: f.color,
      tier: f.tier,
      cityCount: s?.cityCount ?? 0,
      population: s?.population ?? 0,
      techLevel: s?.techLevel ?? null,
      influence: s?.influence ?? 0,
      wealth,
      territoryCount: terrCount.get(f.id) ?? 0,
      allies: allies.get(f.id) ?? 0,
      friendly: friendly.get(f.id) ?? 0,
      tense: tense.get(f.id) ?? 0,
      hostile: hostile.get(f.id) ?? 0,
    });
  }

  // Sort by influence desc, then population desc, then name asc.
  summaries.sort((a, b) => {
    if (b.influence !== a.influence) return b.influence - a.influence;
    if (b.population !== a.population) return b.population - a.population;
    return a.name.localeCompare(b.name);
  });

  return summaries;
}
