-- Migration: 0020_chronicle_events
-- Authored narrative history: dated events that form the world's timeline.
-- Each event has a year (integer, can be negative for pre-era dates), a title,
-- an optional body (markdown), an optional link to a location/faction/route,
-- and tags for filtering. Distinct from the sim's mechanical turns.

create table public.chronicle_events (
  id          uuid primary key default gen_random_uuid(),
  year        integer not null,
  title       text not null,
  body        text,
  target_type text,
  target_id   uuid,
  tags        text[] not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.chronicle_events is 'Authored: dated narrative events forming the world timeline.';
comment on column public.chronicle_events.year is 'In-world year; negative values are pre-era.';
comment on column public.chronicle_events.target_type is 'Optional link target type: location|faction|route|…';
comment on column public.chronicle_events.target_id is 'Optional UUID of the linked authored feature.';

-- Index for efficient year-range scrubbing (the primary query pattern).
create index chronicle_events_year_idx on public.chronicle_events (year);

-- updated_at maintenance (moddatetime trigger, same pattern as other tables).
create trigger chronicle_events_set_updated_at
  before update on public.chronicle_events
  for each row execute function extensions.moddatetime(updated_at);

-- Row Level Security — same policy pattern as every other authored table.
alter table public.chronicle_events enable row level security;

create policy chronicle_events_authenticated_all on public.chronicle_events
  for all to authenticated using (true) with check (true);
