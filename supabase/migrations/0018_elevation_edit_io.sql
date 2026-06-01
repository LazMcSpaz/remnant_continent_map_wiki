-- Migration: 0018_elevation_edit_io
-- Read/write plumbing for terrain-brush elevation edits, reusing the existing
-- elevation_edits table (geom Polygon = brush footprint; payload = brush params).
--
-- The brush authors soft Gaussian deltas described by a centre, radius (km), and
-- peak delta (m). We store the circular footprint as the geometry (so the GiST
-- index + any spatial query works) and the scalar params in payload. A GeoJSON
-- view exposes the geometry to the client, mirroring the other *_geojson views.

-- GeoJSON read view (security_invoker so RLS on the base table applies).
drop view if exists public.elevation_edits_geojson;
create view public.elevation_edits_geojson with (security_invoker = true) as
  select id,
         st_asgeojson(geom)::jsonb as geometry,
         payload,
         created_at, updated_at
  from public.elevation_edits;

-- Create: GeoJSON footprint (jsonb) + params. SECURITY INVOKER, search_path
-- pinned, granted to authenticated only — matching the other write RPCs.
create or replace function public.create_elevation_edit(
  geometry jsonb,
  radius_km double precision,
  delta_m double precision,
  center_lng double precision,
  center_lat double precision
) returns uuid
language sql
set search_path = public, extensions
as $$
  insert into public.elevation_edits (geom, payload)
  values (
    st_setsrid(st_geomfromgeojson(geometry), 4326),
    jsonb_build_object(
      'radiusKm', radius_km,
      'deltaM', delta_m,
      'lng', center_lng,
      'lat', center_lat
    )
  )
  returning id;
$$;

-- Delete one edit (plain delete is fine, but a function keeps the client API
-- uniform and RLS-checked).
create or replace function public.delete_elevation_edit(id uuid)
returns void
language sql
set search_path = public, extensions
as $$
  delete from public.elevation_edits where elevation_edits.id = delete_elevation_edit.id;
$$;

revoke execute on function
  public.create_elevation_edit(jsonb, double precision, double precision, double precision, double precision),
  public.delete_elevation_edit(uuid)
from anon, public;

grant execute on function
  public.create_elevation_edit(jsonb, double precision, double precision, double precision, double precision),
  public.delete_elevation_edit(uuid)
to authenticated;
