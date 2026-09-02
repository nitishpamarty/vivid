-- Per-session shared state. Run manually after 0001_connect_data.sql.
-- The capability itself never enters Postgres; only its SHA-256 digest does.

create extension if not exists pgcrypto;

create table if not exists rooms (
  room_id uuid primary key,
  capability_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);

create table if not exists dashboard_state (
  room_id uuid not null references rooms(room_id) on delete cascade,
  report_id text not null check (report_id = 'northbeam'),
  schema_version integer not null,
  version bigint not null default 0,
  state jsonb not null,
  updated_by text not null check (updated_by in ('person', 'agent')),
  updated_at timestamptz not null default now(),
  primary key (room_id, report_id)
);

create table if not exists activity_log (
  id bigint generated always as identity primary key,
  room_id uuid not null references rooms(room_id) on delete cascade,
  report_id text not null check (report_id = 'northbeam'),
  actor text not null check (actor in ('person', 'agent')),
  source text not null default 'browser',
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists activity_log_room_created_idx on activity_log(room_id, created_at);

alter table rooms enable row level security;
alter table dashboard_state enable row level security;
alter table activity_log enable row level security;

-- Shared reads are scoped by room_id in the client query/channel. No anon
-- INSERT/UPDATE/DELETE policies are intentional; Task 3 adds the Edge Function.
drop policy if exists "room state read" on dashboard_state;
create policy "room state read" on dashboard_state for select using (true);
drop policy if exists "room activity read" on activity_log;
create policy "room activity read" on activity_log for select using (true);
