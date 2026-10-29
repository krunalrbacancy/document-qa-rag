import { getGeminiClient, withRateLimitRetry, RateLimitError } from "@/lib/gemini";

const EMBEDDING_MODEL = "gemini-embedding-001";

export { RateLimitError };

export interface EmbeddingResult {
  embedding: number[];
  dimensions: number;
}

export async function generateEmbedding(
  text: string
): Promise<EmbeddingResult> {
  return withRateLimitRetry(async () => {
    const response = await getGeminiClient().models.embedContent({
      model: EMBEDDING_MODEL,
      contents: text,
    });

    const embedding = response.embeddings?.[0]?.values;

    if (!embedding) {
      throw new Error("Gemini did not return an embedding for this chunk.");
    }

    return {
      embedding,
      dimensions: embedding.length,
    };
  });
}
