// Tests for the rule-based climate model — locks in the post-shift world's
// numerical behaviour that was validated ad-hoc during development:
// Peru (the new pole) frozen, the old Arctic tropical, the temperature field
// the right way up, the growing-warmth optimum band, biomes, F conversion.
import { describe, it, expect } from "vitest";
import {
  cToF,
  formatTempF,
  poleDistanceDeg,
  DEFAULT_POLE,
  effLatitude,
  temperatureAt,
  growingSeasonTempC,
  growingWarmth,
  moistureSuitability,
  biomeAt,
  seaLevelAt,
  climateInputs,
  type ClimateInputs,
} from "./climate";

const PERU = DEFAULT_POLE; // [-75, -10]
const inp: ClimateInputs = climateInputs(null); // defaults: pole=Peru, eq 28, pole -30

describe("temperature conversion", () => {
  it("converts C to F", () => {
    expect(cToF(0)).toBe(32);
    expect(cToF(100)).toBe(212);
    expect(cToF(-40)).toBe(-40);
  });
  it("formats whole degrees F", () => {
    expect(formatTempF(0)).toBe("32 °F");
    expect(formatTempF(20)).toBe("68 °F");
  });
});

describe("pole geometry", () => {
  it("is 0° at the pole and ~90° on the new equator", () => {
    expect(poleDistanceDeg(PERU, PERU)).toBeCloseTo(0, 5);
    // A point a quarter-circle away should be ~90° from the pole.
    expect(poleDistanceDeg([-75, 80], PERU)).toBeGreaterThan(80);
  });
  it("effective latitude is 90 minus pole distance", () => {
    expect(effLatitude(PERU, PERU)).toBeCloseTo(90, 5);
  });
});

describe("temperature field (post-shift, not inverted)", () => {
  // The bug we fixed: the pole must be COLD, the new equator HOT.
  it("freezes at the new pole (Peru)", () => {
    const t = temperatureAt(PERU, 0, inp);
    expect(t).toBeLessThan(-15);
  });
  it("is hot near the new equator (old Arctic, ~Hudson Bay)", () => {
    const t = temperatureAt([-85, 58], 10, inp);
    expect(t).toBeGreaterThan(15);
  });
  it("cools with elevation (lapse rate)", () => {
    const low = temperatureAt([-95.9, 41], 0, inp);
    const high = temperatureAt([-95.9, 41], 2000, inp);
    expect(high).toBeLessThan(low);
    // ~6.5 C/km lapse over 2 km ≈ 13 C cooler.
    expect(low - high).toBeCloseTo(13, 0);
  });
});

describe("growing warmth (optimum band, not 'hotter is better')", () => {
  it("is zero below the cold cutoff and above heat stress", () => {
    expect(growingWarmth(2)).toBe(0);
    expect(growingWarmth(45)).toBe(0);
  });
  it("peaks in the temperate optimum (~20-28 C)", () => {
    expect(growingWarmth(24)).toBe(100);
  });
  it("falls off in the scorching range", () => {
    expect(growingWarmth(38)).toBeGreaterThan(0);
    expect(growingWarmth(38)).toBeLessThan(100);
  });
  it("rewards the temperate Midwest over frozen highland", () => {
    const midwest = growingWarmth(growingSeasonTempC([-95.9, 41], 300, inp));
    const denver = growingWarmth(growingSeasonTempC([-105, 39.7], 1600, inp));
    expect(midwest).toBeGreaterThan(80);
    expect(midwest).toBeGreaterThan(denver);
  });
});

describe("moisture suitability", () => {
  it("is near-zero in aridity and plateaus when well-watered", () => {
    expect(moistureSuitability(5)).toBeLessThan(0.1);
    expect(moistureSuitability(70)).toBe(1);
  });
  it("eases off when waterlogged", () => {
    expect(moistureSuitability(100)).toBeLessThan(1);
    expect(moistureSuitability(100)).toBeGreaterThan(0.7);
  });
});

describe("biomes (Whittaker-style)", () => {
  it("classifies water, ice, desert, rainforest", () => {
    expect(biomeAt(10, 50, true).id).toBe("water");
    expect(biomeAt(-20, 30, false).id).toBe("ice");
    expect(biomeAt(20, 5, false).id).toBe("desert");
    expect(biomeAt(26, 80, false).id).toBe("rainforest");
  });
  it("gives the mild, wet zone a forest", () => {
    expect(biomeAt(15, 60, false).id).toBe("forest");
  });
});

describe("post-shift sea level (equatorial bulge)", () => {
  it("rises toward the new equator, base at the pole", () => {
    const atPole = seaLevelAt(PERU, inp);
    const atEquator = seaLevelAt([-85, 58], inp); // ~90° from Peru
    expect(atPole).toBeCloseTo(inp.seaLevelM, 1);
    expect(atEquator).toBeGreaterThan(150);
  });
});
