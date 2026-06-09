// Tests for geodesic measurement: distance and polygon area.
import { describe, it, expect } from "vitest";
import { haversineKm, pathLengthKm, polygonAreaKm2, formatMiles, formatSqMiles } from "./measure";

describe("haversineKm", () => {
  it("is zero for the same point", () => {
    expect(haversineKm([-95, 41], [-95, 41])).toBeCloseTo(0, 6);
  });
  it("~111 km per degree of latitude", () => {
    expect(haversineKm([-95, 41], [-95, 42])).toBeCloseTo(111.2, 0);
  });
});

describe("pathLengthKm", () => {
  it("sums segment lengths", () => {
    const len = pathLengthKm([[-95, 41], [-95, 42], [-95, 43]]);
    expect(len).toBeCloseTo(222.4, 0);
  });
  it("is zero for a single point", () => {
    expect(pathLengthKm([[-95, 41]])).toBe(0);
  });
});

describe("polygonAreaKm2", () => {
  it("approximates a 1°×1° box near 41°N (~9,300 km²)", () => {
    const box: Array<[number, number]> = [
      [-95, 41], [-94, 41], [-94, 42], [-95, 42],
    ];
    const area = polygonAreaKm2(box);
    // ~111 km tall × ~84 km wide (cos 41°) ≈ 9,300 km²; allow generous tolerance.
    expect(area).toBeGreaterThan(8000);
    expect(area).toBeLessThan(10500);
  });
  it("is zero for a degenerate ring", () => {
    expect(polygonAreaKm2([[-95, 41], [-94, 41]])).toBe(0);
  });
});

describe("formatting", () => {
  it("formats miles", () => {
    expect(formatMiles(1.609344)).toBe("1.0 mi");
    expect(formatMiles(160.9344)).toBe("100 mi");
  });
  it("formats square miles", () => {
    expect(formatSqMiles(2.589988)).toBe("1.0 mi²"); // 1 mi²
  });
});
