-- Plainly — accounts & persistence (Step 3) storage.
--
-- Apply in the Supabase SQL editor (no Supabase CLI in this project's pipeline),
-- AFTER schema.sql. Owner action, exactly like schema.sql.
--
-- This adds ONE new persistence primitive: a private bucket for the documents
-- Plainly GENERATES (complaints, letters) — the parent's own outgoing advocacy.
-- Uploaded originals (IEPs, evals) are NEVER stored here or anywhere server-side;
-- only a shallow headline goes into cases.docs_reviewed (see schema.sql).
--
-- ACCESS POSTURE — the storage twin of the table RLS:
--   * The bucket is PRIVATE (public = false). There is no public/CDN URL path;
--     every read is RLS-checked under the user's own session.
--   * Files live under a per-user folder: 'generated-docs/<auth.uid()>/<file>'.
--     The four storage.objects policies below scope every operation to the
--     caller's own uid folder — (storage.foldername(name))[1] = auth.uid()::text —
--     so user A can never list/read/write/delete user B's files. This is the
--     exact analogue of "auth.uid() = user_id" on the tables.
--   * Policies are granted to the `authenticated` role only. storage.objects has
--     RLS enabled by default in Supabase, so the `anon` role — which has no
--     policy here — is denied outright. An unauthenticated request touches
--     nothing, before RLS even compares folders.
--   * No service-role / admin read path exists in app code: the secret key is
--     never used by the client or the Netlify function for storage.
--
-- DELETE-CASCADE OBLIGATION (write it down — it bites later):
--   Deleting an auth user cascades the public.cases / public.sessions ROWS
--   (FK `on delete cascade`), but storage objects live in the storage subsystem
--   and are NOT reached by that cascade. The v1.1 delete-my-data path must
--   therefore explicitly remove the user's bucket folder. Because every object
--   is uid-prefixed, that future deletion is a clean one-liner:
--     storage.from('generated-docs').remove(<list of objects under "<uid>/">)
--   Keeping the uid-prefixed path now is what makes that deletion simple later.
--
-- GATE: the two-account cross-user STORAGE test (account B cannot
-- list/download/upload/delete anything in account A's folder; A succeeds on its
-- own folder) must be run, shown to the owner, and PASS before any real file is
-- written to this bucket. Same hard-gate status as the table RLS test.

-- ===========================================================================
-- Private bucket. Re-runnable: do-nothing if it already exists.
-- ===========================================================================
insert into storage.buckets (id, name, public)
values ('generated-docs', 'generated-docs', false)
on conflict (id) do nothing;

-- ===========================================================================
-- Per-user folder policies on storage.objects.
-- (RLS is already enabled on storage.objects by default in Supabase.)
-- drop-then-create so the whole script is safely re-runnable by hand.
-- ===========================================================================
drop policy if exists "generated_docs_select_own" on storage.objects;
create policy "generated_docs_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'generated-docs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "generated_docs_insert_own" on storage.objects;
create policy "generated_docs_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'generated-docs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "generated_docs_update_own" on storage.objects;
create policy "generated_docs_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'generated-docs'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'generated-docs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "generated_docs_delete_own" on storage.objects;
create policy "generated_docs_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'generated-docs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
