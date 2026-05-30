// Database row types for the AUTHORED layer.
//
// Hand-maintained to mirror supabase/migrations/0001_init_authored_schema.sql.
// (Supabase can auto-generate a full `Database` type, but it also emits the
// entire PostGIS function surface — hundreds of entries we don't use. This keeps
// the typed contract to our own tables. Regenerate/verify with the Supabase
// `generate_typescript_types` tool after any schema migration.)
//
// `geom` columns are GeoJSON geometry over the wire (PostgREST returns them as
// GeoJSON when selected via the REST API with the right cast, or we transform in
// the data layer). Typed loosely here as GeoJSON; the layers/ modules narrow it.

import type {
  Geometry,
  Point,
  LineString,
  MultiPolygon,
  Polygon,
} from "geojson";

export type Uuid = string;
export type Timestamptz = string;
export type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

export type RouteKind = "rail" | "road" | "trail";
export type RouteStatus = "intact" | "damaged" | "destroyed";
export type SurfaceKind = "water" | "forest";
export type SurfaceOp = "add" | "remove";

interface Timestamps {
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export interface Faction extends Timestamps {
  id: Uuid;
  name: string;
  color: string;
}

export interface TravelMode extends Timestamps {
  id: Uuid;
  label: string;
  speed_kph: number;
}

export interface Location extends Timestamps {
  id: Uuid;
  geom: Point | Polygon;
  name: string;
  old_world_name: string | null;
  type: string;
  faction_id: Uuid | null;
  resource_overrides: Json;
}

export interface Route extends Timestamps {
  id: Uuid;
  geom: LineString;
  kind: RouteKind;
  owner_faction_id: Uuid | null;
  status: RouteStatus;
  mode_ids: Uuid[];
  purpose: string | null;
}

export interface Territory extends Timestamps {
  id: Uuid;
  geom: MultiPolygon;
  faction_id: Uuid;
  style: Json;
}

export interface WorldSettings extends Timestamps {
  id: Uuid;
  pole_geom: Point | null;
  season: number;
  global_temp_offset: number;
}

export interface ElevationEdit extends Timestamps {
  id: Uuid;
  geom: Polygon;
  payload: Json;
}

export interface SurfaceEdit extends Timestamps {
  id: Uuid;
  geom: Polygon;
  surface: SurfaceKind;
  operation: SurfaceOp;
  payload: Json;
}

export interface DecayMask extends Timestamps {
  id: Uuid;
  geom: Polygon;
  level: number;
  payload: Json;
}

export interface Note extends Timestamps {
  id: Uuid;
  target_type: string;
  target_id: Uuid | null;
  geom: Geometry | null;
  body: string;
  tags: string[];
  links: string[];
}

// --- GeoJSON view rows (migration 0002) ------------------------------------
// These *_geojson views expose `geom` as GeoJSON jsonb so PostgREST returns
// usable geometry instead of WKB hex. One row per feature.

export interface LocationGeo {
  id: Uuid;
  geometry: Point | Polygon;
  name: string;
  old_world_name: string | null;
  type: string;
  faction_id: Uuid | null;
  population: number | null;
  resource_overrides: Json;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export interface RouteGeo {
  id: Uuid;
  geometry: LineString;
  kind: RouteKind;
  owner_faction_id: Uuid | null;
  status: RouteStatus;
  mode_ids: Uuid[];
  purpose: string | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export interface TerritoryGeo {
  id: Uuid;
  geometry: MultiPolygon;
  faction_id: Uuid;
  style: Json;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}
