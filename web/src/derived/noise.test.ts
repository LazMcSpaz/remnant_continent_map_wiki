// Tests for the procedural noise + composite elevation: determinism (same world
// every render), bounded range, and the Gaussian brush falloff validated by
// hand (full at centre, ~0.6 at half-radius, 0 at the edge).
import { describe, it, expect } from "vitest";
import { fbm, ridged } from "./noise";
import { detailNoise, editWeight, type ElevationEdit } from "./terrain";

const KM_PER_DEG_LAT = 111.32;

describe("noise", () => {
  it("is deterministic (same point → same value)", () => {
    expect(fbm(-95.9, 41, 8)).toBe(fbm(-95.9, 41, 8));
    expect(ridged(-95.9, 41, 12)).toBe(ridged(-95.9, 41, 12));
  });
  it("fbm is roughly in [-1, 1]", () => {
    for (let i = 0; i < 200; i++) {
      const v = fbm(i * 0.137, i * 0.071, 6);
      expect(v).toBeGreaterThanOrEqual(-1.2);
      expect(v).toBeLessThanOrEqual(1.2);
    }
  });
  it("ridged is roughly in [0, 1]", () => {
    for (let i = 0; i < 200; i++) {
      const v = ridged(i * 0.211, i * 0.099, 10);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1.1);
    }
  });
  it("adds no detail to ocean floor (elev <= 0)", () => {
    expect(detailNoise(-95, 41, 0)).toBe(0);
    expect(detailNoise(-95, 41, -50)).toBe(0);
  });
});

describe("brush edit Gaussian falloff", () => {
  const edit: ElevationEdit = { id: "e1", lng: -95, lat: 41, radiusKm: 60, deltaM: -300 };
  const eastKm = (km: number) => -95 + km / (KM_PER_DEG_LAT * Math.cos((41 * Math.PI) / 180));

  it("is full (1) at the centre, ~0.6 at half-radius, 0 at/past the edge", () => {
    expect(editWeight(edit, -95, 41)).toBeCloseTo(1, 5);
    expect(editWeight(edit, eastKm(30), 41)).toBeCloseTo(0.607, 2);
    expect(editWeight(edit, eastKm(60), 41)).toBe(0);
    expect(editWeight(edit, eastKm(80), 41)).toBe(0);
  });
});
