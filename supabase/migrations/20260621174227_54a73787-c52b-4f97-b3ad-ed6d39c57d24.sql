GRANT SELECT, INSERT, UPDATE, DELETE ON public.pending_clarifications TO authenticated;
GRANT ALL ON public.pending_clarifications TO service_role;

ALTER TABLE public.pending_clarifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_clarifications NO FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own pending clarifications" ON public.pending_clarifications;
DROP POLICY IF EXISTS "Users manage own pending clarifications insert" ON public.pending_clarifications;
DROP POLICY IF EXISTS "Users manage own pending clarifications update" ON public.pending_clarifications;
DROP POLICY IF EXISTS "Users manage own pending clarifications delete" ON public.pending_clarifications;

CREATE POLICY "Users can view their own pending clarifications"
  ON public.pending_clarifications
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users manage own pending clarifications insert"
  ON public.pending_clarifications
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users manage own pending clarifications update"
  ON public.pending_clarifications
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users manage own pending clarifications delete"
  ON public.pending_clarifications
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
