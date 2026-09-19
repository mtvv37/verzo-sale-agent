-- Run this once against the Supabase project referenced by SUPABASE_URL.

create extension if not exists pgcrypto;

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  company text,
  website text unique,
  industry text,
  employees int,
  country text,
  decision_maker text,
  role text,
  linkedin text,
  email text,
  email_guessed boolean default false,
  website_score int,
  business_trigger text,
  opportunity text,
  total_score int,
  disqualify_reason text,
  status text default 'NEW', -- NEW, QUALIFIED, DISQUALIFIED, CONTACTED, REPLIED, INTERESTED, CALL, PROPOSAL, WON, LOST
  approved boolean default false,
  last_contact timestamptz,
  next_followup timestamptz,
  followup_count int default 0,
  email_draft text,
  linkedin_draft text,
  created_at timestamptz default now()
);

create index if not exists leads_status_idx on leads (status);
create index if not exists leads_total_score_idx on leads (total_score desc);
