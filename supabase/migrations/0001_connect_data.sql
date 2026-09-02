-- Connect Data surface: one real Postgres table per generated dataset in data/,
-- read-only to the anon key via RLS (seeding uses the service-role key instead —
-- see scripts/seed-supabase.mjs). Run once in the Supabase SQL editor.
-- Month-granularity columns are real `date` (first-of-month), not text.

create table customers (
  customer_id   text primary key,
  name          text not null,
  segment       text not null,
  plan_tier     text not null,
  region        text not null,
  channel       text not null,
  contract_type text not null,
  signup_month  date not null,
  churn_month   date
);

create table mrr_monthly (
  customer_id    text not null,
  month          date not null,
  mrr            numeric not null,
  is_new         boolean not null,
  is_expansion   boolean not null,
  is_contraction boolean not null,
  is_churned     boolean not null,
  primary key (customer_id, month)
);

create table cac_monthly (
  month date primary key,
  cac   numeric not null
);

create table employees (
  employee_id text primary key,
  department  text not null,
  region      text not null,
  hire_month  date not null,
  term_month  date
);

create table reports (
  report_id     text primary key,
  name          text not null,
  owner_team    text not null,
  created_month date not null
);

create table report_views_monthly (
  report_id        text not null,
  month            date not null,
  views            integer not null,
  unique_viewers   integer not null,
  engagement_score numeric not null,
  primary key (report_id, month)
);

create table activity_heatmap (
  weekday     text not null,
  hour_bucket text not null,
  views       integer not null,
  primary key (weekday, hour_bucket)
);

-- Read-only for the anon key on all 7 tables. This is a blanket
-- "anyone with the anon key can read all 7 fictional tables" policy —
-- correct for this demo dataset, not the template to reuse if real
-- customer data ever lands in these tables.
do $$
declare t text;
begin
  for t in select unnest(array[
    'customers','mrr_monthly','cac_monthly','employees',
    'reports','report_views_monthly','activity_heatmap'
  ])
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "public read" on %I for select using (true)', t);
  end loop;
end $$;
