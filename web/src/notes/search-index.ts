// Search index for the global command palette (Ctrl-K).
//
// Pure module — no DOM, no map references. Builds a flat SearchEntry[] from
// FeatureData and ranks query results with a simple prefix-first / substring
// fallback. Kept separate so it can be unit-tested without a browser.

import type { FeatureData } from "../layers/features";

/** What gets selected when the user chooses a result. */
export type SearchKind = "location" | "faction" | "route";

export interface SearchEntry {
  /** Unique composite key: "{kind}:{id}" */
  id: string;
  kind: SearchKind;
  /** Primary display label (city name, faction name, route purpose). */
  label: string;
  /** Secondary line: old-world name + faction, or city count, or owner. */
  sublabel: string;
  /** For flying the map to the result. May be absent (factions, routes). */
  lngLat?: [number, number] | undefined;
  /** The underlying authored id that panels and selection use. */
  targetId: string;
}

// ---------------------------------------------------------------------------
// Index builder

/** Build a fresh SearchEntry[] from the current FeatureData snapshot. */
export function buildSearchIndex(data: FeatureData): SearchEntry[] {
  const entries: SearchEntry[] = [];

  // --- Locations -----------------------------------------------------------
  // Count cities per faction for the faction sublabel below.
  const cityCount = new Map<string, number>();
  for (const detail of data.locationDetails.values()) {
    if (detail.factionId) {
      cityCount.set(detail.factionId, (cityCount.get(detail.factionId) ?? 0) + 1);
    }
  }

  for (const detail of data.locationDetails.values()) {
    const parts: string[] = [];
    if (detail.oldWorldName) parts.push(detail.oldWorldName);
    if (detail.factionName) parts.push(detail.factionName);
    const sublabel = parts.join(" · ") || detail.type;
    const entry: SearchEntry = {
      id: `location:${detail.id}`,
      kind: "location",
      label: detail.name,
      sublabel,
      targetId: detail.id,
    };
    if (detail.lngLat != null) {
      entry.lngLat = detail.lngLat;
    }
    entries.push(entry);
  }

  // --- Factions ------------------------------------------------------------
  for (const faction of data.factions.values()) {
    const n = cityCount.get(faction.id) ?? 0;
    const city = n === 1 ? "city" : "cities";
    entries.push({
      id: `faction:${faction.id}`,
      kind: "faction",
      label: faction.name,
      sublabel: `faction · ${n} ${city}`,
      targetId: faction.id,
    });
  }

  // --- Routes --------------------------------------------------------------
  for (const feature of data.routes.features) {
    const p = feature.properties;
    const label = p.purpose ?? `${p.routeClass} ${p.kind}`;
    // Sublabel: owner faction name if available.
    const ownerName = p.ownerFactionId ? (data.factions.get(p.ownerFactionId)?.name ?? null) : null;
    const sublabel = ownerName ? `route · ${ownerName}` : `${p.kind} · ${p.status}`;
    entries.push({
      id: `route:${p.id}`,
      kind: "route",
      label,
      sublabel,
      targetId: p.id,
    });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Search / ranking

const MAX_RESULTS = 20;

/**
 * Filter and rank entries against `query`.
 *
 * - Empty query → returns [] (the palette shows nothing until the user types).
 * - Matching is case-insensitive substring on label + sublabel.
 * - Ranking: exact prefix match on label > prefix match on label > substring
 *   match on label > substring match on sublabel. Ties preserve insertion order
 *   so the index ordering (locations first, then factions, then routes) acts
 *   as a tiebreaker.
 * - Capped at MAX_RESULTS (20).
 */
export function searchEntries(entries: SearchEntry[], query: string): SearchEntry[] {
  const q = query.trim();
  if (!q) return [];

  const lower = q.toLowerCase();

  type Ranked = { entry: SearchEntry; score: number };
  const ranked: Ranked[] = [];

  for (const entry of entries) {
    const label = entry.label.toLowerCase();
    const sub = entry.sublabel.toLowerCase();

    let score = 0;
    if (label === lower) {
      // Exact match on label — best possible.
      score = 40;
    } else if (label.startsWith(lower)) {
      // Prefix on label — very relevant.
      score = 30;
    } else if (label.includes(lower)) {
      // Substring inside label — relevant.
      score = 20;
    } else if (sub.includes(lower)) {
      // Only the sublabel matched — less relevant but still show it.
      score = 10;
    } else {
      continue; // no match
    }

    ranked.push({ entry, score });
  }

  // Stable sort descending by score (Array.sort is stable in ES2019+).
  ranked.sort((a, b) => b.score - a.score);

  return ranked.slice(0, MAX_RESULTS).map((r) => r.entry);
}
