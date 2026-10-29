import { getGeminiClient, withRateLimitRetry } from "@/lib/gemini";

// "flash-lite" rather than "flash-latest" deliberately: Gemini's free tier
// tracks generation quota separately per model, and gemini-flash-latest's
// daily cap is only ~20 requests -- far too small for a multi-page document
// (each vision call is one generateContent request). gemini-flash-lite-latest
// draws from its own, much less contended quota while still handling image
// input correctly.
const VISION_MODEL = "gemini-flash-lite-latest";

const CHART_DESCRIPTION_PROMPT = `This image is a page from a document. It may contain charts, diagrams, or
infographics whose data cannot be reliably read from plain text extraction,
because extracting text from a PDF reads words in a raw order that loses the
visual layout connecting numbers to their labels.

If the page contains a chart, diagram, or infographic, describe it as clear
structured text:
- State what it shows.
- List every labeled value and exactly what it corresponds to.
- Preserve numeric values exactly as shown, including units and signs.

If the page is plain text, a cover page, or has no chart/diagram, respond with
exactly: "No chart on this page."`;

export async function describePageChart(
  imageBuffer: ArrayBuffer
): Promise<string> {
  return withRateLimitRetry(async () => {
    const base64Image = Buffer.from(imageBuffer).toString("base64");

    const response = await getGeminiClient().models.generateContent({
      model: VISION_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { text: CHART_DESCRIPTION_PROMPT },
            { inlineData: { data: base64Image, mimeType: "image/png" } },
          ],
        },
      ],
    });

    const text = response.text;

    if (!text) {
      throw new Error("Gemini did not return a chart description.");
    }

    return text;
  });
}

export function hasChartContent(description: string): boolean {
  return description.trim().toLowerCase() !== "no chart on this page.";
}
