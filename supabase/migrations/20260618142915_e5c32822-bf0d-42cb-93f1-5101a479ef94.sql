ALTER TABLE public.deliveries
ADD COLUMN IF NOT EXISTS written_sheet_ids text[] NOT NULL DEFAULT '{}';