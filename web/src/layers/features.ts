// Data access for the AUTHORED feature layers.
//
// Loads factions, locations, routes, and territories from Supabase and shapes
// them into GeoJSON FeatureCollections the map can consume. Geometry comes from
// the *_geojson views (migration 0002). When no backend is configured, returns
// empty collections so the app still runs as a viewer.

import type {
  Feature,
  FeatureCollection,
  Geometry,
  GeoJsonProperties,
  Point,
  Polygon,
  LineString,
  MultiPolygon,
} from "geojson";
import { getSupabase } from "../state/supabase";
import type { Faction, LocationGeo, RouteGeo, TerritoryGeo, Note } from "../state/db-types";

export interface FeatureData {
  factions: Map<string, Faction>;
  locations: FeatureCollection<Point | Polygon, LocationProps>;
  routes: FeatureCollection<LineString, RouteProps>;
  territories: FeatureCollection<MultiPolygon, TerritoryProps>;
  /**
   * Full per-location detail keyed by id, for the wiki panel. Kept separate
   * from GeoJSON `properties` because MapLibre stringifies nested objects
   * (e.g. resource_overrides) when features round-trip through the map.
   */
  locationDetails: Map<string, LocationDetail>;
}

export interface LocationProps {
  id: string;
  name: string;
  oldWorldName: string | null;
  type: string;
  factionId: string | null;
  factionColor: string;
}

export interface LocationDetail {
  id: string;
  name: string;
  oldWorldName: string | null;
  type: string;
  factionId: string | null;
  factionName: string | null;
  factionColor: string;
  population: number | null;
  resources: Record<string, number>;
  lngLat: [number, number] | null;
}

export interface RouteProps {
  id: string;
  kind: RouteGeo["kind"];
  status: RouteGeo["status"];
  ownerFactionId: string | null;
  ownerColor: string;
  purpose: string | null;
}

export interface TerritoryProps {
  id: string;
  factionId: string;
  factionColor: string;
}

const NEUTRAL = "#888888";

function emptyFC<G extends Geometry, P extends GeoJsonProperties>(): FeatureCollection<G, P> {
  return { type: "FeatureCollection", features: [] };
}

/** Normalize the resource_overrides jsonb into a flat number map. */
function coerceResources(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    }
  }
  return out;
}

/** Load all authored feature layers. Empty collections when offline. */
export async function loadFeatures(): Promise<FeatureData> {
  const sb = getSupabase();
  const factions = new Map<string, Faction>();
  const data: FeatureData = {
    factions,
    locations: emptyFC<Point | Polygon, LocationProps>(),
    routes: emptyFC<LineString, RouteProps>(),
    territories: emptyFC<MultiPolygon, TerritoryProps>(),
    locationDetails: new Map<string, LocationDetail>(),
  };
  if (!sb) return data;

  const [factionsRes, locationsRes, routesRes, territoriesRes] = await Promise.all([
    sb.from("factions").select("*"),
    sb.from("locations_geojson").select("*"),
    sb.from("routes_geojson").select("*"),
    sb.from("territories_geojson").select("*"),
  ]);

  for (const res of [factionsRes, locationsRes, routesRes, territoriesRes]) {
    if (res.error) throw new Error(`Supabase load failed: ${res.error.message}`);
  }

  for (const f of (factionsRes.data ?? []) as Faction[]) factions.set(f.id, f);
  const colorOf = (id: string | null): string =>
    (id && factions.get(id)?.color) || NEUTRAL;
  const nameOf = (id: string | null): string | null =>
    (id && factions.get(id)?.name) || null;

  data.locations.features = ((locationsRes.data ?? []) as LocationGeo[]).map(
    (r): Feature<Point | Polygon, LocationProps> => {
      data.locationDetails.set(r.id, {
        id: r.id,
        name: r.name,
        oldWorldName: r.old_world_name,
        type: r.type,
        factionId: r.faction_id,
        factionName: nameOf(r.faction_id),
        factionColor: colorOf(r.faction_id),
        population: r.population,
        resources: coerceResources(r.resource_overrides),
        lngLat: r.geometry.type === "Point"
          ? [r.geometry.coordinates[0], r.geometry.coordinates[1]]
          : null,
      });
      return {
        type: "Feature",
        id: r.id,
        geometry: r.geometry,
        properties: {
          id: r.id,
          name: r.name,
          oldWorldName: r.old_world_name,
          type: r.type,
          factionId: r.faction_id,
          factionColor: colorOf(r.faction_id),
        },
      };
    },
  );

  data.routes.features = ((routesRes.data ?? []) as RouteGeo[]).map(
    (r): Feature<LineString, RouteProps> => ({
      type: "Feature",
      id: r.id,
      geometry: r.geometry,
      properties: {
        id: r.id,
        kind: r.kind,
        status: r.status,
        ownerFactionId: r.owner_faction_id,
        ownerColor: colorOf(r.owner_faction_id),
        purpose: r.purpose,
      },
    }),
  );

  data.territories.features = ((territoriesRes.data ?? []) as TerritoryGeo[]).map(
    (r): Feature<MultiPolygon, TerritoryProps> => ({
      type: "Feature",
      id: r.id,
      geometry: r.geometry,
      properties: {
        id: r.id,
        factionId: r.faction_id,
        factionColor: colorOf(r.faction_id),
      },
    }),
  );

  return data;
}

// --- Writes (authored edits) ------------------------------------------------
// Geometry inserts/updates go through RPCs (migration 0004) because PostgREST
// can't convert GeoJSON to PostGIS directly. Deletes use plain PostgREST.
// All return/throw; callers reload via loadFeatures() to refresh derived state.

export type EditableLayer = "location" | "route" | "territory";

/** True when writes are possible (a backend is configured). */
export { hasBackend } from "../state/supabase";

async function rpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const sb = getSupabase();
  if (!sb) throw new Error("No backend configured — editing is unavailable.");
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(`${fn} failed: ${error.message}`);
  return data;
}

export function createLocation(
  geometry: Point,
  name: string,
  opts: { oldWorldName?: string; type?: string; factionId?: string } = {},
): Promise<unknown> {
  return rpc("create_location", {
    geometry,
    name,
    old_world_name: opts.oldWorldName ?? null,
    type: opts.type ?? "settlement",
    faction_id: opts.factionId ?? null,
  });
}

export function createRoute(
  geometry: LineString,
  opts: { kind?: string; status?: string; ownerFactionId?: string; purpose?: string } = {},
): Promise<unknown> {
  return rpc("create_route", {
    geometry,
    kind: opts.kind ?? "road",
    status: opts.status ?? "intact",
    owner_faction_id: opts.ownerFactionId ?? null,
    purpose: opts.purpose ?? null,
  });
}

export function createTerritory(geometry: Polygon, factionId: string): Promise<unknown> {
  return rpc("create_territory", { geometry, faction_id: factionId });
}

const GEOM_RPC: Record<EditableLayer, string> = {
  location: "update_location_geometry",
  route: "update_route_geometry",
  territory: "update_territory_geometry",
};

export function updateGeometry(
  layer: EditableLayer,
  id: string,
  geometry: Point | LineString | Polygon,
): Promise<unknown> {
  return rpc(GEOM_RPC[layer], { id, geometry });
}

const TABLE: Record<EditableLayer, string> = {
  location: "locations",
  route: "routes",
  territory: "territories",
};

export async function deleteFeature(layer: EditableLayer, id: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("No backend configured — editing is unavailable.");
  const { error } = await sb.from(TABLE[layer]).delete().eq("id", id);
  if (error) throw new Error(`delete ${layer} failed: ${error.message}`);
}

// --- Notes (the wiki's annotations) -----------------------------------------

/** Load notes attached to a given feature (e.g. a location), newest first. */
export async function loadNotesFor(
  targetType: string,
  targetId: string,
): Promise<Note[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("notes")
    .select("*")
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`load notes failed: ${error.message}`);
  return (data ?? []) as Note[];
}

/** Add a note to a feature. Returns the created row. */
export async function addNote(
  targetType: string,
  targetId: string,
  body: string,
  tags: string[] = [],
): Promise<Note> {
  const sb = getSupabase();
  if (!sb) throw new Error("No backend configured — notes are unavailable.");
  const { data, error } = await sb
    .from("notes")
    .insert({ target_type: targetType, target_id: targetId, body, tags })
    .select()
    .single();
  if (error) throw new Error(`add note failed: ${error.message}`);
  return data as Note;
}

export async function deleteNote(id: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("No backend configured — notes are unavailable.");
  const { error } = await sb.from("notes").delete().eq("id", id);
  if (error) throw new Error(`delete note failed: ${error.message}`);
}

/** Update scalar location fields (population, names, type) via PostgREST. */
export async function updateLocationFields(
  id: string,
  fields: Partial<{ name: string; old_world_name: string | null; type: string; population: number | null }>,
): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("No backend configured — editing is unavailable.");
  const { error } = await sb.from("locations").update(fields).eq("id", id);
  if (error) throw new Error(`update location failed: ${error.message}`);
}
