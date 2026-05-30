-- Migration: 0007_world_settings_climate
-- Expand world_settings with the global climate + energy INPUTS the derived
-- climate model needs after a pole moves. These are authored facts (knobs the
-- author sets); the temperature field, snow line, and solar potential they feed
-- are DERIVED and never stored. Adds trailing columns only, so the existing
-- world_settings_geojson view can be replaced in place.

alter table public.world_settings
  add column if not exists axial_tilt_deg      numeric not null default 23.5,
  add column if not exists sea_level_m          numeric not null default 0,
  add column if not exists equator_temp_c       numeric not null default 30,
  add column if not exists pole_temp_c          numeric not null default -25,
  add column if not exists lapse_rate_c_per_km  numeric not null default 6.5,
  add column if not exists prevailing_wind_deg  numeric not null default 270;

comment on column public.world_settings.axial_tilt_deg is 'Authored input: planetary axial tilt (drives seasonal swing).';
comment on column public.world_settings.sea_level_m is 'Authored input: global sea level offset in metres (cataclysm).';
comment on column public.world_settings.equator_temp_c is 'Authored input: base sea-level temperature at the (effective) equator.';
comment on column public.world_settings.pole_temp_c is 'Authored input: base sea-level temperature at the (effective) pole.';
comment on column public.world_settings.lapse_rate_c_per_km is 'Authored input: temperature drop per km of elevation.';
comment on column public.world_settings.prevailing_wind_deg is 'Authored input: prevailing wind bearing (deg), reference for wind energy.';

-- Extend the GeoJSON view with the new fields (append-only keeps column order).
create or replace view public.world_settings_geojson with (security_invoker = true) as
  select id, st_asgeojson(pole_geom)::jsonb as pole_geometry, season,
         global_temp_offset, created_at, updated_at,
         axial_tilt_deg, sea_level_m, equator_temp_c, pole_temp_c,
         lapse_rate_c_per_km, prevailing_wind_deg
  from public.world_settings;

-- Seed a singleton settings row with Earth-like defaults if none exists, with
-- the pole near its real-world Midwest-relevant position (geographic north).
insert into public.world_settings (pole_geom, season, global_temp_offset)
select st_setsrid(st_makepoint(0, 90), 4326), 0, 0
where not exists (select 1 from public.world_settings);
