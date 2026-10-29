import { GoogleGenAI } from "@google/genai";

const DEFAULT_RETRY_DELAY_MS = 20_000;
const OVERLOAD_RETRY_DELAY_MS = 10_000;
const MAX_OVERLOAD_RETRIES = 3;

let client: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not set in the environment.");
    }
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

export class RateLimitError extends Error {
  retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super("Gemini rate limit reached.");
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

function getRetryDelayMs(error: unknown): number | null {
  const status = (error as { status?: number })?.status;
  if (status !== 429) {
    return null;
  }

  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/"retryDelay":"(\d+(?:\.\d+)?)s"/);
  const seconds = match ? Number(match[1]) : null;
  return seconds !== null ? Math.ceil(seconds * 1000) : DEFAULT_RETRY_DELAY_MS;
}

export function isOverloadedError(error: unknown): boolean {
  return (error as { status?: number })?.status === 503;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRateLimitRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const retryDelayMs = getRetryDelayMs(error);
      if (retryDelayMs !== null) {
        throw new RateLimitError(retryDelayMs);
      }

      if (isOverloadedError(error) && attempt < MAX_OVERLOAD_RETRIES) {
        await sleep(OVERLOAD_RETRY_DELAY_MS);
        continue;
      }

      throw error;
    }
  }
}
