// Tests for summarizeFactions: city/pop aggregation, relationship counting,
// territory counting, and sort order.

import { describe, it, expect } from "vitest";
import { summarizeFactions } from "./faction-summary";
import type { Faction, FactionRelation } from "../state/db-types";
import type { LocationDetail, TerritoryProps } from "../layers/features";
import type { FeatureCollection, MultiPolygon } from "geojson";

// Minimal stubs (same idiom as faction-stats.test.ts).
function faction(id: string, name: string, tier: Faction["tier"] = "major"): Faction {
  return { id, name, color: "#aabbcc", tier } as Faction;
}

function city(factionId: string | null, population: number, techLevel: number, influence: number): LocationDetail {
  return { factionId, population, techLevel, influence } as LocationDetail;
}

function relation(faction_a: string, faction_b: string, level: FactionRelation["level"]): FactionRelation {
  // Rows are stored with faction_a < faction_b lexicographically.
  const [a, b] = faction_a < faction_b ? [faction_a, faction_b] : [faction_b, faction_a];
  return { faction_a: a, faction_b: b, level } as FactionRelation;
}

function emptyTerritories(): FeatureCollection<MultiPolygon, TerritoryProps> {
  return { type: "FeatureCollection", features: [] };
}

function territories(...pairs: Array<{ factionId: string }>): FeatureCollection<MultiPolygon, TerritoryProps> {
  return {
    type: "FeatureCollection",
    features: pairs.map((p) => ({
      type: "Feature",
      id: p.factionId + "-t",
      geometry: { type: "MultiPolygon", coordinates: [] } as unknown as MultiPolygon,
      properties: { id: p.factionId + "-t", factionId: p.factionId, factionColor: "#aabbcc" },
    })),
  };
}

describe("summarizeFactions", () => {
  it("aggregates city count and population from locationDetails", () => {
    const factions = new Map([
      ["F1", faction("F1", "Alpha")],
      ["F2", faction("F2", "Beta")],
    ]);
    const locationDetails = new Map([
      ["c1", city("F1", 100_000, 7, 20)],
      ["c2", city("F1", 50_000, 5, 10)],
      ["c3", city("F2", 80_000, 6, 15)],
      ["cx", city(null, 1_000, 3, 99)], // unaligned — ignored per faction
    ]);
    const result = summarizeFactions({
      factions,
      locationDetails,
      relations: [],
      territories: emptyTerritories(),
    });
    const f1 = result.find((s) => s.id === "F1")!;
    const f2 = result.find((s) => s.id === "F2")!;
    expect(f1.cityCount).toBe(2);
    expect(f1.population).toBe(150_000);
    expect(f2.cityCount).toBe(1);
    expect(f2.population).toBe(80_000);
  });

  it("counts relationship stances correctly (allies/tense/hostile)", () => {
    const factions = new Map([
      ["A", faction("A", "Alpha")],
      ["B", faction("B", "Beta")],
      ["C", faction("C", "Gamma")],
      ["D", faction("D", "Delta")],
    ]);
    const rels: FactionRelation[] = [
      relation("A", "B", "allies"),
      relation("A", "C", "tense"),
      relation("A", "D", "hostile"),
      relation("B", "C", "hostile"),
    ];
    const result = summarizeFactions({
      factions,
      locationDetails: new Map(),
      relations: rels,
      territories: emptyTerritories(),
    });
    const a = result.find((s) => s.id === "A")!;
    expect(a.allies).toBe(1);  // allied with B
    expect(a.tense).toBe(1);   // tense with C
    expect(a.hostile).toBe(1); // hostile with D

    const b = result.find((s) => s.id === "B")!;
    expect(b.allies).toBe(1);   // allied with A
    expect(b.hostile).toBe(1);  // hostile with C

    const c = result.find((s) => s.id === "C")!;
    expect(c.tense).toBe(1);    // tense with A
    expect(c.hostile).toBe(1);  // hostile with B
  });

  it("counts territory polygons per faction", () => {
    const factions = new Map([
      ["F1", faction("F1", "Alpha")],
      ["F2", faction("F2", "Beta")],
    ]);
    const terr = territories(
      { factionId: "F1" },
      { factionId: "F1" },
      { factionId: "F2" },
    );
    const result = summarizeFactions({
      factions,
      locationDetails: new Map(),
      relations: [],
      territories: terr,
    });
    expect(result.find((s) => s.id === "F1")!.territoryCount).toBe(2);
    expect(result.find((s) => s.id === "F2")!.territoryCount).toBe(1);
  });

  it("sorts by influence desc (higher influence first)", () => {
    const factions = new Map([
      ["F1", faction("F1", "Low")],
      ["F2", faction("F2", "High")],
    ]);
    const locationDetails = new Map([
      ["c1", city("F1", 10_000, 5, 5)],
      ["c2", city("F2", 10_000, 5, 100)],
    ]);
    const result = summarizeFactions({
      factions,
      locationDetails,
      relations: [],
      territories: emptyTerritories(),
    });
    expect(result[0].id).toBe("F2"); // higher influence first
    expect(result[1].id).toBe("F1");
  });

  it("breaks influence ties by population desc", () => {
    const factions = new Map([
      ["F1", faction("F1", "Small")],
      ["F2", faction("F2", "Big")],
    ]);
    const locationDetails = new Map([
      ["c1", city("F1", 1_000, 5, 50)],
      ["c2", city("F2", 500_000, 5, 50)],
    ]);
    const result = summarizeFactions({
      factions,
      locationDetails,
      relations: [],
      territories: emptyTerritories(),
    });
    expect(result[0].id).toBe("F2"); // bigger population wins tiebreak
  });

  it("surfaces sim wealth via wealthOf when provided", () => {
    const factions = new Map([["F1", faction("F1", "Rich")]]);
    const result = summarizeFactions({
      factions,
      locationDetails: new Map(),
      relations: [],
      territories: emptyTerritories(),
      wealthOf: (id) => (id === "F1" ? 99_999 : null),
    });
    expect(result[0].wealth).toBe(99_999);
  });

  it("omits wealth (undefined) when wealthOf is not provided", () => {
    const factions = new Map([["F1", faction("F1", "Neutral")]]);
    const result = summarizeFactions({
      factions,
      locationDetails: new Map(),
      relations: [],
      territories: emptyTerritories(),
    });
    expect(result[0].wealth).toBeUndefined();
  });

  it("ignores relations referencing factions not in the factions map", () => {
    const factions = new Map([["A", faction("A", "Alpha")]]);
    const rels: FactionRelation[] = [
      relation("A", "UNKNOWN", "hostile"),
    ];
    const result = summarizeFactions({
      factions,
      locationDetails: new Map(),
      relations: rels,
      territories: emptyTerritories(),
    });
    const a = result.find((s) => s.id === "A")!;
    expect(a.hostile).toBe(0); // UNKNOWN not in factions map — row ignored
  });
});
