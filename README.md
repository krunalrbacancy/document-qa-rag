# Chat with Your Documents

A RAG (Retrieval-Augmented Generation) learning project built step by step: upload a document, split it into chunks, turn those chunks into embeddings, save them to a vector database, then search and ask questions grounded only in what you've uploaded.

Built with Next.js, TypeScript, Tailwind CSS, Supabase + pgvector, and the Gemini API.

## Getting Started

Copy `.env.example` to `.env.local` and fill in your own Gemini and Supabase credentials, then run the schema in `supabase/schema.sql` against your Supabase project.

This project is pinned to Node 22 (see `.nvmrc`) — `unpdf` and `@napi-rs/canvas` require it for PDF vision extraction.

```bash
nvm use
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## The pipeline

1. **Upload** — extract plain text from a `.txt` or `.pdf` file.
2. **Chunk** — split the text into overlapping pieces (character, sentence, or section-based).
3. **Embed** — turn each chunk into a vector with `gemini-embedding-001`.
4. **Save** — persist chunks and embeddings to Supabase (Postgres + pgvector).
5. **Search** — retrieve the most relevant chunks for a question by meaning, not keywords.
6. **Ask AI** — hand retrieved chunks to Gemini as context so it writes a grounded, cited answer.

## Sample questions to try

These were verified against three real-world reports with different structures — a narrative annual report, a 200-page structured economic outlook, and a report whose key figures live in a chart rather than a sentence.

**GPO Annual Report** (plain text, sentence-based chunking)
- What was GPO's approved funding for FY2018, and how does that compare to the FY1980 appropriation in constant dollars?
- What percentage decline in funding occurred between FY1980 and FY2018?

**World Bank Global Economic Prospects** (200-page report, section-based chunking)
- What is the growth outlook for the East Asia and Pacific region?
- What growth rate is projected for the EAP region over 2026–28, and what's driving it?

**Apple iMac Product Environmental Report** (charts read via AI vision)
- What is the baseline carbon footprint for the iMac, and how much was it reduced through sustainability measures?
- What was the iMac's starting and ending emissions figure?

**Negative test** (checks the app doesn't hallucinate an answer)
- What is the price of the iMac? — none of the three documents mention pricing, so a correct answer states the context doesn't contain that information.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.
