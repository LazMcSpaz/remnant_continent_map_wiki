// Build a RelationFn from the authored faction_relations rows. Relations are
// symmetric and sparse: a missing pair means the baseline "friendly" stance,
// and a faction with itself is "self" (full sharing). Unaligned cities (null
// faction) are treated as friendly to everyone so they still participate.

import type { FactionRelation } from "../state/db-types";
import type { RelationFn, RelationLevel } from "./types";

export function buildRelationFn(relations: FactionRelation[]): RelationFn {
  const map = new Map<string, RelationLevel>();
  for (const r of relations) {
    const [a, b] = r.faction_a < r.faction_b ? [r.faction_a, r.faction_b] : [r.faction_b, r.faction_a];
    map.set(`${a}|${b}`, r.level);
  }
  return (a, b) => {
    if (a && b && a === b) return "self";
    // An unaligned city has no faction politics — treat as freely friendly.
    if (!a || !b) return "friendly";
    const [x, y] = a < b ? [a, b] : [b, a];
    return map.get(`${x}|${y}`) ?? "friendly";
  };
}
