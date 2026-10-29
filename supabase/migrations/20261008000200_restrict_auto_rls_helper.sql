-- Hosted Supabase Free synthetic sandbox security hardening (2026-10-08).
-- Publicly callable SECURITY DEFINER event-trigger helper was generated when
-- "Enable automatic RLS" was selected at Supabase project creation.
-- Preserve the automatic RLS event trigger, but prevent untrusted API roles
-- from invoking the privileged helper through PostgREST RPC.
-- This migration is safe in a sandbox without that helper (e.g., CI local DB).
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end
$$;
