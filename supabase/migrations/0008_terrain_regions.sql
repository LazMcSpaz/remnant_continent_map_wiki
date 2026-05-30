-- Migration: 0008_terrain_regions
-- An authored AREA layer of physical-geography INPUTS, so future derived tools
-- (climate field, crop suitability, energy potential, hydrology) have real
-- area coverage rather than only city points.
--
-- Three-layer discipline: every column here is an authored INPUT the model
-- cannot recompute. Derived outputs (temperature, growing-degree-days, solar/
-- wind potential, suitability scores) are NOT stored — they compute at runtime
-- from these inputs plus world_settings.

create table public.terrain_regions (
  id            uuid primary key default gen_random_uuid(),
  geom          geometry(MultiPolygon, 4326) not null,
  name          text,

  -- Elevation / terrain (cataclysm reshaped this; can't be recomputed)
  elevation_m       numeric,                       -- representative elevation
  slope_deg         numeric,                       -- mean slope (energy, runoff)
  aspect_deg        numeric,                       -- mean aspect bearing (solar/wind exposure)

  -- Land cover & soil (crop & hydrology inputs)
  land_cover        text,                          -- forest|grassland|cropland|wetland|desert|urban|water|barren|tundra
  soil_fertility    numeric,                       -- 0..100 authored fertility
  soil_drainage     text,                          -- poor|moderate|well|excessive
  surface_water     numeric,                       -- 0..100 surface-water availability

  -- Energy exposure inputs
  wind_exposure     numeric,                       -- 0..100 openness to prevailing wind
  solar_exposure    numeric,                       -- 0..100 unshaded-ness / insolation hint

  -- Free-form authored extras without a migration each time
  attributes        jsonb not null default '{}'::jsonb,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint terrain_land_cover_chk check (
    land_cover is null or land_cover in
    ('forest','grassland','cropland','wetland','desert','urban','water','barren','tundra')
  ),
  constraint terrain_drainage_chk check (
    soil_drainage is null or soil_drainage in ('poor','moderate','well','excessive')
  ),
  constraint terrain_pct_chk check (
    (soil_fertility is null or soil_fertility between 0 and 100) and
    (surface_water  is null or surface_water  between 0 and 100) and
    (wind_exposure  is null or wind_exposure  between 0 and 100) and
    (solar_exposure is null or solar_exposure between 0 and 100)
  )
);

comment on table public.terrain_regions is 'Authored area layer: physical-geography inputs feeding derived climate/crop/energy/hydrology models. Never stores derived outputs.';

create index terrain_regions_geom_idx on public.terrain_regions using gist (geom);

-- updated_at trigger (matches the other authored tables)
create trigger terrain_regions_set_updated_at
  before update on public.terrain_regions
  for each row execute function extensions.moddatetime(updated_at);

-- RLS: same Phase 1 posture as the other authored tables (authenticated only).
alter table public.terrain_regions enable row level security;
create policy terrain_regions_authenticated_all on public.terrain_regions
  for all to authenticated using (true) with check (true);

-- GeoJSON view for the client (geometry as GeoJSON; RLS via security_invoker).
create view public.terrain_regions_geojson with (security_invoker = true) as
  select id, st_asgeojson(geom)::jsonb as geometry, name,
         elevation_m, slope_deg, aspect_deg,
         land_cover, soil_fertility, soil_drainage, surface_water,
         wind_exposure, solar_exposure, attributes,
         created_at, updated_at
  from public.terrain_regions;

-- Write RPC (GeoJSON -> PostGIS), authenticated only, search_path pinned.
create or replace function public.create_terrain_region(
  geometry jsonb,
  name text default null,
  attributes jsonb default '{}'::jsonb
) returns uuid
language sql
set search_path = public, extensions
as $$
  insert into public.terrain_regions (geom, name, attributes)
  values (
    st_multi(st_setsrid(st_geomfromgeojson(geometry), 4326))::geometry(MultiPolygon, 4326),
    name, attributes
  )
  returning id;
$$;

create or replace function public.update_terrain_region_geometry(id uuid, geometry jsonb)
returns void
language sql
set search_path = public, extensions
as $$
  update public.terrain_regions
  set geom = st_multi(st_setsrid(st_geomfromgeojson(geometry), 4326))::geometry(MultiPolygon, 4326)
  where terrain_regions.id = update_terrain_region_geometry.id;
$$;

revoke execute on function
  public.create_terrain_region(jsonb, text, jsonb),
  public.update_terrain_region_geometry(uuid, jsonb)
from anon, public;
grant execute on function
  public.create_terrain_region(jsonb, text, jsonb),
  public.update_terrain_region_geometry(uuid, jsonb)
to authenticated;
