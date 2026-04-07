create extension if not exists pgcrypto;

create table if not exists public.skill_usage_logs (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  run_id text not null,
  session_id text,
  task text not null,
  task_hash text,
  skill_name text not null,
  skill_path text,
  skill_type text,
  status text not null check (status in ('success', 'error', 'timeout', 'partial')),
  error text,
  latency_ms integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_skill_usage_logs_created_at
  on public.skill_usage_logs (created_at desc);

create index if not exists idx_skill_usage_logs_skill_name_created_at
  on public.skill_usage_logs (skill_name, created_at desc);

create index if not exists idx_skill_usage_logs_status
  on public.skill_usage_logs (status);
