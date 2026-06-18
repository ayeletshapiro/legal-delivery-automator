CREATE TABLE public.pending_clarifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES public.incoming_messages(id) ON DELETE CASCADE,
  delivery_id uuid NOT NULL REFERENCES public.deliveries(id) ON DELETE CASCADE,
  raw_text text NOT NULL,
  resolution text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

GRANT SELECT ON public.pending_clarifications TO authenticated;
GRANT ALL ON public.pending_clarifications TO service_role;

ALTER TABLE public.pending_clarifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own pending clarifications"
  ON public.pending_clarifications FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX pending_clarifications_open_idx
  ON public.pending_clarifications (user_id, created_at DESC)
  WHERE resolved_at IS NULL;
