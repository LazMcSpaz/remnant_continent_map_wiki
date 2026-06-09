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
import type { ElevationEdit } from "../derived/terrain";
import type { SurfaceEdit } from "../derived/surface-brush";
import type {
  Faction,
  FactionRelation,
  FactionTier,
  RelationLevel,
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

/** An authored narrative event on the world timeline (migration 0020). */
export interface ChronicleEvent {
  id: string;
  year: number;
  title: string;
  body: string | undefined;
  targetType: string | undefined;
  targetId: string | undefined;
  tags: string[];
}

export interface FeatureData {
  factions: Map<string, Faction>;
  /** Pairwise faction stance rows (allies/friendly/tense/hostile). */
  factionRelations: FactionRelation[];
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
  /** Persisted terrain-brush elevation edits (soft Gaussian deltas). */
  elevationEdits: ElevationEdit[];
  /** Persisted surface/decay brush edits (painted surface polygons). */
  surfaceEdits: SurfaceEdit[];
  /** Authored narrative timeline events. */
  chronicleEvents: ChronicleEvent[];
}

export type { SurfaceEdit };

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
  /** Authored 1..10 tech level for this city (scales production). */
  techLevel: number;
  /** Authored influence for this city (summed into the faction's). */
  influence: number;
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
    factionRelations: [],
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
    elevationEdits: [],
    surfaceEdits: [],
    chronicleEvents: [],
  };
  if (!sb) return data;

  const [factionsRes, relationsRes, locationsRes, routesRes, territoriesRes, terrainRes, breaksRes, groupsRes, membersRes, worldRes, editsRes, surfaceEditsRes, chronicleRes] =
    await Promise.all([
      sb.from("factions").select("*"),
      sb.from("faction_relations").select("*"),
      sb.from("locations_geojson").select("*"),
      sb.from("routes_geojson").select("*"),
      sb.from("territories_geojson").select("*"),
      sb.from("terrain_regions_geojson").select("*"),
      sb.from("route_breaks_geojson").select("*"),
      sb.from("route_groups").select("*"),
      sb.from("route_group_members").select("*"),
      sb.from("world_settings_geojson").select("*").limit(1).maybeSingle(),
      sb.from("elevation_edits_geojson").select("*"),
      sb.from("surface_edits_geojson").select("*"),
      sb.from("chronicle_events").select("*").order("year", { ascending: true }),
    ]);

  for (const res of [factionsRes, relationsRes, locationsRes, routesRes, territoriesRes, terrainRes, breaksRes, groupsRes, membersRes]) {
    if (res.error) throw new Error(`Supabase load failed: ${res.error.message}`);
  }
  data.worldSettings = (worldRes.data as WorldSettingsGeo | null) ?? null;
  // Chronicle events: map snake_case DB columns to camelCase interface fields.
  data.chronicleEvents = ((chronicleRes.data ?? []) as Array<{
    id: string;
    year: number;
    title: string;
    body: string | null;
    target_type: string | null;
    target_id: string | null;
    tags: string[];
  }>).map((r) => ({
    id: r.id,
    year: r.year,
    title: r.title,
    body: r.body ?? undefined,
    targetType: r.target_type ?? undefined,
    targetId: r.target_id ?? undefined,
    tags: r.tags,
  }));
  data.factionRelations = (relationsRes.data ?? []) as FactionRelation[];
  // Terrain-brush edits: payload carries the brush params (lng/lat/radius/delta).
  data.elevationEdits = ((editsRes.data ?? []) as Array<{ id: string; payload: Record<string, number> }>).map(
    (r) => ({
      id: r.id,
      lng: r.payload.lng,
      lat: r.payload.lat,
      radiusKm: r.payload.radiusKm,
      deltaM: r.payload.deltaM,
    }),
  );
  // Surface/decay brush edits: payload carries brush params (lng/lat/radiusKm).
  data.surfaceEdits = ((surfaceEditsRes.data ?? []) as Array<{ id: string; surface: string; payload: Record<string, number> }>).map(
    (r) => ({
      id: r.id,
      surface: r.surface as SurfaceEdit["surface"],
      lng: r.payload.lng,
      lat: r.payload.lat,
      radiusKm: r.payload.radiusKm,
    }),
  );
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
        techLevel: r.tech_level ?? 5,
        influence: r.influence ?? 0,
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

// --- Terrain-brush elevation edits ------------------------------------------

const KM_PER_DEG_LAT = 111.32;

/** Circle polygon (GeoJSON) approximating a brush footprint, for the geom col. */
function brushFootprint(edit: ElevationEdit, steps = 32): Polygon {
  const kmPerDegLng = KM_PER_DEG_LAT * Math.cos((edit.lat * Math.PI) / 180);
  const ring: number[][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    ring.push([
      edit.lng + (Math.cos(a) * edit.radiusKm) / kmPerDegLng,
      edit.lat + (Math.sin(a) * edit.radiusKm) / KM_PER_DEG_LAT,
    ]);
  }
  return { type: "Polygon", coordinates: [ring] };
}

/** Persist one brush edit; returns its new server id. */
export async function createElevationEdit(edit: ElevationEdit): Promise<string> {
  const id = await rpc("create_elevation_edit", {
    geometry: brushFootprint(edit),
    radius_km: edit.radiusKm,
    delta_m: edit.deltaM,
    center_lng: edit.lng,
    center_lat: edit.lat,
  });
  return id as string;
}

/** Delete one persisted brush edit by id. */
export async function deleteElevationEdit(id: string): Promise<void> {
  await rpc("delete_elevation_edit", { id });
}

// --- Surface/decay brush edits ----------------------------------------------

const KM_PER_DEG_LAT_SURF = 111.32;

/** Circle polygon (GeoJSON) approximating a surface-brush footprint. */
function surfaceFootprint(edit: SurfaceEdit, steps = 32): Polygon {
  const kmPerDegLng = KM_PER_DEG_LAT_SURF * Math.cos((edit.lat * Math.PI) / 180);
  const ring: number[][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    ring.push([
      edit.lng + (Math.cos(a) * edit.radiusKm) / kmPerDegLng,
      edit.lat + (Math.sin(a) * edit.radiusKm) / KM_PER_DEG_LAT_SURF,
    ]);
  }
  return { type: "Polygon", coordinates: [ring] };
}

/** Persist one surface edit; returns its new server id. */
export async function createSurfaceEdit(edit: SurfaceEdit): Promise<string> {
  const id = await rpc("create_surface_edit", {
    geometry: surfaceFootprint(edit),
    surface: edit.surface,
    payload: { lng: edit.lng, lat: edit.lat, radiusKm: edit.radiusKm },
  });
  return id as string;
}

/** Delete one persisted surface edit by id. */
export async function deleteSurfaceEdit(id: string): Promise<void> {
  await rpc("delete_surface_edit", { id });
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
  fields: Partial<{
    name: string;
    old_world_name: string | null;
    type: string;
    population: number | null;
    faction_id: string | null;
    tech_level: number;
    influence: number;
  }>,
): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("No backend configured — editing is unavailable.");
  const { error } = await sb.from("locations").update(fields).eq("id", id);
  if (error) throw new Error(`update location failed: ${error.message}`);
}

/** Update authored faction fields (name, color, tier). Tech/influence are
 *  derived from the faction's cities, not stored here. */
export async function updateFaction(
  id: string,
  fields: Partial<{ name: string; color: string; tier: FactionTier }>,
): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("No backend configured — editing is unavailable.");
  const { error } = await sb.from("factions").update(fields).eq("id", id);
  if (error) throw new Error(`update faction failed: ${error.message}`);
}

/** Create a faction (major or minor) and return its new id. Picks a random
 *  pleasant color when none is given. */
export async function createFaction(
  name: string,
  tier: FactionTier,
  color?: string,
): Promise<string> {
  const sb = getSupabase();
  if (!sb) throw new Error("No backend configured — editing is unavailable.");
  const c = color ?? randomFactionColor();
  const { data, error } = await sb
    .from("factions")
    .insert({ name, tier, color: c })
    .select("id")
    .single();
  if (error) throw new Error(`create faction failed: ${error.message}`);
  return (data as { id: string }).id;
}

/** Assign (or clear) the faction that a city belongs to. */
export async function setLocationFaction(locationId: string, factionId: string | null): Promise<void> {
  return updateLocationFields(locationId, { faction_id: factionId });
}

const FACTION_PALETTE = [
  "#6ea8fe", "#e0af68", "#7dcd85", "#e06a8a", "#b48ce0",
  "#5fc4c4", "#e08a4a", "#9bab57", "#d28ac4", "#7d9b4e",
];
function randomFactionColor(): string {
  return FACTION_PALETTE[Math.floor(Math.random() * FACTION_PALETTE.length)];
}

/**
 * Set the stance between two factions. Relations are symmetric and stored once
 * per unordered pair (faction_a < faction_b), so we canonicalize the ids and
 * upsert. Setting "friendly" (the default) deletes the row to keep the table
 * sparse — absence means the baseline friendly stance.
 */
export async function setFactionRelation(
  factionX: string,
  factionY: string,
  level: RelationLevel,
): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("No backend configured — editing is unavailable.");
  if (factionX === factionY) throw new Error("A faction has no relation to itself.");
  const [a, b] = factionX < factionY ? [factionX, factionY] : [factionY, factionX];
  if (level === "friendly") {
    const { error } = await sb.from("faction_relations").delete().eq("faction_a", a).eq("faction_b", b);
    if (error) throw new Error(`clear relation failed: ${error.message}`);
    return;
  }
  const { error } = await sb
    .from("faction_relations")
    .upsert({ faction_a: a, faction_b: b, level }, { onConflict: "faction_a,faction_b" });
  if (error) throw new Error(`set relation failed: ${error.message}`);
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

// --- Chronicle events --------------------------------------------------------

/** Insert a new chronicle event; returns the created row (with server-assigned id). */
export async function addChronicleEvent(
  event: Omit<ChronicleEvent, "id">,
): Promise<ChronicleEvent> {
  const sb = getSupabase();
  if (!sb) throw new Error("No backend configured — chronicle is unavailable.");
  const { data, error } = await sb
    .from("chronicle_events")
    .insert({
      year: event.year,
      title: event.title,
      body: event.body ?? null,
      target_type: event.targetType ?? null,
      target_id: event.targetId ?? null,
      tags: event.tags,
    })
    .select()
    .single();
  if (error) throw new Error(`add chronicle event failed: ${error.message}`);
  const r = data as {
    id: string; year: number; title: string; body: string | null;
    target_type: string | null; target_id: string | null; tags: string[];
  };
  return {
    id: r.id,
    year: r.year,
    title: r.title,
    body: r.body ?? undefined,
    targetType: r.target_type ?? undefined,
    targetId: r.target_id ?? undefined,
    tags: r.tags,
  };
}

/** Update scalar fields of an existing chronicle event. */
export async function updateChronicleEvent(
  id: string,
  fields: Partial<{
    year: number;
    title: string;
    body: string | null;
    target_type: string | null;
    target_id: string | null;
    tags: string[];
  }>,
): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("No backend configured — chronicle is unavailable.");
  const { error } = await sb.from("chronicle_events").update(fields).eq("id", id);
  if (error) throw new Error(`update chronicle event failed: ${error.message}`);
}

/** Delete a chronicle event by id. */
export async function deleteChronicleEvent(id: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("No backend configured — chronicle is unavailable.");
  const { error } = await sb.from("chronicle_events").delete().eq("id", id);
  if (error) throw new Error(`delete chronicle event failed: ${error.message}`);
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
