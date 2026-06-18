
-- has_role MUST be executable by authenticated users because RLS policies call it.
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
