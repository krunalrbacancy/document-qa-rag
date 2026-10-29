import { extractText, getDocumentProxy, renderPageAsImage } from "unpdf";
import { describePageChart, hasChartContent } from "@/lib/vision";

export async function extractPdfText(file: File): Promise<string> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  const pdf = await getDocumentProxy(buffer);
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

const MAX_VISION_PAGES = 30;

// Renders each page as an image and asks Gemini to describe any charts or
// diagrams on it, appending that description after the page's plain text.
// Plain-text extraction reads words in raw document order, which destroys
// the visual layout that connects a chart's numbers to their labels (e.g. a
// bar labeled "445 kg" ends up far away from the text "Baseline emissions"
// that names it) -- vision extraction reads the chart the way a person
// would, preserving those relationships.
//
// `visionPages`, if given, is a set of 1-indexed page numbers to run vision
// on; all other pages use plain text only. There's no reliable way to detect
// "this page has a chart" automatically -- checking for embedded images
// doesn't distinguish an actual chart from decorative icons, and charts are
// often vector graphics with no embedded images at all. Running vision on
// only the pages that need it (instead of every page) keeps API usage
// proportional to the document's actual chart content, which matters a lot
// on a rate-limited free tier where one call per page for a 12-page document
// can use most of a day's quota by itself.
export async function extractPdfTextWithVision(
  file: File,
  visionPages?: Set<number>
): Promise<string> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  const pdf = await getDocumentProxy(buffer);
  const { totalPages, text: pageTexts } = await extractText(pdf);

  if (totalPages > MAX_VISION_PAGES) {
    throw new Error(
      `Vision-based extraction supports documents up to ${MAX_VISION_PAGES} pages (this one has ${totalPages}). Use standard extraction instead.`
    );
  }

  // Pages are processed one at a time, not in parallel: firing one vision
  // call per page simultaneously (e.g. via Promise.all) easily exceeds
  // Gemini's free-tier per-minute request limit for a document with more
  // than a handful of pages, even though the daily quota has room.
  const pages: string[] = [];

  for (let i = 0; i < pageTexts.length; i++) {
    const pageText = pageTexts[i];
    const pageNumber = i + 1;

    if (visionPages && !visionPages.has(pageNumber)) {
      pages.push(pageText);
      continue;
    }

    const imageBuffer = await renderPageAsImage(pdf, pageNumber, {
      scale: 2.0,
      canvasImport: () => import("@napi-rs/canvas"),
    });

    const chartDescription = await describePageChart(imageBuffer);

    pages.push(
      hasChartContent(chartDescription)
        ? `${pageText}\n\n[Chart/diagram on this page, described for search purposes: ${chartDescription}]`
        : pageText
    );
  }

  return pages.join("\n\n");
}
