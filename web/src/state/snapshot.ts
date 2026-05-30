// Save / load + import / export for the AUTHORED layer.
//
// The interchange format (per the README) is one JSON bundle: a GeoJSON
// FeatureCollection for the spatial features plus a state blob for the
// non-spatial authored data (factions, travel modes, world settings, notes).
// This is the unit of export, versioning, and sharing.
//
// Only the AUTHORED layer is serialized. Derived values (network graph, travel
// times) are recomputed on load and never stored; simulated state (Phase 4) is
// out of scope here. Importing rebuilds the authored layer, after which the
// derived cascade recomputes as normal.

import type { Feature, FeatureCollection, Geometry, Point, LineString, Polygon } from "geojson";
import { getSupabase } from "./supabase";
import type { Faction, TravelMode, Note } from "./db-types";
import {
  createLocation,
  createRoute,
  createTerritory,
  createTerrainRegion,
  updateLocationFields,
  updateLocationResources,
  addNote,
} from "../layers/features";

export const SNAPSHOT_VERSION = 1;
export const SNAPSHOT_KIND = "remnant-continent-atlas/authored";

export interface WorldSettingsExport {
  pole: Point | null;
  season: number;
  globalTempOffset: number;
}

/** The full authored-layer bundle. `features` carries one layer per feature
 *  via the `rcLayer` property so a single FeatureCollection round-trips. */
export interface Snapshot {
  kind: typeof SNAPSHOT_KIND;
  version: number;
  exportedAt: string;
  features: FeatureCollection<Geometry, Record<string, unknown>>;
  factions: Array<Pick<Faction, "id" | "name" | "color">>;
  travelModes: Array<Pick<TravelMode, "id" | "label" | "speed_kph">>;
  worldSettings: WorldSettingsExport | null;
  notes: Array<Pick<Note, "target_type" | "target_id" | "body" | "tags" | "links">>;
}

type RcLayer = "location" | "route" | "territory" | "terrain";

function feat(
  layer: RcLayer,
  id: string,
  geometry: Geometry,
  props: Record<string, unknown>,
): Feature<Geometry, Record<string, unknown>> {
  return { type: "Feature", id, geometry, properties: { rcLayer: layer, ...props } };
}

// --- Export -----------------------------------------------------------------

/** Read the entire authored layer into a serializable Snapshot. */
export async function exportSnapshot(): Promise<Snapshot> {
  const sb = getSupabase();
  if (!sb) throw new Error("No backend configured — nothing to export.");

  const [factions, travelModes, locs, routes, terrs, terrain, world, notes] = await Promise.all([
    sb.from("factions").select("id,name,color"),
    sb.from("travel_modes").select("id,label,speed_kph"),
    sb.from("locations_geojson").select("*"),
    sb.from("routes_geojson").select("*"),
    sb.from("territories_geojson").select("*"),
    sb.from("terrain_regions_geojson").select("*"),
    sb.from("world_settings_geojson").select("*").limit(1).maybeSingle(),
    sb.from("notes").select("target_type,target_id,body,tags,links"),
  ]);

  for (const r of [factions, travelModes, locs, routes, terrs, terrain, notes]) {
    if (r.error) throw new Error(`Export failed: ${r.error.message}`);
  }

  const features: Feature<Geometry, Record<string, unknown>>[] = [];
  for (const r of (locs.data ?? []) as Array<Record<string, unknown>>) {
    features.push(
      feat("location", r.id as string, r.geometry as Geometry, {
        name: r.name,
        old_world_name: r.old_world_name,
        type: r.type,
        faction_id: r.faction_id,
        population: r.population,
        resource_overrides: r.resource_overrides,
      }),
    );
  }
  for (const r of (routes.data ?? []) as Array<Record<string, unknown>>) {
    features.push(
      feat("route", r.id as string, r.geometry as Geometry, {
        kind: r.kind,
        status: r.status,
        owner_faction_id: r.owner_faction_id,
        purpose: r.purpose,
      }),
    );
  }
  for (const r of (terrs.data ?? []) as Array<Record<string, unknown>>) {
    features.push(
      feat("territory", r.id as string, r.geometry as Geometry, {
        faction_id: r.faction_id,
        style: r.style,
      }),
    );
  }
  for (const r of (terrain.data ?? []) as Array<Record<string, unknown>>) {
    // All physical attributes travel as properties so the area inputs survive
    // a round-trip; importer recreates geometry + name + attributes (others
    // are reattachable later, but kept here so nothing is silently dropped).
    const { id, geometry, created_at, updated_at, ...attrs } = r;
    void created_at;
    void updated_at;
    features.push(feat("terrain", id as string, geometry as Geometry, attrs));
  }

  const w = world.data as Record<string, unknown> | null;
  const worldSettings: WorldSettingsExport | null = w
    ? {
        pole: (w.pole_geometry as Point | null) ?? null,
        season: Number(w.season ?? 0),
        globalTempOffset: Number(w.global_temp_offset ?? 0),
      }
    : null;

  return {
    kind: SNAPSHOT_KIND,
    version: SNAPSHOT_VERSION,
    exportedAt: new Date().toISOString(),
    features: { type: "FeatureCollection", features },
    factions: (factions.data ?? []) as Snapshot["factions"],
    travelModes: (travelModes.data ?? []) as Snapshot["travelModes"],
    worldSettings,
    notes: (notes.data ?? []) as Snapshot["notes"],
  };
}

/** Export only the spatial features as plain GeoJSON (for other GIS tools). */
export async function exportGeoJSON(): Promise<FeatureCollection> {
  const snap = await exportSnapshot();
  return snap.features;
}

// --- Validation -------------------------------------------------------------

export function isSnapshot(value: unknown): value is Snapshot {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.kind === SNAPSHOT_KIND &&
    typeof v.version === "number" &&
    typeof v.features === "object" &&
    (v.features as FeatureCollection).type === "FeatureCollection"
  );
}

export interface ImportResult {
  factions: number;
  travelModes: number;
  locations: number;
  routes: number;
  territories: number;
  terrain: number;
  notes: number;
  errors: string[];
}

// --- Import (append) --------------------------------------------------------

/**
 * Write a snapshot's authored layer into the database (append). IDs are
 * remapped: factions and locations get fresh ids on insert, and references
 * (faction ownership, note targets) are rewritten to the new ids. Per-feature
 * failures are collected rather than aborting the whole import.
 */
export async function importSnapshot(snap: Snapshot): Promise<ImportResult> {
  const sb = getSupabase();
  if (!sb) throw new Error("No backend configured — cannot import.");
  if (snap.version > SNAPSHOT_VERSION) {
    throw new Error(`Snapshot version ${snap.version} is newer than supported (${SNAPSHOT_VERSION}).`);
  }

  const result: ImportResult = {
    factions: 0, travelModes: 0, locations: 0, routes: 0, territories: 0, terrain: 0, notes: 0, errors: [],
  };
  const factionIdMap = new Map<string, string>();
  const locationIdMap = new Map<string, string>();

  // Factions first (locations/routes/territories reference them).
  for (const f of snap.factions) {
    const { data, error } = await sb
      .from("factions")
      .insert({ name: f.name, color: f.color })
      .select("id")
      .single();
    if (error) result.errors.push(`faction "${f.name}": ${error.message}`);
    else {
      factionIdMap.set(f.id, (data as { id: string }).id);
      result.factions++;
    }
  }

  for (const m of snap.travelModes) {
    const { error } = await sb.from("travel_modes").insert({ label: m.label, speed_kph: m.speed_kph });
    if (error) result.errors.push(`travel mode "${m.label}": ${error.message}`);
    else result.travelModes++;
  }

  const remapFaction = (id: unknown): string | undefined => {
    if (typeof id !== "string") return undefined;
    return factionIdMap.get(id) ?? undefined;
  };

  for (const f of snap.features.features) {
    const props = f.properties ?? {};
    const layer = props.rcLayer as RcLayer | undefined;
    try {
      if (layer === "location" && f.geometry.type === "Point") {
        const factionId = remapFaction(props.faction_id);
        const newId = (await createLocation(f.geometry as Point, String(props.name ?? "Unnamed"), {
          ...(typeof props.old_world_name === "string" ? { oldWorldName: props.old_world_name } : {}),
          type: typeof props.type === "string" ? props.type : "settlement",
          ...(factionId ? { factionId } : {}),
        })) as string;
        if (typeof f.id === "string" && typeof newId === "string") locationIdMap.set(f.id, newId);
        // Population + resource overrides aren't part of create_location.
        const pop = props.population;
        if (typeof newId === "string" && typeof pop === "number") {
          await updateLocationFields(newId, { population: pop });
        }
        if (typeof newId === "string" && props.resource_overrides && typeof props.resource_overrides === "object") {
          await updateLocationResources(newId, props.resource_overrides as Record<string, number>);
        }
        result.locations++;
      } else if (layer === "route" && f.geometry.type === "LineString") {
        const ownerFactionId = remapFaction(props.owner_faction_id);
        await createRoute(f.geometry as LineString, {
          kind: typeof props.kind === "string" ? props.kind : "road",
          status: typeof props.status === "string" ? props.status : "intact",
          ...(ownerFactionId ? { ownerFactionId } : {}),
          ...(typeof props.purpose === "string" ? { purpose: props.purpose } : {}),
        });
        result.routes++;
      } else if (layer === "territory" && (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon")) {
        const factionId = remapFaction(props.faction_id);
        if (!factionId) {
          result.errors.push("territory skipped: its faction was not imported.");
          continue;
        }
        const poly = f.geometry.type === "MultiPolygon"
          ? ({ type: "Polygon", coordinates: f.geometry.coordinates[0] } as Polygon)
          : (f.geometry as Polygon);
        await createTerritory(poly, factionId);
        result.territories++;
      } else if (layer === "terrain" && (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon")) {
        // Recreate geometry + name + the full attribute set (the create RPC
        // takes only geometry/name/attributes; physical fields ride in the
        // jsonb `attributes` bag so nothing is dropped on round-trip).
        const { rcLayer, name, ...rest } = props;
        void rcLayer;
        await createTerrainRegion(f.geometry as Polygon, {
          ...(typeof name === "string" ? { name } : {}),
          attributes: rest,
        });
        result.terrain++;
      }
    } catch (err) {
      result.errors.push(`${layer ?? "feature"}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Notes, with target ids remapped to the newly-created locations. Only
  // location-targeted notes whose target was imported are re-attached; other
  // targets aren't created by this importer yet, so those notes are skipped.
  for (const n of snap.notes) {
    if (n.target_type !== "location" || typeof n.target_id !== "string") continue;
    const targetId = locationIdMap.get(n.target_id);
    if (!targetId) continue;
    try {
      await addNote("location", targetId, n.body, n.tags ?? []);
      result.notes++;
    } catch (err) {
      result.errors.push(`note: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}
