-- Plainly — accounts & persistence (Step 2) schema.
--
-- Apply in the Supabase SQL editor (no Supabase CLI in this project's pipeline).
-- RLS is the load-bearing access control. Posture:
--   * Both tables are RLS-enabled and default-deny: the ONLY policies are
--     per-user (auth.uid() = user_id), so no row is reachable by anyone but its
--     owner. There is no admin/service-role read path in the app.
--   * Table privileges are granted ONLY to the `authenticated` role and revoked
--     from `anon`, so an unauthenticated request (publishable key, no user
--     token) cannot touch case data even before RLS is consulted.
--   * The secret/service-role key is not used by Step 2 code at all.
--
-- GATE: the two-account cross-user test (account A cannot select/insert/update/
-- delete account B's row; A reads only A) must pass before any real data is
-- written. See the project conversation for the exact test.

-- ===========================================================================
-- cases: one row per user (one user = one case)
-- ===========================================================================
create table if not exists public.cases (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  intake             jsonb       not null default '{}'::jsonb,
  formal_fields      jsonb       not null default '{}'::jsonb,
  recap              text,
  context_narrative  text,
  parent_notes       text,
  created_at         timestamptz not null default now(),
  last_session_at    timestamptz,
  updated_at         timestamptz not null default now()
);

alter table public.cases enable row level security;

-- Default-deny + per-user policies (no other policy exists on this table).
-- drop-then-create so the whole script is safely re-runnable by hand.
drop policy if exists "cases_select_own" on public.cases;
create policy "cases_select_own" on public.cases
  for select using (auth.uid() = user_id);
drop policy if exists "cases_insert_own" on public.cases;
create policy "cases_insert_own" on public.cases
  for insert with check (auth.uid() = user_id);
drop policy if exists "cases_update_own" on public.cases;
create policy "cases_update_own" on public.cases
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "cases_delete_own" on public.cases;
create policy "cases_delete_own" on public.cases
  for delete using (auth.uid() = user_id);

-- ===========================================================================
-- sessions: many rows per user (one chat engagement each)
-- ===========================================================================
create table if not exists public.sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users (id) on delete cascade,
  transcript  jsonb       not null default '[]'::jsonb,
  label       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists sessions_user_id_created_at_idx
  on public.sessions (user_id, created_at desc);

alter table public.sessions enable row level security;

drop policy if exists "sessions_select_own" on public.sessions;
create policy "sessions_select_own" on public.sessions
  for select using (auth.uid() = user_id);
drop policy if exists "sessions_insert_own" on public.sessions;
create policy "sessions_insert_own" on public.sessions
  for insert with check (auth.uid() = user_id);
drop policy if exists "sessions_update_own" on public.sessions;
create policy "sessions_update_own" on public.sessions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "sessions_delete_own" on public.sessions;
create policy "sessions_delete_own" on public.sessions
  for delete using (auth.uid() = user_id);

-- ===========================================================================
-- Table privileges: ONLY the authenticated role.
-- Revoke from anon explicitly (in case project defaults grant it), so an
-- unauthenticated request is denied at the privilege layer, not just by RLS.
-- service_role bypasses RLS inherently and is unused by Step 2 — not granted here.
-- ===========================================================================
revoke all on public.cases    from anon;
revoke all on public.sessions from anon;

grant select, insert, update, delete on public.cases    to authenticated;
grant select, insert, update, delete on public.sessions to authenticated;
