import { getGeminiClient, withRateLimitRetry } from "@/lib/gemini";

// "flash-lite" rather than "flash-latest" deliberately: Gemini's free tier
// tracks generation quota separately per model, and gemini-flash-latest's
// daily cap is only ~20 requests, shared with any other feature using that
// same model (vision chart extraction also used it previously). Switching to
// gemini-flash-lite-latest avoids that contention.
const GENERATION_MODEL = "gemini-flash-lite-latest";

export interface SourceChunk {
  document_name: string;
  chunk_index: number;
  chunk_text: string;
  section?: string | null;
}

function buildPrompt(question: string, sources: SourceChunk[]): string {
  const context = sources
    .map((s, i) => {
      const location = s.section
        ? `${s.document_name}, ${s.section}, chunk ${s.chunk_index + 1}`
        : `${s.document_name}, chunk ${s.chunk_index + 1}`;
      return `[Source ${i + 1} — ${location}]\n${s.chunk_text}`;
    })
    .join("\n\n");

  return `You are answering a question using only the context below, retrieved from the user's own documents.

Rules:
- Answer using only information found in the context.
- If the context does not contain the answer, say so plainly instead of guessing.
- Cite which source(s) you used by their number, e.g. "(Source 2)".

Context:
${context}

Question: ${question}

Answer:`;
}

export async function generateAnswer(
  question: string,
  sources: SourceChunk[]
): Promise<string> {
  return withRateLimitRetry(async () => {
    const response = await getGeminiClient().models.generateContent({
      model: GENERATION_MODEL,
      contents: buildPrompt(question, sources),
    });

    const text = response.text;

    if (!text) {
      throw new Error("Gemini did not return an answer.");
    }

    return text;
  });
}
