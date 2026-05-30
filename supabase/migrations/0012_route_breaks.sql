-- Migration: 0012_route_breaks
-- A break is a located barrier ON a route (natural feature, blockade, toll gate)
-- that CLOSES the route without deleting it. A route is "closed" if it has any
-- active break; that severs its edge in the derived network graph (like a
-- destroyed route) while the geometry and the break marker remain.
--
-- `position` is the fraction (0..1) along the route where the break sits, and
-- `geom` is the click snapped onto the route line — so breaks render exactly on
-- the path. `active` lets a break be lifted (e.g. blockade cleared) without
-- deleting the record. Chunk C (route groups) will aggregate member breaks.

create table public.route_breaks (
  id          uuid primary key default gen_random_uuid(),
  route_id    uuid not null references public.routes(id) on delete cascade,
  geom        geometry(Point, 4326) not null,   -- snapped onto the route line
  position    numeric,                            -- 0..1 fraction along the route
  kind        text not null default 'blockade'
                check (kind in ('natural', 'blockade', 'toll')),
  label       text,
  active      boolean not null default true,      -- false = lifted, kept on record
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.route_breaks is 'Located barriers that close a route (severs its graph edge) without deleting it.';

create index route_breaks_geom_idx on public.route_breaks using gist (geom);
create index route_breaks_route_idx on public.route_breaks (route_id);

create trigger route_breaks_set_updated_at
  before update on public.route_breaks
  for each row execute function extensions.moddatetime(updated_at);

alter table public.route_breaks enable row level security;
create policy route_breaks_authenticated_all on public.route_breaks
  for all to authenticated using (true) with check (true);

-- GeoJSON view for rendering (geometry as GeoJSON; RLS via security_invoker).
create view public.route_breaks_geojson with (security_invoker = true) as
  select id, route_id, st_asgeojson(geom)::jsonb as geometry,
         position, kind, label, active, created_at, updated_at
  from public.route_breaks;

-- Place a break: snap the clicked point onto the route's line, store the
-- snapped point + its fractional position. SECURITY INVOKER, authenticated only.
create or replace function public.add_route_break(
  route_id uuid,
  click jsonb,
  kind text default 'blockade',
  label text default null
) returns uuid
language sql
set search_path = public, extensions
as $$
  insert into public.route_breaks (route_id, geom, position, kind, label)
  select
    add_route_break.route_id,
    st_lineinterpolatepoint(r.geom, st_linelocatepoint(r.geom, c.pt))::geometry(Point, 4326),
    st_linelocatepoint(r.geom, c.pt),
    add_route_break.kind,
    add_route_break.label
  from public.routes r,
       (select st_setsrid(st_geomfromgeojson(click), 4326) as pt) c
  where r.id = add_route_break.route_id
  returning id;
$$;

revoke execute on function public.add_route_break(uuid, jsonb, text, text) from anon, public;
grant execute on function public.add_route_break(uuid, jsonb, text, text) to authenticated;
