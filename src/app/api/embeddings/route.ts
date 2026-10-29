import { NextRequest, NextResponse } from "next/server";
import { generateEmbedding, RateLimitError } from "@/lib/embeddings";
import { isOverloadedError } from "@/lib/gemini";

const MAX_CHUNKS_PER_REQUEST = 50;

interface IncomingChunk {
  index: number;
  text: string;
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const chunks: IncomingChunk[] = body.chunks;

  if (!Array.isArray(chunks) || chunks.length === 0) {
    return NextResponse.json(
      { error: "No chunks were provided." },
      { status: 400 }
    );
  }

  if (chunks.length > MAX_CHUNKS_PER_REQUEST) {
    return NextResponse.json(
      {
        error: `Too many chunks. Please request embeddings for at most ${MAX_CHUNKS_PER_REQUEST} chunks at a time.`,
      },
      { status: 400 }
    );
  }

  try {
    const results = await Promise.all(
      chunks.map(async (chunk) => {
        const { embedding, dimensions } = await generateEmbedding(
          chunk.text
        );
        return {
          index: chunk.index,
          dimensions,
          preview: embedding.slice(0, 5),
          embedding,
        };
      })
    );

    return NextResponse.json({ embeddings: results });
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
      err instanceof Error ? err.message : "Failed to generate embeddings.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
