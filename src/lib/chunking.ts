export interface Chunk {
  index: number;
  text: string;
  startOffset: number;
  endOffset: number;
  section?: string;
}

export function chunkByCharacters(
  text: string,
  chunkSize: number,
  chunkOverlap: number
): Chunk[] {
  if (chunkSize <= 0) {
    throw new Error("chunkSize must be greater than 0.");
  }
  if (chunkOverlap < 0 || chunkOverlap >= chunkSize) {
    throw new Error("chunkOverlap must be between 0 and chunkSize - 1.");
  }

  const chunks: Chunk[] = [];
  const step = chunkSize - chunkOverlap;

  let startOffset = 0;
  let index = 0;

  while (startOffset < text.length) {
    const endOffset = Math.min(startOffset + chunkSize, text.length);

    chunks.push({
      index,
      text: text.slice(startOffset, endOffset),
      startOffset,
      endOffset,
    });

    index += 1;

    if (endOffset === text.length) {
      break;
    }

    startOffset += step;
  }

  return chunks;
}

// Splits on ., !, or ? followed by whitespace, while keeping the punctuation
// attached to its sentence. A simple heuristic -- it doesn't handle
// abbreviations like "Dr." or "e.g." perfectly, but is good enough for
// learning purposes without pulling in an NLP library.
//
// Decimal numbers (e.g. "$79.5 million") need special handling: a "." between
// two digits is never a sentence boundary, so it's temporarily replaced with
// a placeholder before splitting and restored afterward. Without this, text
// like "funding was $79.5 million." gets cut into "...was $79." and
// "5 million." -- silently losing the actual figure.
const DECIMAL_POINT_PLACEHOLDER = "\u0000DECIMAL\u0000";

function splitIntoSentences(text: string): string[] {
  const protectedText = text.replace(
    /(\d)\.(\d)/g,
    `$1${DECIMAL_POINT_PLACEHOLDER}$2`
  );

  const matches = protectedText.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g);

  return (matches ?? [])
    .map((s) =>
      s.trim().replaceAll(DECIMAL_POINT_PLACEHOLDER, ".")
    )
    .filter((s) => s.length > 0);
}

export function chunkBySentences(
  text: string,
  chunkSize: number,
  sentenceOverlap: number
): Chunk[] {
  if (chunkSize <= 0) {
    throw new Error("chunkSize must be greater than 0.");
  }
  if (sentenceOverlap < 0) {
    throw new Error("sentenceOverlap must be 0 or greater.");
  }

  const sentences = splitIntoSentences(text);
  if (sentences.length === 0) {
    return [];
  }

  const chunks: Chunk[] = [];
  let index = 0;
  let searchFrom = 0;
  let sentenceStart = 0;
  // Tracks the first sentence not yet covered by any previous chunk, so we
  // can detect when a chunk is made entirely of overlap with no new content.
  let nextNewSentence = 0;

  while (sentenceStart < sentences.length) {
    const currentSentences: string[] = [];
    let currentLength = 0;
    let i = sentenceStart;

    while (i < sentences.length) {
      const sentence = sentences[i];
      const addedLength =
        currentLength === 0
          ? sentence.length
          : currentLength + 1 + sentence.length;

      if (currentSentences.length > 0 && addedLength > chunkSize) {
        break;
      }

      currentSentences.push(sentence);
      currentLength = addedLength;
      i += 1;
    }

    const hasNewContent = i > nextNewSentence;

    if (hasNewContent) {
      const chunkTextValue = currentSentences.join(" ");
      const startOffset = text.indexOf(currentSentences[0], searchFrom);
      const endOffset = startOffset + chunkTextValue.length;

      chunks.push({
        index,
        text: chunkTextValue,
        startOffset: Math.max(startOffset, 0),
        endOffset,
      });

      index += 1;
      searchFrom = Math.max(startOffset, 0);
    }

    nextNewSentence = i;

    if (i >= sentences.length) {
      break;
    }

    sentenceStart = Math.max(i - sentenceOverlap, sentenceStart + 1);
  }

  return chunks;
}

// Detects top-level chapter headings shaped like structured reports (e.g. the
// World Bank's Global Economic Prospects): a "CHAPTER N" marker immediately
// followed by an ALL-CAPS title line. This is the only heading level that
// survives plain-text PDF extraction reliably -- sub-headings ("Summary",
// "Recent developments") are visually distinct only by font size/weight in
// the original PDF, which plain text extraction discards, so they can't be
// told apart from short body lines using text content alone.
const CHAPTER_HEADING_PATTERN = /CHAPTER (\d+)\n([A-Z][A-Z \-:]+)\n/g;

interface DocumentSection {
  name: string;
  text: string;
}

function splitIntoSections(text: string): DocumentSection[] {
  const headings = [...text.matchAll(CHAPTER_HEADING_PATTERN)];

  if (headings.length === 0) {
    return [{ name: "Full document", text }];
  }

  const sections: DocumentSection[] = [];

  const firstHeadingStart = headings[0].index;
  if (firstHeadingStart > 0) {
    const frontMatter = text.slice(0, firstHeadingStart).trim();
    if (frontMatter.length > 0) {
      sections.push({ name: "Front matter", text: frontMatter });
    }
  }

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    const sectionStart = heading.index + heading[0].length;
    const sectionEnd =
      i + 1 < headings.length ? headings[i + 1].index : text.length;

    sections.push({
      name: `Chapter ${heading[1]}: ${heading[2].trim()}`,
      text: text.slice(sectionStart, sectionEnd).trim(),
    });
  }

  return sections;
}

export function chunkBySection(
  text: string,
  chunkSize: number,
  sentenceOverlap: number
): Chunk[] {
  const sections = splitIntoSections(text);

  const chunks: Chunk[] = [];
  let index = 0;

  for (const section of sections) {
    const sectionChunks = chunkBySentences(
      section.text,
      chunkSize,
      sentenceOverlap
    );

    for (const chunk of sectionChunks) {
      chunks.push({ ...chunk, index, section: section.name });
      index += 1;
    }
  }

  return chunks;
}

export type ChunkingStrategy = "character" | "sentence" | "section";

export function chunkText(
  text: string,
  strategy: ChunkingStrategy,
  chunkSize: number,
  overlap: number
): Chunk[] {
  if (strategy === "section") {
    return chunkBySection(text, chunkSize, overlap);
  }
  return strategy === "sentence"
    ? chunkBySentences(text, chunkSize, overlap)
    : chunkByCharacters(text, chunkSize, overlap);
}
