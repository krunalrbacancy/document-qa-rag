-- Run this once in the Supabase SQL editor (Project -> SQL Editor -> New query).

-- Enables the vector type and distance operators used by pgvector.
create extension if not exists vector;

create table if not exists document_chunks (
  id bigint generated always as identity primary key,
  document_name text not null,
  chunk_index int not null,
  chunk_text text not null,
  -- 3072 matches the output size of Gemini's gemini-embedding-001 model.
  -- If you switch embedding models later, this number must change too.
  embedding vector(3072) not null,
  created_at timestamptz not null default now(),
  -- Step 6 (Task 2): which section/chapter this chunk belongs to, for
  -- documents chunked with the section-aware strategy. Null for documents
  -- chunked by character or sentence, which have no section structure.
  section text
);

alter table document_chunks add column if not exists section text;

-- Step 5: semantic retrieval.
-- Given a question's embedding, returns the chunks whose stored vectors are
-- closest to it in meaning. `<=>` is pgvector's cosine distance operator:
-- 0 means identical direction (most similar), 2 means opposite. We convert
-- it to a 0-1 similarity score (1 - distance / 2) so higher always means
-- "more relevant", which is more intuitive to display than raw distance.
--
-- Postgres won't let `create or replace function` change a function's return
-- columns (only Supabase/pgvector-aware clients hit this once `section` is
-- added here) -- the old version must be dropped first.
drop function if exists match_document_chunks(vector, int);

create function match_document_chunks (
  query_embedding vector(3072),
  match_count int default 5
)
returns table (
  id bigint,
  document_name text,
  chunk_index int,
  chunk_text text,
  section text,
  similarity float
)
language sql stable
as $$
  select
    document_chunks.id,
    document_chunks.document_name,
    document_chunks.chunk_index,
    document_chunks.chunk_text,
    document_chunks.section,
    1 - (document_chunks.embedding <=> query_embedding) / 2 as similarity
  from document_chunks
  order by document_chunks.embedding <=> query_embedding
  limit match_count;
$$;
