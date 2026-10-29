import { createClient, SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !serviceRoleKey) {
      throw new Error(
        "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment."
      );
    }

    client = createClient(url, serviceRoleKey);
  }
  return client;
}

export interface DocumentChunkRow {
  document_name: string;
  chunk_index: number;
  chunk_text: string;
  embedding: number[];
  section?: string;
}

export async function deleteDocumentChunks(documentName: string) {
  const { error } = await getSupabaseClient()
    .from("document_chunks")
    .delete()
    .eq("document_name", documentName);

  if (error) {
    throw new Error(error.message);
  }
}

export async function insertDocumentChunks(rows: DocumentChunkRow[]) {
  const { data, error } = await getSupabaseClient()
    .from("document_chunks")
    .insert(rows)
    .select("id, chunk_index");

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export interface KnowledgeBaseDocument {
  document_name: string;
  chunk_count: number;
}

export async function listKnowledgeBaseDocuments(): Promise<
  KnowledgeBaseDocument[]
> {
  // PostgREST caps a single request at 1000 rows by default, so a knowledge
  // base with more than 1000 chunks total needs this fetched in pages --
  // otherwise documents added later (whose rows sort after the cutoff) can
  // silently disappear from the list, and earlier documents under-count.
  const pageSize = 1000;
  const counts = new Map<string, number>();

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await getSupabaseClient()
      .from("document_chunks")
      .select("document_name")
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(error.message);
    }

    for (const row of data ?? []) {
      counts.set(row.document_name, (counts.get(row.document_name) ?? 0) + 1);
    }

    if (!data || data.length < pageSize) {
      break;
    }
  }

  return [...counts.entries()]
    .map(([document_name, chunk_count]) => ({ document_name, chunk_count }))
    .sort((a, b) => a.document_name.localeCompare(b.document_name));
}

export interface MatchedChunk {
  id: number;
  document_name: string;
  chunk_index: number;
  chunk_text: string;
  section: string | null;
  similarity: number;
}

export async function matchDocumentChunks(
  queryEmbedding: number[],
  matchCount: number
): Promise<MatchedChunk[]> {
  const { data, error } = await getSupabaseClient().rpc(
    "match_document_chunks",
    {
      query_embedding: queryEmbedding,
      match_count: matchCount,
    }
  );

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}
