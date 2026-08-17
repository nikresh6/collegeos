-- Make trigger-function lookup deterministic and prevent direct RPC execution of
-- internal SECURITY DEFINER trigger functions.
alter function public.set_updated_at()
  set search_path = pg_catalog, public;

revoke execute on function public.handle_new_auth_user_profile()
  from public, anon, authenticated;

revoke execute on function public.log_ai_study_behavior()
  from public, anon, authenticated;

-- The application server accesses solution keys with the service role. Browser
-- roles are denied both by privileges and by this explicit RLS policy.
drop policy if exists "Browser roles cannot access solve solution keys"
  on public.solve_solution_keys;

create policy "Browser roles cannot access solve solution keys"
on public.solve_solution_keys
as restrictive
for all
to anon, authenticated
using (false)
with check (false);
