import { NextRequest, NextResponse } from "next/server";
import { generateEmbedding, RateLimitError } from "@/lib/embeddings";
import { isOverloadedError } from "@/lib/gemini";
import { deleteDocumentChunks, insertDocumentChunks } from "@/lib/supabase";

const MAX_CHUNKS_PER_REQUEST = 50;

interface IncomingChunk {
  index: number;
  text: string;
  embedding?: number[];
  section?: string;
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const documentName: string = body.documentName;
  const chunks: IncomingChunk[] = body.chunks;
  // When a large document is saved in multiple batches, only the first
  // batch should clear out the document's previous chunks -- later batches
  // must only add to what the first batch just inserted.
  const replaceExisting: boolean = body.replaceExisting !== false;

  if (!documentName) {
    return NextResponse.json(
      { error: "documentName is required." },
      { status: 400 }
    );
  }

  if (!Array.isArray(chunks) || chunks.length === 0) {
    return NextResponse.json(
      { error: "No chunks were provided." },
      { status: 400 }
    );
  }

  if (chunks.length > MAX_CHUNKS_PER_REQUEST) {
    return NextResponse.json(
      {
        error: `Too many chunks. Please save at most ${MAX_CHUNKS_PER_REQUEST} chunks at a time.`,
      },
      { status: 400 }
    );
  }

  try {
    const rows = await Promise.all(
      chunks.map(async (chunk) => {
        const embedding =
          chunk.embedding ?? (await generateEmbedding(chunk.text)).embedding;
        return {
          document_name: documentName,
          chunk_index: chunk.index,
          chunk_text: chunk.text,
          embedding,
          section: chunk.section,
        };
      })
    );

    if (replaceExisting) {
      await deleteDocumentChunks(documentName);
    }
    const inserted = await insertDocumentChunks(rows);

    return NextResponse.json({ savedCount: inserted.length });
  } catch (err) {
    if (err instanceof RateLimitError) {
      return NextResponse.json(
        { error: "Gemini rate limit reached.", retryAfterMs: err.retryAfterMs },
        { status: 429 }
      );
    }
    if (isOverloadedError(err)) {
      return NextResponse.json(
        {
          error:
            "Gemini's AI model is currently overloaded. Please wait a moment and try again.",
        },
        { status: 503 }
      );
    }
    const message =
      err instanceof Error
        ? err.message
        : "Failed to save chunks to the knowledge base.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
