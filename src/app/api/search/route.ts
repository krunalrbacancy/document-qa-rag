import { NextRequest, NextResponse } from "next/server";
import { generateEmbedding, RateLimitError } from "@/lib/embeddings";
import { isOverloadedError } from "@/lib/gemini";
import { matchDocumentChunks } from "@/lib/supabase";

const MATCH_COUNT = 5;

export async function POST(request: NextRequest) {
  const body = await request.json();
  const question: string = body.question;

  if (!question || !question.trim()) {
    return NextResponse.json(
      { error: "Please enter a question to search for." },
      { status: 400 }
    );
  }

  try {
    const { embedding } = await generateEmbedding(question);
    const matches = await matchDocumentChunks(embedding, MATCH_COUNT);

    return NextResponse.json({ matches });
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
      err instanceof Error ? err.message : "Failed to search the knowledge base.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
