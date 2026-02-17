-- PreLab schema for Supabase (PostgreSQL)
-- Run in Supabase SQL Editor.
-- NOTE: This reset block is for initial setup/development.

create extension if not exists pgcrypto;

-- Clean reset (avoids type mismatch errors from previous partial schemas)
drop table if exists public.chat_messages cascade;
drop table if exists public.ai_feedback cascade;
drop table if exists public.results cascade;
drop table if exists public.quizzes cascade;
drop table if exists public.modules cascade;
drop table if exists public.subjects cascade;
drop table if exists public.users cascade;

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  created_at timestamptz not null default now()
);

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.modules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete restrict,
  title text not null,
  source_text text not null,
  study_goal text,
  status text not null default 'new',
  created_at timestamptz not null default now()
);

create table public.quizzes (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.modules(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  quiz_json jsonb not null,
  created_at timestamptz not null default now()
);

create table public.results (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  module_id uuid not null references public.modules(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  score numeric(5,2) not null,
  correct_count integer not null,
  total_questions integer not null,
  feedback jsonb not null,
  weak_areas text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table public.ai_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  module_id uuid not null references public.modules(id) on delete cascade,
  result_id uuid not null references public.results(id) on delete cascade,
  feedback_json jsonb not null,
  created_at timestamptz not null default now()
);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  module_id uuid not null references public.modules(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index idx_modules_user_id on public.modules(user_id);
create index idx_quizzes_module_id on public.quizzes(module_id);
create index idx_results_user_id on public.results(user_id);
create index idx_chat_user_module on public.chat_messages(user_id, module_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.users (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do update
  set email = excluded.email,
      full_name = excluded.full_name;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

alter table public.users enable row level security;
alter table public.subjects enable row level security;
alter table public.modules enable row level security;
alter table public.quizzes enable row level security;
alter table public.results enable row level security;
alter table public.ai_feedback enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists "users_select_own" on public.users;
create policy "users_select_own" on public.users
for select using (auth.uid() = id);

drop policy if exists "users_update_own" on public.users;
create policy "users_update_own" on public.users
for update using (auth.uid() = id);

drop policy if exists "subjects_select_all" on public.subjects;
create policy "subjects_select_all" on public.subjects
for select using (true);

drop policy if exists "modules_owner_all" on public.modules;
create policy "modules_owner_all" on public.modules
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "quizzes_owner_all" on public.quizzes;
create policy "quizzes_owner_all" on public.quizzes
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "results_owner_all" on public.results;
create policy "results_owner_all" on public.results
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "aifeedback_owner_all" on public.ai_feedback;
create policy "aifeedback_owner_all" on public.ai_feedback
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "chat_owner_all" on public.chat_messages;
create policy "chat_owner_all" on public.chat_messages
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Storage bucket for study uploads (used to bypass Vercel body-size limits).
insert into storage.buckets (id, name, public)
values ('study-materials', 'study-materials', false)
on conflict (id) do nothing;

drop policy if exists "study_materials_insert_own" on storage.objects;
create policy "study_materials_insert_own" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'study-materials'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "study_materials_select_own" on storage.objects;
create policy "study_materials_select_own" on storage.objects
for select to authenticated
using (
  bucket_id = 'study-materials'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "study_materials_delete_own" on storage.objects;
create policy "study_materials_delete_own" on storage.objects
for delete to authenticated
using (
  bucket_id = 'study-materials'
  and (storage.foldername(name))[1] = auth.uid()::text
);
