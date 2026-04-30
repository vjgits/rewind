-- Run this in Supabase SQL Editor → New Query
ALTER TABLE public.analyses
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0;
