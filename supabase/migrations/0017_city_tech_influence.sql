-- Migration: 0017_city_tech_influence
-- Move tech level + influence from factions to LOCATIONS (cities), and add a
-- major/minor tier to factions.
--
-- Rationale: tech and influence are properties a city holds; a faction's
-- figures are DERIVED from its locations (tech = population-weighted average,
-- influence = sum). So the authored values live on the city; the faction's are
-- recomputed at runtime and never stored.
--
-- Faction tier: 'major' factions always show in the Factions window; 'minor'
-- ones are kept but only listed behind a toggle.

-- Cities gain the authored economy attributes.
alter table public.locations
  add column if not exists tech_level integer not null default 5,
  add column if not exists influence integer not null default 0;

comment on column public.locations.tech_level is
  'Authored 1..10; scales this city''s production. Faction tech is the pop-weighted average.';
comment on column public.locations.influence is
  'Authored influence score; a faction''s influence is the sum across its cities.';

-- Factions gain a tier; tech_level/influence become DERIVED (drop the authored
-- columns added in 0016 — they are now computed from member cities).
alter table public.factions
  add column if not exists tier text not null default 'major'
    check (tier in ('major','minor'));

alter table public.factions
  drop column if exists tech_level,
  drop column if exists influence;

comment on column public.factions.tier is
  'major = always shown in the Factions window; minor = shown only behind a toggle.';

-- Surface tech/influence through the locations GeoJSON view so the client reads
-- them with the rest of a location's authored data.
drop view if exists public.locations_geojson;
create view public.locations_geojson with (security_invoker = true) as
  select id, st_asgeojson(geom)::jsonb as geometry, name, old_world_name, type,
         faction_id, resource_overrides, population, tech_level, influence,
         created_at, updated_at
  from public.locations;
