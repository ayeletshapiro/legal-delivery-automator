
-- Add new message statuses
ALTER TYPE public.message_status ADD VALUE IF NOT EXISTS 'awaiting_clarification';
ALTER TYPE public.message_status ADD VALUE IF NOT EXISTS 'cancelled';

-- Track sent WhatsApp replies
CREATE TABLE IF NOT EXISTS public.outbound_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  incoming_message_id UUID REFERENCES public.incoming_messages(id) ON DELETE SET NULL,
  to_phone TEXT NOT NULL,
  from_phone TEXT,
  body TEXT NOT NULL,
  reply_type TEXT,
  twilio_message_sid TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.outbound_messages TO authenticated;
GRANT ALL ON public.outbound_messages TO service_role;

ALTER TABLE public.outbound_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own outbound messages"
  ON public.outbound_messages FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_outbound_messages_incoming ON public.outbound_messages(incoming_message_id);
CREATE INDEX IF NOT EXISTS idx_outbound_messages_user_created ON public.outbound_messages(user_id, created_at DESC);

-- Track last clarification prompt sent to dedupe re-sends
ALTER TABLE public.pending_clarifications
  ADD COLUMN IF NOT EXISTS reply_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reply_type TEXT;
