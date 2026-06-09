-- Migration: 0021_map_annotations
-- Free-form map annotations: labeled markers, lines, and regions NOT tied to a
-- city/route/territory — landmarks, frontiers, notes-on-the-map. Geometry is a
-- generic geometry column (Point | LineString | Polygon). Mirrors the
-- read-view + create/delete RPC pattern of 0018/0019.

create table if not exists public.map_annotations (
  id          uuid primary key default gen_random_uuid(),
  geom        geometry(Geometry, 4326) not null,   -- point / line / polygon
  kind        text not null default 'marker'
              check (kind in ('marker','line','region')),
  label       text,
  color       text not null default '#e0af68',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists map_annotations_geom_idx on public.map_annotations using gist (geom);

comment on table public.map_annotations is
  'Authored free-form map annotations (markers/lines/regions) not tied to a feature.';

-- RLS: authenticated-only, matching every other authored table.
alter table public.map_annotations enable row level security;
drop policy if exists map_annotations_authenticated_all on public.map_annotations;
create policy map_annotations_authenticated_all on public.map_annotations
  for all to authenticated using (true) with check (true);

-- GeoJSON read view (security_invoker so RLS on the base table applies).
drop view if exists public.map_annotations_geojson;
create view public.map_annotations_geojson with (security_invoker = true) as
  select id,
         st_asgeojson(geom)::jsonb as geometry,
         kind, label, color,
         created_at, updated_at
  from public.map_annotations;

-- Create: GeoJSON geometry (jsonb) + kind/label/color. SECURITY INVOKER,
-- search_path pinned, granted to authenticated only — matching 0018/0019.
create or replace function public.create_map_annotation(
  geometry jsonb,
  kind text default 'marker',
  label text default null,
  color text default '#e0af68'
) returns uuid
language sql
set search_path = public, extensions
as $$
  insert into public.map_annotations (geom, kind, label, color)
  values (
    st_setsrid(st_geomfromgeojson(geometry), 4326),
    kind, label, color
  )
  returning id;
$$;

-- Update label/color (scalar edits; geometry edits would re-create).
create or replace function public.update_map_annotation(
  id uuid,
  label text,
  color text
) returns void
language sql
set search_path = public, extensions
as $$
  update public.map_annotations
  set label = update_map_annotation.label,
      color = update_map_annotation.color,
      updated_at = now()
  where map_annotations.id = update_map_annotation.id;
$$;

create or replace function public.delete_map_annotation(id uuid)
returns void
language sql
set search_path = public, extensions
as $$
  delete from public.map_annotations where map_annotations.id = delete_map_annotation.id;
$$;

revoke execute on function
  public.create_map_annotation(jsonb, text, text, text),
  public.update_map_annotation(uuid, text, text),
  public.delete_map_annotation(uuid)
from anon, public;

grant execute on function
  public.create_map_annotation(jsonb, text, text, text),
  public.update_map_annotation(uuid, text, text),
  public.delete_map_annotation(uuid)
to authenticated;
