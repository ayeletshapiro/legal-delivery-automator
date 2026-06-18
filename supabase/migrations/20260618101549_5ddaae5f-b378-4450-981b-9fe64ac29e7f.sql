
-- Restrict SECURITY DEFINER functions: revoke from public/anon/authenticated
-- RLS evaluation still works because policies run in the table owner's context.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- has_role is invoked from RLS policies and from our security definer trigger functions, so we still need it executable by the postgres/owner role. Default owner already has it; the REVOKE above does not affect the owner.
