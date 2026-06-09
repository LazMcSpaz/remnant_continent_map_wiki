// Tests for faction stat aggregation: pop-weighted tech average + summed
// influence, validated by hand during development (a big advanced capital
// outweighs a tiny village; no-population factions fall back to a flat average).
import { describe, it, expect } from "vitest";
import { deriveFactionStats, factionTech } from "./faction-stats";
import type { LocationDetail } from "../layers/features";

// Only factionId/population/techLevel/influence are read; cast minimal stubs.
function city(factionId: string | null, population: number, techLevel: number, influence: number): LocationDetail {
  return { factionId, population, techLevel, influence } as LocationDetail;
}

describe("deriveFactionStats", () => {
  it("weights tech by population (capital outweighs village)", () => {
    const stats = deriveFactionStats([
      city("F1", 200000, 8, 50), // big advanced capital
      city("F1", 5000, 2, 5),    // tiny village
      city(null, 1000, 9, 99),   // unaligned — ignored
    ]);
    const f1 = stats.get("F1")!;
    expect(f1.techLevel).toBeCloseTo(7.85, 1);
    expect(f1.influence).toBe(55);
    expect(f1.cityCount).toBe(2);
    expect(stats.has("__none__")).toBe(false);
  });

  it("falls back to a flat tech average when no populations are recorded", () => {
    const stats = deriveFactionStats([
      city("F2", 0, 6, 20),
      city("F2", 0, 4, 10),
    ]);
    expect(stats.get("F2")!.techLevel).toBeCloseTo(5, 5);
    expect(stats.get("F2")!.influence).toBe(30);
  });

  it("factionTech defaults to 5 for unknown/null factions", () => {
    const stats = deriveFactionStats([city("F1", 10000, 8, 0)]);
    expect(factionTech(stats, null)).toBe(5);
    expect(factionTech(stats, "missing")).toBe(5);
    expect(factionTech(stats, "F1")).toBeCloseTo(8, 5);
  });
});
