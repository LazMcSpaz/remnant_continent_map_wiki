// Tests for the search-index pure functions: buildSearchIndex is tested via
// searchEntries on hand-built entries. No DOM or FeatureData needed here.
import { describe, it, expect } from "vitest";
import { searchEntries, type SearchEntry } from "./search-index";

function entry(
  id: string,
  kind: SearchEntry["kind"],
  label: string,
  sublabel: string,
  lngLat?: [number, number],
): SearchEntry {
  return { id, kind, label, sublabel, lngLat, targetId: id };
}

const LOCATIONS: SearchEntry[] = [
  entry("loc:1", "location", "Ashenveil",  "Old Ashford · Iron Pact"),
  entry("loc:2", "location", "New Carrow",  "old: Carrollton · Iron Pact"),
  entry("loc:3", "location", "Port Ashen",  "Old Portsmouth", [-80, 40]),
  entry("loc:4", "location", "Brynn",       "settlement"),
  entry("loc:5", "location", "Ashton Gate", "Old Ashton · Wayfarers"),
];

const FACTIONS: SearchEntry[] = [
  entry("fac:1", "faction", "Iron Pact",  "faction · 3 cities"),
  entry("fac:2", "faction", "Wayfarers",  "faction · 1 city"),
];

const ROUTES: SearchEntry[] = [
  entry("rte:1", "route", "Trade corridor north", "road · intact"),
  entry("rte:2", "route", "Iron Road",            "route · Iron Pact"),
];

const ALL = [...LOCATIONS, ...FACTIONS, ...ROUTES];

// ---------------------------------------------------------------------------
describe("searchEntries — empty / trivial", () => {
  it("returns [] for an empty query", () => {
    expect(searchEntries(ALL, "")).toHaveLength(0);
  });

  it("returns [] for a whitespace-only query", () => {
    expect(searchEntries(ALL, "   ")).toHaveLength(0);
  });

  it("returns [] when nothing matches", () => {
    expect(searchEntries(ALL, "zzznomatch")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe("searchEntries — case insensitivity", () => {
  it("matches lowercase query against mixed-case labels", () => {
    const results = searchEntries(ALL, "ashenveil");
    expect(results.map((e) => e.id)).toContain("loc:1");
  });

  it("matches uppercase query against lowercase label", () => {
    const results = searchEntries(ALL, "BRYNN");
    expect(results.map((e) => e.id)).toContain("loc:4");
  });

  it("matches mixed case", () => {
    const results = searchEntries(ALL, "AshEn");
    const ids = results.map((e) => e.id);
    // Should match Ashenveil and Port Ashen
    expect(ids).toContain("loc:1");
    expect(ids).toContain("loc:3");
  });
});

// ---------------------------------------------------------------------------
describe("searchEntries — ranking: prefix beats substring", () => {
  it("exact label match ranks before prefix, which ranks before substring", () => {
    // "Ashenveil" exact > "Ashton Gate" prefix on 'ash' > "Port Ashen" substring 'ash'
    const results = searchEntries(ALL, "ash");
    const ids = results.map((e) => e.id);
    expect(ids).toContain("loc:1"); // Ashenveil — prefix
    expect(ids).toContain("loc:3"); // Port Ashen — substring in label
    expect(ids).toContain("loc:5"); // Ashton Gate — prefix

    // Prefix-matching entries should all appear before any pure-substring entry
    const idxAshenveil  = ids.indexOf("loc:1");
    const idxAshtonGate = ids.indexOf("loc:5");
    const idxPortAshen  = ids.indexOf("loc:3");
    // Both prefix matches come before the substring match
    expect(idxAshenveil).toBeLessThan(idxPortAshen);
    expect(idxAshtonGate).toBeLessThan(idxPortAshen);
  });

  it("exact label match is ranked first", () => {
    const results = searchEntries(ALL, "Brynn");
    expect(results[0]!.id).toBe("loc:4");
  });

  it("exact-match entry ranks ahead of prefix-only entries", () => {
    // "Iron Pact" exact > "Iron Road" prefix > "Iron Pact" in sublabel of route
    const results = searchEntries(ALL, "Iron Pact");
    const ids = results.map((e) => e.id);
    expect(ids[0]).toBe("fac:1"); // exact match
  });
});

// ---------------------------------------------------------------------------
describe("searchEntries — sublabel fallback", () => {
  it("matches on sublabel when label doesn't match", () => {
    // 'Old Portsmouth' only appears in sublabel of Port Ashen
    const results = searchEntries(ALL, "Portsmouth");
    const ids = results.map((e) => e.id);
    expect(ids).toContain("loc:3");
  });

  it("label matches rank above sublabel-only matches", () => {
    // 'iron' matches label of Iron Pact (faction) and Iron Road (route),
    // and sublabel of loc:1 (Iron Pact) and loc:2 (Iron Pact)
    const results = searchEntries(ALL, "iron");
    const ids = results.map((e) => e.id);
    const idxIronPact = ids.indexOf("fac:1");
    const idxIronRoad = ids.indexOf("rte:2");
    const idxAshenveil = ids.indexOf("loc:1"); // sublabel match
    // Label-matching faction + route appear before sublabel matches
    expect(idxIronPact).toBeLessThan(idxAshenveil);
    expect(idxIronRoad).toBeLessThan(idxAshenveil);
  });
});

// ---------------------------------------------------------------------------
describe("searchEntries — result cap", () => {
  it("caps results at 20", () => {
    // Build 30 entries all matching query 'x'
    const big: SearchEntry[] = Array.from({ length: 30 }, (_, i) =>
      entry(`x:${i}`, "location", `x-city-${i}`, "sublabel"),
    );
    const results = searchEntries(big, "x");
    expect(results.length).toBeLessThanOrEqual(20);
  });
});
