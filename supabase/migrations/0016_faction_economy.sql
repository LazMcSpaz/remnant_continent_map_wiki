-- Migration: 0016_faction_economy
-- Faction economy attributes + relationships, feeding the Phase 4 simulation.
--
--   tech_level  — authored 1..10; directly scales a faction's production.
--   influence   — authored manual score; reserved for later systems.
--   faction_relations — pairwise stance (allies/friendly/tense/hostile) that
--                       gates how much surplus flows between factions.
--
-- Wealth is NOT stored: it is a derived/simulated metric (who benefits from the
-- production of surplus), recomputed each turn by the engine.

alter table public.factions
  add column if not exists tech_level integer not null default 5,
  add column if not exists influence integer not null default 0;

comment on column public.factions.tech_level is
  'Authored 1..10; scales production in the flow simulation (5 = baseline x1.0).';
comment on column public.factions.influence is
  'Authored manual influence score; reserved for later systems.';

create table if not exists public.faction_relations (
  id          uuid primary key default gen_random_uuid(),
  faction_a   uuid not null references public.factions(id) on delete cascade,
  faction_b   uuid not null references public.factions(id) on delete cascade,
  level       text not null default 'friendly'
              check (level in ('allies','friendly','tense','hostile')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Canonical ordering: one row per unordered pair (relations are symmetric).
  unique (faction_a, faction_b),
  check (faction_a < faction_b)
);

comment on table public.faction_relations is
  'Authored: symmetric pairwise stance between factions; gates surplus sharing.';

-- RLS: authenticated-only, matching every other authored table.
alter table public.faction_relations enable row level security;
create policy faction_relations_authenticated_all on public.faction_relations
  for all to authenticated using (true) with check (true);
