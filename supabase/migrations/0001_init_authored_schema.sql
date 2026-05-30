-- Migration: 0001_init_authored_schema
-- The Remnant Continent atlas — Phase 1 authored layer.
--
-- Scope: the AUTHORED layer only (the source of truth). Per the three-layer
-- model (docs/architecture.md), the DERIVED layer is computed at runtime and is
-- never stored as fact, and the SIMULATED layer is a future, additive concern
-- (Phase 4) — neither gets tables here. Adding simulated state later is a new
-- table, not a migration of this schema.
--
-- Geometry: PostGIS, SRID 4326 (WGS84 lon/lat).

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists postgis;
-- pgcrypto (gen_random_uuid) and moddatetime ship enabled on Supabase; ensure
-- moddatetime for updated_at triggers.
create extension if not exists moddatetime schema extensions;

-- ---------------------------------------------------------------------------
-- factions
-- ---------------------------------------------------------------------------
create table public.factions (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  color       text not null default '#888888',  -- hex, styles territories/routes
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.factions is 'Authored: factions that own territory and routes.';

-- ---------------------------------------------------------------------------
-- travel_modes  (label + speed; drives derived route travel times)
-- ---------------------------------------------------------------------------
create table public.travel_modes (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,                 -- e.g. 'landship', 'rail', 'on foot'
  speed_kph   numeric not null check (speed_kph > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.travel_modes is 'Authored: named travel modes with speeds.';

-- ---------------------------------------------------------------------------
-- locations  (cities, settlements, POIs, caves, …)
-- Point or Polygon — kept as generic geometry so areal places are allowed.
-- ---------------------------------------------------------------------------
create table public.locations (
  id                 uuid primary key default gen_random_uuid(),
  geom               geometry(Geometry, 4326) not null,
  name               text not null,            -- new-world name (e.g. 'Omara')
  old_world_name     text,                     -- real-world name (e.g. 'Omaha')
  type               text not null default 'settlement', -- city|settlement|poi|cave|…
  faction_id         uuid references public.factions(id) on delete set null,
  resource_overrides jsonb not null default '{}'::jsonb, -- pins for derived city baselines
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.locations is 'Authored: places. resource_overrides pins derived city baselines.';
comment on column public.locations.old_world_name is 'Real-world name; drives the old↔new name toggle.';

-- ---------------------------------------------------------------------------
-- routes  (the edges of the network graph built in derived/)
-- ---------------------------------------------------------------------------
create table public.routes (
  id                uuid primary key default gen_random_uuid(),
  geom              geometry(LineString, 4326) not null,
  kind              text not null default 'road'
                      check (kind in ('rail', 'road', 'trail')),
  owner_faction_id  uuid references public.factions(id) on delete set null,
  status            text not null default 'intact'
                      check (status in ('intact', 'damaged', 'destroyed')),
  mode_ids          uuid[] not null default '{}',  -- applicable travel_modes
  purpose           text,                          -- 'trade'|'common'|'owner'|… (color/label)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.routes is 'Authored: road/rail/trail segments; edges of the derived network graph.';
comment on column public.routes.status is 'intact|damaged|destroyed — gates derived travel times and Phase 4 flow.';

-- ---------------------------------------------------------------------------
-- territories  (faction polygons)
-- ---------------------------------------------------------------------------
create table public.territories (
  id          uuid primary key default gen_random_uuid(),
  geom        geometry(MultiPolygon, 4326) not null,
  faction_id  uuid not null references public.factions(id) on delete cascade,
  style       jsonb not null default '{}'::jsonb,  -- fill/stroke overrides
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.territories is 'Authored: faction territory polygons.';

-- ---------------------------------------------------------------------------
-- world_settings  (climate-model inputs; singleton-ish)
-- ---------------------------------------------------------------------------
create table public.world_settings (
  id                 uuid primary key default gen_random_uuid(),
  pole_geom          geometry(Point, 4326),  -- movable pole for the climate model
  season             numeric not null default 0,   -- season phase (0..1)
  global_temp_offset numeric not null default 0,    -- global temperature knob (°C)
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.world_settings is 'Authored: inputs to the derived climate model (pole, season, temp).';

-- ---------------------------------------------------------------------------
-- Raster/mask edit deltas over base layers
-- ---------------------------------------------------------------------------
create table public.elevation_edits (
  id          uuid primary key default gen_random_uuid(),
  geom        geometry(Polygon, 4326) not null,  -- affected area
  payload     jsonb not null default '{}'::jsonb, -- delta description / raster ref
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.surface_edits (
  id          uuid primary key default gen_random_uuid(),
  geom        geometry(Polygon, 4326) not null,
  surface     text not null check (surface in ('water', 'forest')),
  operation   text not null default 'add' check (operation in ('add', 'remove')),
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.decay_masks (
  id          uuid primary key default gen_random_uuid(),
  geom        geometry(Polygon, 4326) not null,
  level       numeric not null default 0,  -- decay(−)/rebuild(+) intensity
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.elevation_edits is 'Authored: elevation deltas over the base DEM (cataclysm reshaping).';
comment on table public.surface_edits is 'Authored: add/remove water & forest (Phase 3 brush).';
comment on table public.decay_masks  is 'Authored: stylized decay/rebuild masks (Phase 3 brush).';

-- ---------------------------------------------------------------------------
-- notes  (polymorphic — annotates everything; supports [[wiki-links]])
-- ---------------------------------------------------------------------------
create table public.notes (
  id           uuid primary key default gen_random_uuid(),
  target_type  text not null,            -- location|route|territory|border|point|…
  target_id    uuid,                     -- nullable for free-floating geo notes
  geom         geometry(Geometry, 4326), -- nullable; for notes pinned to a spot
  body         text not null default '',  -- markdown
  tags         text[] not null default '{}',
  links        text[] not null default '{}', -- resolved [[wiki-style]] cross-links
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.notes is 'Authored: polymorphic annotations on any feature or spot.';

-- ---------------------------------------------------------------------------
-- Spatial indexes (GIST) — every geometry column we query spatially
-- ---------------------------------------------------------------------------
create index locations_geom_idx       on public.locations       using gist (geom);
create index routes_geom_idx          on public.routes          using gist (geom);
create index territories_geom_idx     on public.territories     using gist (geom);
create index elevation_edits_geom_idx on public.elevation_edits using gist (geom);
create index surface_edits_geom_idx   on public.surface_edits   using gist (geom);
create index decay_masks_geom_idx     on public.decay_masks     using gist (geom);
create index notes_geom_idx           on public.notes           using gist (geom);

-- Foreign-key / lookup indexes
create index locations_faction_idx    on public.locations  (faction_id);
create index routes_owner_idx         on public.routes     (owner_faction_id);
create index territories_faction_idx  on public.territories(faction_id);
create index notes_target_idx         on public.notes      (target_type, target_id);

-- ---------------------------------------------------------------------------
-- updated_at maintenance (moddatetime trigger on every table)
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'factions','travel_modes','locations','routes','territories',
    'world_settings','elevation_edits','surface_edits','decay_masks','notes'
  ] loop
    execute format(
      'create trigger %I_set_updated_at before update on public.%I
         for each row execute function extensions.moddatetime(updated_at)',
      t, t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- Enabled on every table (Supabase security baseline). Phase 1 has no auth yet,
-- so access is granted to the `authenticated` role; the anon/public role gets
-- nothing. Wire up Supabase Auth in the client before these tables are usable,
-- or revisit these policies if the tool stays single-user/local.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'factions','travel_modes','locations','routes','territories',
    'world_settings','elevation_edits','surface_edits','decay_masks','notes'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I_authenticated_all on public.%I
         for all to authenticated using (true) with check (true)',
      t, t
    );
  end loop;
end $$;
