-- Migration: 0004_feature_write_rpcs
-- PostgREST cannot convert GeoJSON to PostGIS geometry on insert/update, so
-- editing writes go through these RPCs. Each takes a GeoJSON `geometry` (jsonb)
-- and converts server-side with ST_SetSRID(ST_GeomFromGeoJSON(...), 4326).
--
-- SECURITY INVOKER (default): RLS on the underlying tables still applies.
-- Deletes and scalar-only updates use plain PostgREST and need no RPC.

-- locations ------------------------------------------------------------------
create or replace function public.create_location(
  geometry jsonb,
  name text,
  old_world_name text default null,
  type text default 'settlement',
  faction_id uuid default null
) returns uuid
language sql
as $$
  insert into public.locations (geom, name, old_world_name, type, faction_id)
  values (
    st_setsrid(st_geomfromgeojson(geometry), 4326),
    name, old_world_name, type, faction_id
  )
  returning id;
$$;

create or replace function public.update_location_geometry(id uuid, geometry jsonb)
returns void
language sql
as $$
  update public.locations
  set geom = st_setsrid(st_geomfromgeojson(geometry), 4326)
  where locations.id = update_location_geometry.id;
$$;

-- routes ---------------------------------------------------------------------
create or replace function public.create_route(
  geometry jsonb,
  kind text default 'road',
  status text default 'intact',
  owner_faction_id uuid default null,
  purpose text default null
) returns uuid
language sql
as $$
  insert into public.routes (geom, kind, status, owner_faction_id, purpose)
  values (
    st_setsrid(st_geomfromgeojson(geometry), 4326)::geometry(LineString, 4326),
    kind, status, owner_faction_id, purpose
  )
  returning id;
$$;

create or replace function public.update_route_geometry(id uuid, geometry jsonb)
returns void
language sql
as $$
  update public.routes
  set geom = st_setsrid(st_geomfromgeojson(geometry), 4326)::geometry(LineString, 4326)
  where routes.id = update_route_geometry.id;
$$;

-- territories (Terra Draw yields Polygon; column is MultiPolygon → ST_Multi) --
create or replace function public.create_territory(
  geometry jsonb,
  faction_id uuid
) returns uuid
language sql
as $$
  insert into public.territories (geom, faction_id)
  values (
    st_multi(st_setsrid(st_geomfromgeojson(geometry), 4326))::geometry(MultiPolygon, 4326),
    faction_id
  )
  returning id;
$$;

create or replace function public.update_territory_geometry(id uuid, geometry jsonb)
returns void
language sql
as $$
  update public.territories
  set geom = st_multi(st_setsrid(st_geomfromgeojson(geometry), 4326))::geometry(MultiPolygon, 4326)
  where territories.id = update_territory_geometry.id;
$$;

-- Only signed-in users may write.
revoke execute on function
  public.create_location(jsonb, text, text, text, uuid),
  public.update_location_geometry(uuid, jsonb),
  public.create_route(jsonb, text, text, uuid, text),
  public.update_route_geometry(uuid, jsonb),
  public.create_territory(jsonb, uuid),
  public.update_territory_geometry(uuid, jsonb)
from anon, public;

grant execute on function
  public.create_location(jsonb, text, text, text, uuid),
  public.update_location_geometry(uuid, jsonb),
  public.create_route(jsonb, text, text, uuid, text),
  public.update_route_geometry(uuid, jsonb),
  public.create_territory(jsonb, uuid),
  public.update_territory_geometry(uuid, jsonb)
to authenticated;
