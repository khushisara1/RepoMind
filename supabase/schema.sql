-- Optional persistence schema for a future authenticated RepoMind data layer.
-- This schema is not used by the current application runtime.

create extension if not exists vector with schema extensions;

create table if not exists public.repositories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  github_owner text not null,
  github_name text not null,
  repository_url text not null,
  default_branch text not null,
  latest_commit_sha text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, github_owner, github_name)
);

create table if not exists public.repository_files (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null references public.repositories(id) on delete cascade,
  commit_sha text not null,
  file_path text not null,
  language text,
  file_size_bytes bigint not null default 0 check (file_size_bytes >= 0),
  importance text check (importance in ('critical', 'important', 'supporting', 'configuration', 'test')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (repository_id, commit_sha, file_path)
);

create table if not exists public.code_chunks (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null references public.repositories(id) on delete cascade,
  commit_sha text not null,
  file_path text not null,
  symbol text,
  language text,
  start_line integer not null check (start_line > 0),
  end_line integer not null check (end_line >= start_line),
  chunk_text text not null,
  embedding extensions.vector(1536),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.repository_analysis (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null references public.repositories(id) on delete cascade,
  commit_sha text not null,
  status text not null default 'complete' check (status in ('queued', 'processing', 'complete', 'partial', 'failed')),
  report jsonb not null default '{}'::jsonb,
  analyzed_at timestamptz not null default now(),
  unique (repository_id, commit_sha)
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  repository_id uuid not null references public.repositories(id) on delete cascade,
  commit_sha text not null,
  title text not null default 'New conversation',
  explanation_level text not null default 'intermediate' check (explanation_level in ('beginner', 'intermediate', 'advanced')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  citations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.learning_progress (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  repository_id uuid not null references public.repositories(id) on delete cascade,
  commit_sha text not null,
  stage_key text not null,
  completed_at timestamptz,
  notes jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (owner_id, repository_id, commit_sha, stage_key)
);

create table if not exists public.repository_dependencies (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null references public.repositories(id) on delete cascade,
  commit_sha text not null,
  from_path text not null,
  to_path text,
  dependency_name text,
  relationship text not null check (relationship in ('import', 'package', 'call', 'inheritance')),
  line_number integer check (line_number is null or line_number > 0),
  verified boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.repository_commits (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null references public.repositories(id) on delete cascade,
  commit_sha text not null,
  author_name text,
  author_login text,
  commit_message text not null default '',
  committed_at timestamptz,
  changed_files jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  unique (repository_id, commit_sha)
);

create index if not exists repositories_owner_updated_idx on public.repositories (owner_id, updated_at desc);
create index if not exists repository_files_repo_commit_idx on public.repository_files (repository_id, commit_sha);
create index if not exists code_chunks_repo_commit_path_idx on public.code_chunks (repository_id, commit_sha, file_path);
create index if not exists code_chunks_embedding_idx on public.code_chunks using hnsw (embedding extensions.vector_cosine_ops) where embedding is not null;
create index if not exists repository_analysis_repo_time_idx on public.repository_analysis (repository_id, analyzed_at desc);
create index if not exists conversations_owner_repo_idx on public.conversations (owner_id, repository_id, updated_at desc);
create index if not exists messages_conversation_time_idx on public.messages (conversation_id, created_at);
create index if not exists learning_progress_owner_repo_idx on public.learning_progress (owner_id, repository_id, commit_sha);
create index if not exists repository_dependencies_repo_commit_idx on public.repository_dependencies (repository_id, commit_sha);
create index if not exists repository_commits_repo_time_idx on public.repository_commits (repository_id, committed_at desc);

alter table public.repositories enable row level security;
alter table public.repository_files enable row level security;
alter table public.code_chunks enable row level security;
alter table public.repository_analysis enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.learning_progress enable row level security;
alter table public.repository_dependencies enable row level security;
alter table public.repository_commits enable row level security;

drop policy if exists repositories_owner_all on public.repositories;
create policy repositories_owner_all on public.repositories for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists repository_files_owner_all on public.repository_files;
create policy repository_files_owner_all on public.repository_files for all using (
  exists (select 1 from public.repositories r where r.id = repository_id and r.owner_id = auth.uid())
) with check (
  exists (select 1 from public.repositories r where r.id = repository_id and r.owner_id = auth.uid())
);

drop policy if exists code_chunks_owner_all on public.code_chunks;
create policy code_chunks_owner_all on public.code_chunks for all using (
  exists (select 1 from public.repositories r where r.id = repository_id and r.owner_id = auth.uid())
) with check (
  exists (select 1 from public.repositories r where r.id = repository_id and r.owner_id = auth.uid())
);

drop policy if exists repository_analysis_owner_all on public.repository_analysis;
create policy repository_analysis_owner_all on public.repository_analysis for all using (
  exists (select 1 from public.repositories r where r.id = repository_id and r.owner_id = auth.uid())
) with check (
  exists (select 1 from public.repositories r where r.id = repository_id and r.owner_id = auth.uid())
);

drop policy if exists conversations_owner_all on public.conversations;
create policy conversations_owner_all on public.conversations for all using (auth.uid() = owner_id) with check (
  auth.uid() = owner_id and exists (select 1 from public.repositories r where r.id = repository_id and r.owner_id = auth.uid())
);

drop policy if exists messages_owner_all on public.messages;
create policy messages_owner_all on public.messages for all using (
  exists (select 1 from public.conversations c where c.id = conversation_id and c.owner_id = auth.uid())
) with check (
  exists (select 1 from public.conversations c where c.id = conversation_id and c.owner_id = auth.uid())
);

drop policy if exists learning_progress_owner_all on public.learning_progress;
create policy learning_progress_owner_all on public.learning_progress for all using (auth.uid() = owner_id) with check (
  auth.uid() = owner_id and exists (select 1 from public.repositories r where r.id = repository_id and r.owner_id = auth.uid())
);

drop policy if exists repository_dependencies_owner_all on public.repository_dependencies;
create policy repository_dependencies_owner_all on public.repository_dependencies for all using (
  exists (select 1 from public.repositories r where r.id = repository_id and r.owner_id = auth.uid())
) with check (
  exists (select 1 from public.repositories r where r.id = repository_id and r.owner_id = auth.uid())
);

drop policy if exists repository_commits_owner_all on public.repository_commits;
create policy repository_commits_owner_all on public.repository_commits for all using (
  exists (select 1 from public.repositories r where r.id = repository_id and r.owner_id = auth.uid())
) with check (
  exists (select 1 from public.repositories r where r.id = repository_id and r.owner_id = auth.uid())
);
