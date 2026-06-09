// Tests for travel-time math: status factors, mode speeds, formatting.
import { describe, it, expect } from "vitest";
import { TRAVEL_MODES, travelHours, formatMiles, formatHours } from "./travel";

const foot = TRAVEL_MODES.find((m) => m.id === "foot")!;
const rail = TRAVEL_MODES.find((m) => m.id === "rail")!;

describe("travelHours", () => {
  it("scales with distance and inversely with speed", () => {
    const onFoot = travelHours(100, "intact", foot);
    const byRail = travelHours(100, "intact", rail);
    expect(onFoot).toBeGreaterThan(byRail);
    // 100 km ≈ 62 mi; foot 3 mph → ~20.7 h.
    expect(onFoot).toBeCloseTo(20.7, 1);
  });
  it("never zero — damaged/destroyed slow but don't sever", () => {
    const intact = travelHours(100, "intact", foot);
    const damaged = travelHours(100, "damaged", foot);
    const destroyed = travelHours(100, "destroyed", foot);
    expect(damaged).toBeGreaterThan(intact);
    expect(destroyed).toBeGreaterThan(damaged);
    expect(destroyed).toBeLessThan(Infinity);
    expect(damaged).toBeCloseTo(intact * 2, 5); // 0.5 status factor
    expect(destroyed).toBeCloseTo(intact * 4, 5); // 0.25 status factor
  });
});

describe("formatting", () => {
  it("formats miles", () => {
    expect(formatMiles(1.609344)).toBe("1.0 mi");
    expect(formatMiles(160.9344)).toBe("100 mi");
  });
  it("formats hours and days", () => {
    expect(formatHours(3.4)).toBe("3.4 h");
    expect(formatHours(52)).toBe("2 d 4 h");
  });
});
