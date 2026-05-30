-- Migration: 0006_location_population
-- Adds population as a first-class authored stat on locations (the wiki panel's
-- Population tab) and surfaces it through the GeoJSON view. Seeds rough values
-- for the existing sample cities. Population is scalar, so edits use plain
-- PostgREST UPDATE — no geometry RPC needed.

alter table public.locations
  add column if not exists population bigint
  check (population is null or population >= 0);

comment on column public.locations.population is 'Authored: settlement population (nullable).';

-- Recreate the GeoJSON view to include population. DROP first because
-- CREATE OR REPLACE VIEW cannot insert a column mid-list (column order changes).
drop view if exists public.locations_geojson;
create view public.locations_geojson with (security_invoker = true) as
  select id, st_asgeojson(geom)::jsonb as geometry, name, old_world_name, type,
         faction_id, population, resource_overrides, created_at, updated_at
  from public.locations;

-- Seed rough populations + a couple of resource_overrides for the sample data.
update public.locations set population = 248000,
  resource_overrides = '{"food": 60, "water": 75, "energy": 40, "production": 80}'::jsonb
  where name = 'Omara';
update public.locations set population = 92000  where name = 'Lincorr';
update public.locations set population = 510000,
  resource_overrides = '{"food": 45, "water": 90, "energy": 55, "production": 95}'::jsonb
  where name = 'Kansit';
update public.locations set population = 210000 where name = 'Desmoin';
update public.locations set population = 715000,
  resource_overrides = '{"food": 30, "water": 50, "energy": 70, "production": 85}'::jsonb
  where name = 'Denvar';
