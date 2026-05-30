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
import type { Faction, LocationGeo, RouteGeo, TerritoryGeo } from "../state/db-types";

export interface FeatureData {
  factions: Map<string, Faction>;
  locations: FeatureCollection<Point | Polygon, LocationProps>;
  routes: FeatureCollection<LineString, RouteProps>;
  territories: FeatureCollection<MultiPolygon, TerritoryProps>;
}

export interface LocationProps {
  id: string;
  name: string;
  oldWorldName: string | null;
  type: string;
  factionId: string | null;
  factionColor: string;
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

/** Load all authored feature layers. Empty collections when offline. */
export async function loadFeatures(): Promise<FeatureData> {
  const sb = getSupabase();
  const factions = new Map<string, Faction>();
  const data: FeatureData = {
    factions,
    locations: emptyFC<Point | Polygon, LocationProps>(),
    routes: emptyFC<LineString, RouteProps>(),
    territories: emptyFC<MultiPolygon, TerritoryProps>(),
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

  data.locations.features = ((locationsRes.data ?? []) as LocationGeo[]).map(
    (r): Feature<Point | Polygon, LocationProps> => ({
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
    }),
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
