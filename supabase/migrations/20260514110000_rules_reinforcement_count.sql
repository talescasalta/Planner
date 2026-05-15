-- Track repeated manual confirmations before a learned rule becomes high-confidence.
ALTER TABLE public.classification_rules
  ADD COLUMN IF NOT EXISTS reinforcement_count integer NOT NULL DEFAULT 1;

UPDATE public.classification_rules
SET reinforcement_count = GREATEST(reinforcement_count, 1)
WHERE reinforcement_count IS NULL OR reinforcement_count < 1;
