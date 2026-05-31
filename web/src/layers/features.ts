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
import type {
  Faction,
  LocationGeo,
  RouteGeo,
  TerritoryGeo,
  TerrainRegionGeo,
  RouteBreakGeo,
  RouteGroup,
  RouteGroupMember,
  WorldSettingsGeo,
  Note,
} from "../state/db-types";

export interface FeatureData {
  factions: Map<string, Faction>;
  locations: FeatureCollection<Point | Polygon, LocationProps>;
  routes: FeatureCollection<LineString, RouteProps>;
  territories: FeatureCollection<MultiPolygon, TerritoryProps>;
  terrain: FeatureCollection<MultiPolygon, TerrainProps>;
  /** Break markers (points on routes) for rendering, styled by kind. */
  breaks: FeatureCollection<Point, BreakProps>;
  /** All break rows, for the route panel's per-route break list. */
  routeBreaks: RouteBreakGeo[];
  /** Named corridors and their members (many-to-many). */
  routeGroups: RouteGroup[];
  groupMembers: RouteGroupMember[];
  /**
   * Full per-location detail keyed by id, for the wiki panel. Kept separate
   * from GeoJSON `properties` because MapLibre stringifies nested objects
   * (e.g. resource_overrides) when features round-trip through the map.
   */
  locationDetails: Map<string, LocationDetail>;
  /** Full terrain rows (all physical-input fields), for the derived layer. */
  terrainRegions: TerrainRegionGeo[];
  /** Global climate/energy inputs, or null when none/offline. */
  worldSettings: WorldSettingsGeo | null;
}

export interface TerrainProps {
  id: string;
  name: string | null;
  landCover: string | null;
  elevationM: number | null;
  soilFertility: number | null;
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
  routeClass: RouteGeo["route_class"];
  ownerFactionId: string | null;
  ownerColor: string;
  purpose: string | null;
}

export interface BreakProps {
  id: string;
  routeId: string;
  kind: RouteBreakGeo["kind"];
  active: boolean;
  label: string | null;
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
    terrain: emptyFC<MultiPolygon, TerrainProps>(),
    breaks: emptyFC<Point, BreakProps>(),
    routeBreaks: [],
    routeGroups: [],
    groupMembers: [],
    locationDetails: new Map<string, LocationDetail>(),
    terrainRegions: [],
    worldSettings: null,
  };
  if (!sb) return data;

  const [factionsRes, locationsRes, routesRes, territoriesRes, terrainRes, breaksRes, groupsRes, membersRes, worldRes] =
    await Promise.all([
      sb.from("factions").select("*"),
      sb.from("locations_geojson").select("*"),
      sb.from("routes_geojson").select("*"),
      sb.from("territories_geojson").select("*"),
      sb.from("terrain_regions_geojson").select("*"),
      sb.from("route_breaks_geojson").select("*"),
      sb.from("route_groups").select("*"),
      sb.from("route_group_members").select("*"),
      sb.from("world_settings_geojson").select("*").limit(1).maybeSingle(),
    ]);

  for (const res of [factionsRes, locationsRes, routesRes, territoriesRes, terrainRes, breaksRes, groupsRes, membersRes]) {
    if (res.error) throw new Error(`Supabase load failed: ${res.error.message}`);
  }
  data.worldSettings = (worldRes.data as WorldSettingsGeo | null) ?? null;
  data.routeGroups = (groupsRes.data ?? []) as RouteGroup[];
  data.groupMembers = (membersRes.data ?? []) as RouteGroupMember[];

  // Breaks are annotations on routes (markers); they do not close the route.
  data.routeBreaks = (breaksRes.data ?? []) as RouteBreakGeo[];
  data.breaks.features = data.routeBreaks.map((b) => ({
    type: "Feature",
    id: b.id,
    geometry: b.geometry,
    properties: { id: b.id, routeId: b.route_id, kind: b.kind, active: b.active, label: b.label },
  }));

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
        routeClass: r.route_class,
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

  data.terrainRegions = (terrainRes.data ?? []) as TerrainRegionGeo[];
  data.terrain.features = data.terrainRegions.map(
    (r): Feature<MultiPolygon, TerrainProps> => ({
      type: "Feature",
      id: r.id,
      geometry: r.geometry,
      properties: {
        id: r.id,
        name: r.name,
        landCover: r.land_cover,
        elevationM: r.elevation_m,
        soilFertility: r.soil_fertility,
      },
    }),
  );

  return data;
}

// --- Writes (authored edits) ------------------------------------------------
// Geometry inserts/updates go through RPCs (migration 0004) because PostgREST
// can't convert GeoJSON to PostGIS directly. Deletes use plain PostgREST.
// All return/throw; callers reload via loadFeatures() to refresh derived state.

export type EditableLayer = "location" | "route" | "territory" | "terrain";

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

// --- Route breaks -----------------------------------------------------------

/** Place a break on a route at a clicked point (snapped onto the line server-side). */
export function addRouteBreak(
  routeId: string,
  clickPoint: Point,
  kind: string,
  label?: string,
): Promise<unknown> {
  return rpc("add_route_break", {
    route_id: routeId,
    click: clickPoint,
    kind,
    label: label ?? null,
  });
}

/** Lift/restore a break without deleting it. */
export async function setRouteBreakActive(id: string, active: boolean): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("No backend configured — editing is unavailable.");
  const { error } = await sb.from("route_breaks").update({ active }).eq("id", id);
  if (error) throw new Error(`update break failed: ${error.message}`);
}

export async function deleteRouteBreak(id: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("No backend configured — editing is unavailable.");
  const { error } = await sb.from("route_breaks").delete().eq("id", id);
  if (error) throw new Error(`delete break failed: ${error.message}`);
}

/** Assign (or clear) the faction that controls a blockade/toll. */
export async function setRouteBreakFaction(id: string, factionId: string | null): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("No backend configured — editing is unavailable.");
  const { error } = await sb.from("route_breaks").update({ faction_id: factionId }).eq("id", id);
  if (error) throw new Error(`update break failed: ${error.message}`);
}

// --- Route groups (corridors) -----------------------------------------------

/** Create a corridor and attach the given member routes. Returns the new id. */
export async function createRouteGroup(
  name: string,
  routeIds: string[],
  labels: string[] = [],
): Promise<string> {
  const sb = getSupabase();
  if (!sb) throw new Error("No backend configured — editing is unavailable.");
  const { data, error } = await sb
    .from("route_groups")
    .insert({ name, labels })
    .select("id")
    .single();
  if (error) throw new Error(`create corridor failed: ${error.message}`);
  const groupId = (data as { id: string }).id;
  if (routeIds.length) {
    const rows = routeIds.map((route_id) => ({ group_id: groupId, route_id }));
    const { error: mErr } = await sb.from("route_group_members").insert(rows);
    if (mErr) throw new Error(`add corridor members failed: ${mErr.message}`);
  }
  return groupId;
}

export async function updateRouteGroup(
  id: string,
  fields: Partial<{ name: string; labels: string[] }>,
): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("No backend configured — editing is unavailable.");
  const { error } = await sb.from("route_groups").update(fields).eq("id", id);
  if (error) throw new Error(`update corridor failed: ${error.message}`);
}

export async function deleteRouteGroup(id: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("No backend configured — editing is unavailable.");
  const { error } = await sb.from("route_groups").delete().eq("id", id);
  if (error) throw new Error(`delete corridor failed: ${error.message}`);
}

export async function addRouteGroupMember(groupId: string, routeId: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("No backend configured — editing is unavailable.");
  const { error } = await sb
    .from("route_group_members")
    .upsert({ group_id: groupId, route_id: routeId });
  if (error) throw new Error(`add member failed: ${error.message}`);
}

export async function removeRouteGroupMember(groupId: string, routeId: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("No backend configured — editing is unavailable.");
  const { error } = await sb
    .from("route_group_members")
    .delete()
    .eq("group_id", groupId)
    .eq("route_id", routeId);
  if (error) throw new Error(`remove member failed: ${error.message}`);
}

/** Update a route's scalar fields (class, status, kind, purpose). Geometry edits
 *  still go through the RPC; these are plain column updates. */
export async function updateRouteFields(
  id: string,
  fields: Partial<{
    kind: string;
    status: string;
    route_class: string;
    purpose: string | null;
    owner_faction_id: string | null;
  }>,
): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("No backend configured — editing is unavailable.");
  const { error } = await sb.from("routes").update(fields).eq("id", id);
  if (error) throw new Error(`update route failed: ${error.message}`);
}

export function createTerrainRegion(
  geometry: Polygon | MultiPolygon,
  opts: { name?: string; attributes?: Record<string, unknown> } = {},
): Promise<unknown> {
  return rpc("create_terrain_region", {
    geometry,
    name: opts.name ?? null,
    attributes: opts.attributes ?? {},
  });
}

const GEOM_RPC: Record<EditableLayer, string> = {
  location: "update_location_geometry",
  route: "update_route_geometry",
  territory: "update_territory_geometry",
  terrain: "update_terrain_region_geometry",
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
  terrain: "terrain_regions",
};

/** Physical-input fields editable on a terrain region (scalar — plain UPDATE). */
export interface TerrainFields {
  name: string | null;
  elevation_m: number | null;
  slope_deg: number | null;
  aspect_deg: number | null;
  land_cover: string | null;
  soil_fertility: number | null;
  soil_drainage: string | null;
  surface_water: number | null;
  wind_exposure: number | null;
  solar_exposure: number | null;
}

/**
 * Update a terrain region's authored physical inputs. These cascade: elevation
 * feeds the derived temperature field; land cover / soil / water feed crop
 * suitability. Callers must reload + recompute the climate layer after this.
 */
export async function updateTerrainFields(
  id: string,
  fields: Partial<TerrainFields>,
): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("No backend configured — editing is unavailable.");
  const { error } = await sb.from("terrain_regions").update(fields).eq("id", id);
  if (error) throw new Error(`update terrain failed: ${error.message}`);
}

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

/** Update world_settings scalar climate inputs (season, temps, pole numbers). */
export async function updateWorldSettings(
  id: string,
  fields: Partial<{
    season: number;
    global_temp_offset: number;
    axial_tilt_deg: number;
    sea_level_m: number;
    equator_temp_c: number;
    pole_temp_c: number;
    lapse_rate_c_per_km: number;
    prevailing_wind_deg: number;
  }>,
): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("No backend configured — editing is unavailable.");
  const { error } = await sb.from("world_settings").update(fields).eq("id", id);
  if (error) throw new Error(`update world settings failed: ${error.message}`);
}

/** Replace a location's resource_overrides (pinned derived values). */
export async function updateLocationResources(
  id: string,
  resources: Record<string, number>,
): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("No backend configured — editing is unavailable.");
  const { error } = await sb
    .from("locations")
    .update({ resource_overrides: resources })
    .eq("id", id);
  if (error) throw new Error(`update resources failed: ${error.message}`);
}
