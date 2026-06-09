// Tests for the sim's supporting pure functions: relationship resolution
// (symmetric, sparse, sensible defaults) and tech → production multiplier.
import { describe, it, expect } from "vitest";
import { buildRelationFn } from "./relations";
import { techMultiplier, cityBaseline } from "./baselines";
import type { FactionRelation } from "../state/db-types";
import type { CityResources } from "../derived/resources";

function rel(a: string, b: string, level: FactionRelation["level"]): FactionRelation {
  return { id: `${a}-${b}`, faction_a: a, faction_b: b, level, created_at: "", updated_at: "" };
}

describe("buildRelationFn", () => {
  const fn = buildRelationFn([rel("FA", "FB", "allies"), rel("FB", "FC", "hostile")]);

  it("is symmetric regardless of argument order", () => {
    expect(fn("FA", "FB")).toBe("allies");
    expect(fn("FB", "FA")).toBe("allies");
    expect(fn("FB", "FC")).toBe("hostile");
    expect(fn("FC", "FB")).toBe("hostile");
  });
  it("returns 'self' for a faction with itself", () => {
    expect(fn("FA", "FA")).toBe("self");
  });
  it("defaults unspecified pairs to 'friendly'", () => {
    expect(fn("FA", "FC")).toBe("friendly");
  });
  it("treats unaligned (null) cities as friendly", () => {
    expect(fn(null, "FA")).toBe("friendly");
    expect(fn("FA", null)).toBe("friendly");
  });
});

describe("techMultiplier", () => {
  it("maps 1→0.5, 5→~0.94 baseline, 10→1.5, clamped", () => {
    expect(techMultiplier(1)).toBeCloseTo(0.5, 5);
    expect(techMultiplier(5)).toBeCloseTo(0.944, 2);
    expect(techMultiplier(10)).toBeCloseTo(1.5, 5);
    expect(techMultiplier(0)).toBeCloseTo(0.5, 5); // clamps low
    expect(techMultiplier(99)).toBeCloseTo(1.5, 5); // clamps high
  });
});

describe("cityBaseline", () => {
  // Minimal CityResources stub — only values[r].effective is read.
  const resources = {
    values: {
      food: { kind: "food", baseline: 80, pinned: null, effective: 80, isPinned: false },
      water: { kind: "water", baseline: 40, pinned: null, effective: 40, isPinned: false },
      energy: { kind: "energy", baseline: 50, pinned: null, effective: 50, isPinned: false },
      production: { kind: "production", baseline: 60, pinned: null, effective: 60, isPinned: false },
    },
    regionName: "grassland",
  } as unknown as CityResources;

  it("scales production by tech and population, sets faction", () => {
    const lowTech = cityBaseline({ locationId: "A", population: 10000, resources, factionId: "FX", techLevel: 1 });
    const highTech = cityBaseline({ locationId: "A", population: 10000, resources, factionId: "FX", techLevel: 10 });
    expect(highTech.production.food).toBeGreaterThan(lowTech.production.food);
    expect(lowTech.factionId).toBe("FX");
    // Consumption is tech-independent (population demand).
    expect(lowTech.consumption.food).toBe(highTech.consumption.food);
  });

  it("uses a default population when none is recorded", () => {
    const b = cityBaseline({ locationId: "A", population: null, resources, factionId: null, techLevel: 5 });
    expect(b.population).toBeGreaterThan(0);
  });
});
