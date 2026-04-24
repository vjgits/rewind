-- ============================================================
-- Rewind — Supabase schema
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor)
-- ============================================================

-- ── analyses ────────────────────────────────────────────────
create table public.analyses (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  status        text not null default 'pending'
                  check (status in (
                    'pending','extracting_frames','transcribing',
                    'analyzing_screens','synthesizing','complete','error'
                  )),
  video_path    text,          -- path inside the "videos" storage bucket
  video_filename text,         -- original filename shown in UI
  duration_s    integer,       -- video length in seconds
  summary       text,          -- final narrative from Claude Sonnet
  error_message text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- keep updated_at current automatically
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger analyses_updated_at
  before update on public.analyses
  for each row execute procedure public.set_updated_at();

-- ── keyframes ───────────────────────────────────────────────
create table public.keyframes (
  id           uuid primary key default gen_random_uuid(),
  analysis_id  uuid not null references public.analyses(id) on delete cascade,
  timestamp_s  integer not null,
  image_path   text,           -- path inside the "keyframes" storage bucket
  description  text            -- screen description from Claude Haiku
);

create index keyframes_analysis_id_idx on public.keyframes(analysis_id);

-- ── Row Level Security ───────────────────────────────────────
alter table public.analyses enable row level security;
alter table public.keyframes enable row level security;

-- analyses: users see only their own rows
create policy "users can read own analyses"
  on public.analyses for select
  using (auth.uid() = user_id);

create policy "users can insert own analyses"
  on public.analyses for insert
  with check (auth.uid() = user_id);

create policy "users can update own analyses"
  on public.analyses for update
  using (auth.uid() = user_id);

-- keyframes: users see keyframes that belong to their analyses
create policy "users can read own keyframes"
  on public.keyframes for select
  using (
    exists (
      select 1 from public.analyses a
      where a.id = analysis_id and a.user_id = auth.uid()
    )
  );

-- ── Storage buckets ─────────────────────────────────────────
-- Run these in the SQL editor too (or create via Dashboard → Storage)

insert into storage.buckets (id, name, public)
values ('videos', 'videos', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('keyframes', 'keyframes', true)
on conflict (id) do nothing;

-- videos bucket: authenticated users can upload to their own folder
create policy "users can upload own videos"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'videos' and
    (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "users can read own videos"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'videos' and
    (storage.foldername(name))[1] = auth.uid()::text
  );

-- keyframes bucket: public read (images are served in the results UI)
create policy "public can read keyframes"
  on storage.objects for select
  to public
  using (bucket_id = 'keyframes');

-- pipeline service role writes keyframe images (no RLS needed for service_role,
-- but this policy covers anon reads via public bucket)
create policy "service role can upload keyframes"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'keyframes');
