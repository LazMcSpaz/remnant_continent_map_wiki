// Tests for the Chronicle pure-helper module (sort, filter, yearRange).
import { describe, it, expect } from "vitest";
import { sortEvents, filterEvents, yearRange } from "./chronicle";
import type { ChronicleEvent } from "../layers/features";

function ev(
  id: string,
  year: number,
  title: string,
  opts: Partial<Pick<ChronicleEvent, "body" | "targetType" | "targetId" | "tags">> = {},
): ChronicleEvent {
  return {
    id,
    year,
    title,
    body: opts.body,
    targetType: opts.targetType,
    targetId: opts.targetId,
    tags: opts.tags ?? [],
  };
}

describe("sortEvents", () => {
  it("sorts by year ascending", () => {
    const events = [ev("c", 300, "Late"), ev("a", -500, "Ancient"), ev("b", 100, "Early")];
    const sorted = sortEvents(events);
    expect(sorted.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("breaks year ties by title alphabetically", () => {
    const events = [ev("b", 100, "Zephyr"), ev("a", 100, "Apple"), ev("c", 100, "Mango")];
    const sorted = sortEvents(events);
    expect(sorted.map((e) => e.title)).toEqual(["Apple", "Mango", "Zephyr"]);
  });

  it("does not mutate the input array", () => {
    const events = [ev("b", 200, "B"), ev("a", 100, "A")];
    const original = [...events];
    sortEvents(events);
    expect(events[0].id).toBe(original[0].id);
  });

  it("handles negative years (pre-era)", () => {
    const events = [ev("b", 0, "Zero"), ev("a", -1000, "Before"), ev("c", 500, "After")];
    const sorted = sortEvents(events);
    expect(sorted.map((e) => e.year)).toEqual([-1000, 0, 500]);
  });
});

describe("filterEvents", () => {
  const events = [
    ev("1", 100, "The Great War", { tags: ["war", "politics"], targetType: "faction" }),
    ev("2", 200, "The Plague", { tags: ["disease"], targetType: "location", body: "A terrible plague" }),
    ev("3", 300, "Trade Treaty", { tags: ["politics", "trade"], targetType: "faction" }),
    ev("4", 400, "Flood of Ages", { tags: ["disaster"] }),
  ];

  it("returns all events with empty filter", () => {
    expect(filterEvents(events, {})).toHaveLength(4);
  });

  it("filters by tag", () => {
    const result = filterEvents(events, { tag: "politics" });
    expect(result.map((e) => e.id)).toEqual(["1", "3"]);
  });

  it("filters by targetType", () => {
    const result = filterEvents(events, { targetType: "faction" });
    expect(result.map((e) => e.id)).toEqual(["1", "3"]);
  });

  it("filters by free-text query in title", () => {
    const result = filterEvents(events, { query: "trade" });
    expect(result.map((e) => e.id)).toEqual(["3"]);
  });

  it("filters by free-text query in body", () => {
    const result = filterEvents(events, { query: "terrible" });
    expect(result.map((e) => e.id)).toEqual(["2"]);
  });

  it("query match is case-insensitive", () => {
    const result = filterEvents(events, { query: "GREAT" });
    expect(result.map((e) => e.id)).toEqual(["1"]);
  });

  it("combines tag and query filters (AND)", () => {
    const result = filterEvents(events, { tag: "politics", query: "war" });
    expect(result.map((e) => e.id)).toEqual(["1"]);
  });

  it("returns empty when nothing matches", () => {
    expect(filterEvents(events, { tag: "nonexistent" })).toHaveLength(0);
  });

  it("ignores empty-string tag/targetType/query (no filtering)", () => {
    expect(filterEvents(events, { tag: "", targetType: "", query: "" })).toHaveLength(4);
  });
});

describe("yearRange", () => {
  it("returns [0, 0] for an empty list", () => {
    expect(yearRange([])).toEqual([0, 0]);
  });

  it("returns [year, year] for a single event", () => {
    expect(yearRange([ev("a", 42, "Solo")])).toEqual([42, 42]);
  });

  it("returns the correct min and max across multiple years", () => {
    const events = [ev("a", 300, "A"), ev("b", -500, "B"), ev("c", 100, "C")];
    expect(yearRange(events)).toEqual([-500, 300]);
  });

  it("handles all-same years", () => {
    const events = [ev("a", 50, "A"), ev("b", 50, "B")];
    expect(yearRange(events)).toEqual([50, 50]);
  });
});
