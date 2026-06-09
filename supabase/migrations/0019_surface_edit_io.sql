-- Migration: 0019_surface_edit_io
-- Read/write plumbing for the surface/decay brush.
-- Extends surface_edits with decay surface types and provides a GeoJSON view
-- + create/delete RPCs mirroring 0018_elevation_edit_io.sql exactly.

-- Extend the surface check constraint to include decay types.
alter table public.surface_edits
  drop constraint if exists surface_edits_surface_check;
alter table public.surface_edits
  add constraint surface_edits_surface_check
  check (surface in ('water','forest','rubble','ruined','regrowth','barren'));

-- GeoJSON read view (security_invoker so RLS on the base table applies).
drop view if exists public.surface_edits_geojson;
create view public.surface_edits_geojson with (security_invoker = true) as
  select id,
         st_asgeojson(geom)::jsonb as geometry,
         surface,
         payload,
         created_at, updated_at
  from public.surface_edits;

-- Create: GeoJSON footprint (jsonb) + surface type + payload.
-- SECURITY INVOKER, search_path pinned, granted to authenticated only.
create or replace function public.create_surface_edit(
  geometry jsonb,
  surface text,
  payload jsonb default '{}'
) returns uuid
language sql
set search_path = public, extensions
as $$
  insert into public.surface_edits (geom, surface, payload)
  values (
    st_setsrid(st_geomfromgeojson(geometry), 4326),
    surface,
    payload
  )
  returning id;
$$;

-- Delete one surface edit (RLS-checked, uniform client API).
create or replace function public.delete_surface_edit(id uuid)
returns void
language sql
set search_path = public, extensions
as $$
  delete from public.surface_edits where surface_edits.id = delete_surface_edit.id;
$$;

revoke execute on function
  public.create_surface_edit(jsonb, text, jsonb),
  public.delete_surface_edit(uuid)
from anon, public;

grant execute on function
  public.create_surface_edit(jsonb, text, jsonb),
  public.delete_surface_edit(uuid)
to authenticated;
