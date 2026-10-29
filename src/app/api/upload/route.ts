import { NextRequest, NextResponse } from "next/server";
import { chunkText, ChunkingStrategy } from "@/lib/chunking";
import { RateLimitError } from "@/lib/embeddings";
import { isOverloadedError } from "@/lib/gemini";
import { extractPdfText, extractPdfTextWithVision } from "@/lib/pdf";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB, PDFs are heavier than plain text

const DEFAULT_CHUNK_SIZE = 500;
const DEFAULT_CHUNK_OVERLAP = 50;
const DEFAULT_SENTENCE_OVERLAP = 1;

// Parses a page range string like "2-3" or "2,5,7" or "2-3,7" into a set of
// 1-indexed page numbers. Returns null for blank input, meaning "all pages".
function parsePageRange(input: string): Set<number> | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const pages = new Set<number>();
  for (const part of trimmed.split(",")) {
    const range = part.trim();
    const dashMatch = range.match(/^(\d+)\s*-\s*(\d+)$/);
    if (dashMatch) {
      const start = Number(dashMatch[1]);
      const end = Number(dashMatch[2]);
      for (let p = start; p <= end; p++) {
        pages.add(p);
      }
    } else if (/^\d+$/.test(range)) {
      pages.add(Number(range));
    }
  }

  return pages.size > 0 ? pages : null;
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("file");

  const strategyParam = formData.get("strategy");
  const strategy: ChunkingStrategy =
    strategyParam === "sentence"
      ? "sentence"
      : strategyParam === "section"
        ? "section"
        : "character";

  const useVision = formData.get("useVision") === "true";
  const visionPagesRaw = formData.get("visionPages");
  const visionPages =
    typeof visionPagesRaw === "string" ? parsePageRange(visionPagesRaw) : null;

  const chunkSize = Number(formData.get("chunkSize")) || DEFAULT_CHUNK_SIZE;
  const overlapDefault =
    strategy === "character" ? DEFAULT_CHUNK_OVERLAP : DEFAULT_SENTENCE_OVERLAP;
  const overlapRaw = formData.get("chunkOverlap");
  const chunkOverlap =
    overlapRaw === null || overlapRaw === ""
      ? overlapDefault
      : Number(overlapRaw);

  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { error: "No file was uploaded." },
      { status: 400 }
    );
  }

  const fileName = file.name.toLowerCase();
  const isTxtFile = file.type === "text/plain" || fileName.endsWith(".txt");
  const isPdfFile = file.type === "application/pdf" || fileName.endsWith(".pdf");

  if (!isTxtFile && !isPdfFile) {
    return NextResponse.json(
      { error: "Only .txt and .pdf files are supported right now." },
      { status: 400 }
    );
  }

  if (file.size === 0) {
    return NextResponse.json(
      { error: "The uploaded file is empty." },
      { status: 400 }
    );
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json(
      { error: "File is too large. Please upload a file under 10MB." },
      { status: 400 }
    );
  }

  if (Number.isNaN(chunkSize) || chunkSize <= 0) {
    return NextResponse.json(
      { error: "Chunk size must be a positive number." },
      { status: 400 }
    );
  }

  if (Number.isNaN(chunkOverlap) || chunkOverlap < 0) {
    return NextResponse.json(
      { error: "Chunk overlap must be 0 or greater." },
      { status: 400 }
    );
  }

  if (strategy === "character" && chunkOverlap >= chunkSize) {
    return NextResponse.json(
      { error: "Chunk overlap must be smaller than chunk size." },
      { status: 400 }
    );
  }

  let text: string;

  try {
    if (!isPdfFile) {
      text = await file.text();
    } else if (useVision) {
      text = await extractPdfTextWithVision(file, visionPages ?? undefined);
    } else {
      text = await extractPdfText(file);
    }
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
        : "Could not read this file. It may be corrupted or unsupported.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  if (text.trim().length === 0) {
    return NextResponse.json(
      {
        error:
          "No text could be extracted from this file. Scanned/image-only PDFs aren't supported yet.",
      },
      { status: 400 }
    );
  }

  const chunks = chunkText(text, strategy, chunkSize, chunkOverlap);

  return NextResponse.json({
    fileName: file.name,
    text,
    chunks,
    strategy,
    chunkSize,
    chunkOverlap,
    usedVision: isPdfFile && useVision,
  });
}
