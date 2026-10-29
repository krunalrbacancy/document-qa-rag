"use client";

import { useEffect, useRef, useState } from "react";
import type { ChunkingStrategy } from "@/lib/chunking";

interface Chunk {
  index: number;
  text: string;
  startOffset: number;
  endOffset: number;
  section?: string;
}

interface ChunkEmbedding {
  index: number;
  dimensions: number;
  preview: number[];
  embedding: number[];
}

interface SearchMatch {
  id: number;
  document_name: string;
  chunk_index: number;
  chunk_text: string;
  section?: string | null;
  similarity: number;
}

interface KnowledgeBaseDocument {
  document_name: string;
  chunk_count: number;
}

type StepStatus = "pending" | "active" | "done";

// Keep in sync with MAX_CHUNKS_PER_REQUEST in the embeddings/save API routes.
const BATCH_SIZE = 50;

function toBatches<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function CheckIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={3}
      stroke="currentColor"
      className="h-4 w-4"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4.5 12.75l6 6 9-13.5"
      />
    </svg>
  );
}

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v8H4z"
      />
    </svg>
  );
}

function WarningBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        className="mt-0.5 h-4 w-4 shrink-0"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
        />
      </svg>
      <span>{message}</span>
    </div>
  );
}

const STEP_LABELS = ["Upload", "Chunk", "Embed", "Save", "Search", "Ask"];

function Stepper({ currentStep }: { currentStep: number }) {
  return (
    <div className="flex items-center">
      {STEP_LABELS.map((label, i) => {
        const stepNum = i + 1;
        const status: StepStatus =
          stepNum < currentStep
            ? "done"
            : stepNum === currentStep
              ? "active"
              : "pending";
        return (
          <div key={label} className="flex items-center">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                  status === "done"
                    ? "bg-emerald-500 text-white"
                    : status === "active"
                      ? "bg-indigo-600 text-white"
                      : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-600"
                }`}
              >
                {status === "done" ? <CheckIcon /> : stepNum}
              </div>
              <span
                className={`text-xs font-medium ${
                  status === "pending"
                    ? "text-zinc-400 dark:text-zinc-600"
                    : "text-zinc-700 dark:text-zinc-300"
                }`}
              >
                {label}
              </span>
            </div>
            {stepNum < STEP_LABELS.length && (
              <div
                className={`mx-2 mb-5 h-0.5 w-8 sm:w-16 ${
                  stepNum < currentStep
                    ? "bg-emerald-500"
                    : "bg-zinc-200 dark:bg-zinc-800"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function StepCard({
  stepNum,
  title,
  why,
  children,
}: {
  stepNum: number;
  title: string;
  why: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-none">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">
            {stepNum}
          </span>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            {title}
          </h2>
        </div>
        <p className="pl-8 text-sm text-zinc-500 dark:text-zinc-400">{why}</p>
      </div>
      {children}
    </div>
  );
}

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [useVision, setUseVision] = useState(false);
  const [visionPages, setVisionPages] = useState("");
  const [strategy, setStrategy] = useState<ChunkingStrategy>("character");
  const [chunkSize, setChunkSize] = useState(500);
  const [chunkOverlap, setChunkOverlap] = useState(50);
  const [sentenceOverlap, setSentenceOverlap] = useState(1);
  const [fileName, setFileName] = useState<string | null>(null);
  const [extractedText, setExtractedText] = useState<string | null>(null);
  const [chunks, setChunks] = useState<Chunk[] | null>(null);
  const [embeddings, setEmbeddings] = useState<ChunkEmbedding[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isEmbedding, setIsEmbedding] = useState(false);
  const [embeddingError, setEmbeddingError] = useState<string | null>(null);
  const [embeddingProgress, setEmbeddingProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [embeddingRateLimitSecs, setEmbeddingRateLimitSecs] = useState<
    number | null
  >(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [saveProgress, setSaveProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [saveRateLimitSecs, setSaveRateLimitSecs] = useState<number | null>(
    null
  );

  const [question, setQuestion] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<SearchMatch[] | null>(
    null
  );
  const [searchRateLimitSecs, setSearchRateLimitSecs] = useState<
    number | null
  >(null);

  const [askQuestion, setAskQuestion] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [askAnswer, setAskAnswer] = useState<string | null>(null);
  const [askSources, setAskSources] = useState<SearchMatch[] | null>(null);
  const [askRateLimitSecs, setAskRateLimitSecs] = useState<number | null>(
    null
  );

  const [knowledgeBaseDocs, setKnowledgeBaseDocs] = useState<
    KnowledgeBaseDocument[] | null
  >(null);
  const [showAddDocument, setShowAddDocument] = useState(false);

  useEffect(() => {
    fetch("/api/documents")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data.documents)) {
          setKnowledgeBaseDocs(data.documents);
          if (data.documents.length === 0) {
            setShowAddDocument(true);
          }
        }
      })
      .catch(() => {
        // Non-critical: the knowledge base list is a convenience display,
        // not required for the rest of the app to function.
      });
  }, []);

  function refreshKnowledgeBaseDocs() {
    fetch("/api/documents")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data.documents)) {
          setKnowledgeBaseDocs(data.documents);
        }
      })
      .catch(() => {});
  }

  const currentStep = askAnswer
    ? 6
    : searchResults
      ? 5
      : savedCount !== null
        ? 4
        : embeddings
          ? 4
          : chunks
            ? 3
            : 1;

  function resetResults() {
    setFileName(null);
    setExtractedText(null);
    setChunks(null);
    setEmbeddings(null);
    setError(null);
    setEmbeddingError(null);
    setEmbeddingProgress(null);
    setEmbeddingRateLimitSecs(null);
    setSaveError(null);
    setSavedCount(null);
    setSaveProgress(null);
    setSaveRateLimitSecs(null);
  }

  function chooseFile(file: File | null) {
    setSelectedFile(file);
    resetResults();
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    chooseFile(event.target.files?.[0] ?? null);
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragActive(false);
    const file = event.dataTransfer.files?.[0] ?? null;
    chooseFile(file);
  }

  function handleClearFile() {
    setSelectedFile(null);
    resetResults();
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function startOver() {
    handleClearFile();
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedFile) {
      setError("Please choose a .txt or .pdf file first.");
      return;
    }

    if (strategy === "character" && chunkOverlap >= chunkSize) {
      setError("Chunk overlap must be smaller than chunk size.");
      return;
    }

    const overlap = strategy === "character" ? chunkOverlap : sentenceOverlap;

    setIsLoading(true);
    setError(null);
    setExtractedText(null);
    setChunks(null);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("strategy", strategy);
      formData.append("chunkSize", String(chunkSize));
      formData.append("chunkOverlap", String(overlap));
      const isPdfFile =
        selectedFile.type === "application/pdf" ||
        selectedFile.name.toLowerCase().endsWith(".pdf");
      if (isPdfFile && useVision) {
        formData.append("useVision", "true");
        if (visionPages.trim()) {
          formData.append("visionPages", visionPages.trim());
        }
      }

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }

      setFileName(data.fileName);
      setExtractedText(data.text);
      setChunks(data.chunks);
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  async function waitWithCountdown(
    ms: number,
    onTick: (secondsLeft: number) => void
  ) {
    const totalSeconds = Math.ceil(ms / 1000);
    for (let secondsLeft = totalSeconds; secondsLeft > 0; secondsLeft--) {
      onTick(secondsLeft);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  async function handleGenerateEmbeddings() {
    if (!chunks) return;

    setIsEmbedding(true);
    setEmbeddingError(null);
    setEmbeddings(null);
    setEmbeddingRateLimitSecs(null);

    const batches = toBatches(chunks, BATCH_SIZE);
    const allResults: ChunkEmbedding[] = [];
    setEmbeddingProgress({ done: 0, total: chunks.length });

    try {
      for (const batch of batches) {
        let data: {
          embeddings?: ChunkEmbedding[];
          error?: string;
          retryAfterMs?: number;
        };

        while (true) {
          const response = await fetch("/api/embeddings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chunks: batch.map((c) => ({ index: c.index, text: c.text })),
            }),
          });

          data = await response.json();

          if (response.status === 429 && data.retryAfterMs) {
            await waitWithCountdown(data.retryAfterMs, setEmbeddingRateLimitSecs);
            setEmbeddingRateLimitSecs(null);
            continue;
          }

          if (!response.ok) {
            setEmbeddingError(data.error ?? "Something went wrong.");
            setEmbeddings(allResults.length > 0 ? allResults : null);
            return;
          }

          break;
        }

        allResults.push(...(data.embeddings ?? []));
        setEmbeddingProgress({ done: allResults.length, total: chunks.length });
      }

      setEmbeddings(allResults);
    } catch {
      setEmbeddingError("Could not reach the server. Please try again.");
      setEmbeddings(allResults.length > 0 ? allResults : null);
    } finally {
      setIsEmbedding(false);
      setEmbeddingRateLimitSecs(null);
    }
  }

  async function handleSaveToKnowledgeBase() {
    if (!chunks || !fileName) return;

    setIsSaving(true);
    setSaveError(null);
    setSavedCount(null);
    setSaveRateLimitSecs(null);

    const batches = toBatches(chunks, BATCH_SIZE);
    let totalSaved = 0;
    setSaveProgress({ done: 0, total: chunks.length });

    try {
      for (let i = 0; i < batches.length; i++) {
        let data: { savedCount?: number; error?: string; retryAfterMs?: number };

        while (true) {
          const response = await fetch("/api/save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              documentName: fileName,
              replaceExisting: i === 0,
              chunks: batches[i].map((c) => ({
                index: c.index,
                text: c.text,
                section: c.section,
                embedding: embeddings?.find((e) => e.index === c.index)
                  ?.embedding,
              })),
            }),
          });

          data = await response.json();

          if (response.status === 429 && data.retryAfterMs) {
            await waitWithCountdown(data.retryAfterMs, setSaveRateLimitSecs);
            setSaveRateLimitSecs(null);
            continue;
          }

          if (!response.ok) {
            setSaveError(data.error ?? "Something went wrong.");
            setSavedCount(totalSaved > 0 ? totalSaved : null);
            return;
          }

          break;
        }

        totalSaved += data.savedCount ?? 0;
        setSaveProgress({ done: totalSaved, total: chunks.length });
      }

      setSavedCount(totalSaved);
      refreshKnowledgeBaseDocs();
    } catch {
      setSaveError("Could not reach the server. Please try again.");
      setSavedCount(totalSaved > 0 ? totalSaved : null);
    } finally {
      setIsSaving(false);
      setSaveRateLimitSecs(null);
    }
  }

  async function handleSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!question.trim()) {
      setSearchError("Please enter a question first.");
      return;
    }

    setIsSearching(true);
    setSearchError(null);
    setSearchResults(null);
    setSearchRateLimitSecs(null);

    try {
      let data: {
        matches?: SearchMatch[];
        error?: string;
        retryAfterMs?: number;
      };

      while (true) {
        const response = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question }),
        });

        data = await response.json();

        if (response.status === 429 && data.retryAfterMs) {
          await waitWithCountdown(data.retryAfterMs, setSearchRateLimitSecs);
          setSearchRateLimitSecs(null);
          continue;
        }

        if (!response.ok) {
          setSearchError(data.error ?? "Something went wrong.");
          return;
        }

        break;
      }

      setSearchResults(data.matches ?? []);
    } catch {
      setSearchError("Could not reach the server. Please try again.");
    } finally {
      setIsSearching(false);
      setSearchRateLimitSecs(null);
    }
  }

  async function handleAsk(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!askQuestion.trim()) {
      setAskError("Please enter a question first.");
      return;
    }

    setIsAsking(true);
    setAskError(null);
    setAskAnswer(null);
    setAskSources(null);
    setAskRateLimitSecs(null);

    try {
      let data: {
        answer?: string;
        sources?: SearchMatch[];
        error?: string;
        retryAfterMs?: number;
      };

      while (true) {
        const response = await fetch("/api/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: askQuestion }),
        });

        data = await response.json();

        if (response.status === 429 && data.retryAfterMs) {
          await waitWithCountdown(data.retryAfterMs, setAskRateLimitSecs);
          setAskRateLimitSecs(null);
          continue;
        }

        if (!response.ok) {
          setAskError(data.error ?? "Something went wrong.");
          return;
        }

        break;
      }

      setAskAnswer(data.answer ?? "");
      setAskSources(data.sources ?? []);
    } catch {
      setAskError("Could not reach the server. Please try again.");
    } finally {
      setIsAsking(false);
      setAskRateLimitSecs(null);
    }
  }

  return (
    <div className="min-h-screen bg-linear-to-b from-zinc-50 to-zinc-100 px-6 py-12 font-sans dark:from-black dark:to-zinc-950">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <div className="flex flex-col gap-3 text-center">
          <div className="inline-flex items-center gap-2 self-center rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">
            Learning RAG, step by step
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Chat with Your Documents
          </h1>
          <p className="mx-auto max-w-md text-sm text-zinc-500 dark:text-zinc-400">
            Add a document once, then ask it questions any time afterward —
            no need to re-upload.
          </p>
        </div>

        {/* Knowledge base summary + add-document toggle */}
        <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                Your knowledge base
              </h2>
              {knowledgeBaseDocs === null ? (
                <p className="text-xs text-zinc-400 dark:text-zinc-500">
                  Loading...
                </p>
              ) : knowledgeBaseDocs.length === 0 ? (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  No documents saved yet. Add one below to get started.
                </p>
              ) : (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {knowledgeBaseDocs.length}{" "}
                  {knowledgeBaseDocs.length === 1 ? "document" : "documents"}{" "}
                  saved and ready to search.
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setShowAddDocument((v) => !v)}
              className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {showAddDocument ? "Hide" : "+ Add a document"}
            </button>
          </div>

          {knowledgeBaseDocs && knowledgeBaseDocs.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {knowledgeBaseDocs.map((doc) => (
                <li
                  key={doc.document_name}
                  className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2 text-xs dark:bg-black/20"
                >
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">
                    {doc.document_name}
                  </span>
                  <span className="text-zinc-400 dark:text-zinc-500">
                    {doc.chunk_count}{" "}
                    {doc.chunk_count === 1 ? "chunk" : "chunks"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Steps 1-4: add a new document (collapsed once documents exist) */}
        {showAddDocument && (
          <div className="flex flex-col gap-6">
            <div className="flex justify-center overflow-x-auto rounded-2xl border border-zinc-200 bg-white px-4 py-5 dark:border-zinc-800 dark:bg-zinc-900">
              <Stepper currentStep={currentStep} />
            </div>

            {/* Step 1: Upload */}
            <StepCard
              stepNum={1}
              title="Upload your document"
              why="An AI model can't read a PDF or Word file directly — we first need the plain text out of it before anything else can happen."
            >
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragActive(true);
              }}
              onDragLeave={() => setIsDragActive(false)}
              onDrop={handleDrop}
              className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
                isDragActive
                  ? "border-indigo-400 bg-indigo-50 dark:border-indigo-500 dark:bg-indigo-500/10"
                  : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-700 dark:hover:border-zinc-600"
              }`}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="h-5 w-5"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 16.5V9.75m0 0l-3.75 3.75M12 9.75l3.75 3.75M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z"
                  />
                </svg>
              </div>

              {selectedFile ? (
                <div className="flex flex-col items-center gap-1">
                  <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    {selectedFile.name}
                  </p>
                  <p className="text-xs text-zinc-400 dark:text-zinc-500">
                    {formatFileSize(selectedFile.size)}
                  </p>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleClearFile();
                    }}
                    className="mt-1 text-xs font-medium text-red-500 hover:text-red-600 dark:text-red-400"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-1">
                  <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    <span className="text-indigo-600 dark:text-indigo-400">
                      Click to upload
                    </span>{" "}
                    or drag and drop
                  </p>
                  <p className="text-xs text-zinc-400 dark:text-zinc-500">
                    .txt or .pdf files, up to 10MB
                  </p>
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,text/plain,.pdf,application/pdf"
                onChange={handleFileChange}
                onClick={(e) => e.stopPropagation()}
                className="hidden"
              />
            </div>

            {selectedFile &&
              (selectedFile.type === "application/pdf" ||
                selectedFile.name.toLowerCase().endsWith(".pdf")) && (
                <label className="flex items-start gap-2 rounded-xl bg-zinc-50 p-4 text-xs dark:bg-black/20">
                  <input
                    type="checkbox"
                    checked={useVision}
                    onChange={(e) => setUseVision(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block font-medium text-zinc-700 dark:text-zinc-300">
                      Describe charts and diagrams with AI vision
                    </span>
                    <span className="mt-0.5 block text-zinc-500 dark:text-zinc-400">
                      Plain text extraction scrambles chart data (numbers get
                      separated from their labels). This renders a page as an
                      image and asks Gemini to describe any charts in words
                      first. Uses one AI call per page processed, so on a
                      rate-limited plan it&apos;s best to only target the
                      pages that actually have charts.
                    </span>

                    {useVision && (
                      <span className="mt-2 flex flex-col gap-1">
                        <span className="flex items-center gap-2">
                          <span className="font-medium text-zinc-700 dark:text-zinc-300">
                            Pages to run vision on
                          </span>
                          <input
                            type="text"
                            value={visionPages}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setVisionPages(e.target.value)}
                            placeholder="e.g. 2-3 (blank = all pages)"
                            className="flex-1 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-800 outline-none focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                          />
                        </span>
                        <span className="text-zinc-400 dark:text-zinc-500">
                          Page numbers as shown in a PDF viewer (1 = first
                          page). Leave blank to run vision on every page.
                        </span>
                      </span>
                    )}
                  </span>
                </label>
              )}

            <div className="flex flex-col gap-2 rounded-xl bg-zinc-50 p-4 dark:bg-black/20">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Documents are split into smaller pieces called{" "}
                <strong>chunks</strong> before anything else, so the AI can
                later pull out just the relevant part instead of the whole
                document. Choose how to split it:
              </p>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={() => setStrategy("character")}
                  className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                    strategy === "character"
                      ? "border-indigo-400 bg-indigo-50 dark:border-indigo-500 dark:bg-indigo-500/10"
                      : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:border-zinc-600"
                  }`}
                >
                  <span className="block font-medium text-zinc-800 dark:text-zinc-200">
                    Character-based
                  </span>
                  <span className="mt-0.5 block text-zinc-500 dark:text-zinc-400">
                    Cuts at a fixed number of characters. Simple and
                    predictable, but can split a sentence in half.
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setStrategy("sentence")}
                  className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                    strategy === "sentence"
                      ? "border-indigo-400 bg-indigo-50 dark:border-indigo-500 dark:bg-indigo-500/10"
                      : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:border-zinc-600"
                  }`}
                >
                  <span className="block font-medium text-zinc-800 dark:text-zinc-200">
                    Sentence-based
                  </span>
                  <span className="mt-0.5 block text-zinc-500 dark:text-zinc-400">
                    Groups whole sentences up to the chunk size. Never splits
                    a sentence &mdash; always breaks after a full stop.
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setStrategy("section")}
                  className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                    strategy === "section"
                      ? "border-indigo-400 bg-indigo-50 dark:border-indigo-500 dark:bg-indigo-500/10"
                      : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:border-zinc-600"
                  }`}
                >
                  <span className="block font-medium text-zinc-800 dark:text-zinc-200">
                    Section-based
                  </span>
                  <span className="mt-0.5 block text-zinc-500 dark:text-zinc-400">
                    Detects chapter headings first, then chunks sentences
                    within each chapter. Best for long, structured reports.
                  </span>
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="self-start text-xs font-medium text-zinc-500 underline-offset-2 hover:text-zinc-700 hover:underline dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              {showAdvanced ? "Hide" : "Show"} chunk size &amp; overlap
              settings
            </button>

            {showAdvanced && (
              <div className="flex flex-col gap-4 rounded-xl bg-zinc-50 p-4 dark:bg-black/20">
                <div className="grid grid-cols-2 gap-4">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                      Chunk size (characters)
                    </span>
                    <input
                      type="number"
                      min={1}
                      value={chunkSize}
                      onChange={(e) => setChunkSize(Number(e.target.value))}
                      className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 outline-none focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                    />
                    <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                      {strategy === "character"
                        ? "How many characters go in each chunk."
                        : "The max characters a chunk can hold before starting a new one."}
                    </span>
                  </label>

                  {strategy !== "character" ? (
                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                        Sentence overlap
                      </span>
                      <input
                        type="number"
                        min={0}
                        value={sentenceOverlap}
                        onChange={(e) =>
                          setSentenceOverlap(Number(e.target.value))
                        }
                        className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 outline-none focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                      />
                      <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                        Repeats the last N sentences at the start of the next
                        chunk.
                      </span>
                    </label>
                  ) : (
                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                        Chunk overlap (characters)
                      </span>
                      <input
                        type="number"
                        min={0}
                        value={chunkOverlap}
                        onChange={(e) =>
                          setChunkOverlap(Number(e.target.value))
                        }
                        className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 outline-none focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                      />
                      <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                        Repeats a bit of text between chunks so sentences
                        don&apos;t get cut in half.
                      </span>
                    </label>
                  )}
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading || !selectedFile}
              className="flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-zinc-300 dark:disabled:bg-zinc-700"
            >
              {isLoading && <Spinner />}
              {isLoading ? "Extracting text..." : "Upload & Extract Text"}
            </button>
          </form>

          {error && <WarningBanner message={error} />}
        </StepCard>

        {/* Step 2: Extracted text + Chunks */}
        {chunks !== null && extractedText !== null && (
          <StepCard
            stepNum={2}
            title="Your document, split into chunks"
            why={`We pulled the plain text out of "${fileName}" and cut it into ${chunks.length} overlapping ${chunks.length === 1 ? "piece" : "pieces"}. Each piece is small enough that an AI model can process it precisely.`}
          >
            <details className="group rounded-xl bg-zinc-50 p-4 dark:bg-black/20">
              <summary className="cursor-pointer text-sm font-medium text-zinc-700 marker:content-none dark:text-zinc-300">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block transition-transform group-open:rotate-90">
                    &#9656;
                  </span>
                  View raw extracted text
                </span>
              </summary>
              <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-3 text-xs leading-relaxed text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                {extractedText}
              </pre>
            </details>

            <details className="group rounded-xl bg-zinc-50 p-4 dark:bg-black/20">
              <summary className="cursor-pointer text-sm font-medium text-zinc-700 marker:content-none dark:text-zinc-300">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block transition-transform group-open:rotate-90">
                    &#9656;
                  </span>
                  View {chunks.length}{" "}
                  {chunks.length === 1 ? "chunk" : "chunks"} &middot;{" "}
                  {strategy === "character"
                    ? "character-based"
                    : strategy === "sentence"
                      ? "sentence-based"
                      : "section-based"}{" "}
                  &middot; max {chunkSize} chars &middot;{" "}
                  {strategy === "character"
                    ? `${chunkOverlap} char overlap`
                    : `${sentenceOverlap} sentence overlap`}
                </span>
              </summary>

              <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                {chunks.map((chunk) => {
                  const embedding = embeddings?.find(
                    (e) => e.index === chunk.index
                  );
                  return (
                    <div
                      key={chunk.index}
                      className="rounded-lg border border-zinc-100 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
                    >
                      <div className="mb-2 flex items-center justify-between text-xs text-zinc-400 dark:text-zinc-500">
                        <span className="font-medium text-zinc-600 dark:text-zinc-300">
                          Chunk {chunk.index + 1} of {chunks.length}
                        </span>
                        <span>{chunk.text.length} chars</span>
                      </div>
                      {chunk.section && (
                        <span className="mb-2 inline-block rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">
                          {chunk.section}
                        </span>
                      )}
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                        {chunk.text}
                      </p>

                      {embedding && (
                        <div className="mt-3 flex flex-col gap-1 rounded-lg border border-emerald-100 bg-emerald-50/50 px-3 py-2 text-xs dark:border-emerald-500/20 dark:bg-emerald-500/5">
                          <span className="font-medium text-emerald-700 dark:text-emerald-400">
                            Embedded &middot; {embedding.dimensions} numbers
                          </span>
                          <span className="break-all font-mono text-zinc-500 dark:text-zinc-400">
                            [
                            {embedding.preview
                              .map((n) => n.toFixed(4))
                              .join(", ")}
                            , ...]
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </details>
          </StepCard>
        )}

        {/* Step 3: Embed */}
        {chunks !== null && (
          <StepCard
            stepNum={3}
            title="Turn chunks into embeddings"
            why="An embedding is a list of numbers that captures the meaning of a piece of text. Once chunks become numbers, a computer can compare how similar they are to a question — this is what makes search 'smart' instead of just keyword matching."
          >
            <button
              type="button"
              onClick={handleGenerateEmbeddings}
              disabled={isEmbedding}
              className="flex items-center justify-center gap-2 self-start rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-300 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 dark:disabled:bg-zinc-700 dark:disabled:text-zinc-400"
            >
              {isEmbedding && <Spinner />}
              {isEmbedding
                ? `Generating embeddings... ${embeddingProgress ? `(${embeddingProgress.done}/${embeddingProgress.total})` : ""}`
                : "Generate Embeddings"}
            </button>

            {embeddingRateLimitSecs !== null && (
              <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400">
                <Spinner />
                <span>
                  Gemini&apos;s free tier rate limit was reached. Waiting{" "}
                  {embeddingRateLimitSecs}s before retrying automatically
                  &mdash; this is normal for large documents.
                </span>
              </div>
            )}

            {embeddings && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400">
                Done — embedded {embeddings.length}{" "}
                {embeddings.length === 1 ? "chunk" : "chunks"}. Expand &quot;View
                chunks&quot; above to see each one&apos;s embedding preview.
              </p>
            )}

            {embeddingError && <WarningBanner message={embeddingError} />}
          </StepCard>
        )}

        {/* Step 4: Save */}
        {chunks !== null && (
          <StepCard
            stepNum={4}
            title="Save to your knowledge base"
            why="Right now the chunks and their embeddings only exist in your browser. Saving stores them permanently in a database (Supabase + pgvector) so they can be searched later, even after you close this page."
          >
            <button
              type="button"
              onClick={handleSaveToKnowledgeBase}
              disabled={isSaving}
              className="flex items-center justify-center gap-2 self-start rounded-lg border border-emerald-600 px-4 py-2.5 text-sm font-semibold text-emerald-600 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:border-zinc-300 disabled:text-zinc-400 dark:hover:bg-emerald-500/10 dark:disabled:border-zinc-700"
            >
              {isSaving && <Spinner />}
              {isSaving
                ? `Saving... ${saveProgress ? `(${saveProgress.done}/${saveProgress.total})` : ""}`
                : "Save to Knowledge Base"}
            </button>

            {saveRateLimitSecs !== null && (
              <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400">
                <Spinner />
                <span>
                  Gemini&apos;s free tier rate limit was reached. Waiting{" "}
                  {saveRateLimitSecs}s before retrying automatically &mdash;
                  this is normal for large documents.
                </span>
              </div>
            )}

            {saveError && <WarningBanner message={saveError} />}

            {savedCount !== null && (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                  <CheckIcon />
                </span>
                <span>
                  Saved {savedCount} of {chunks.length} chunks. Re-saving the
                  same file name will replace these chunks, not duplicate
                  them.
                </span>
              </div>
            )}
          </StepCard>
        )}

            {savedCount !== null && (
              <button
                type="button"
                onClick={startOver}
                className="self-center text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
              >
                Upload another document
              </button>
            )}
          </div>
        )}

        <div className="mt-2 flex items-center gap-3">
          <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            Chat with your documents
          </span>
          <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
        </div>

        {/* Step 5: Semantic search */}
        <StepCard
          stepNum={5}
          title="Search your knowledge base"
          why="This looks up the most relevant chunks for a question by meaning, not keywords — the same retrieval step a full RAG chatbot would use before generating an answer. No AI answer is generated yet, just the raw matching chunks."
        >
          <form onSubmit={handleSearch} className="flex flex-col gap-3 sm:flex-row">
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask a question about your saved documents..."
              className="flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-800 outline-none focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
            />
            <button
              type="submit"
              disabled={isSearching}
              className="flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-zinc-300 dark:disabled:bg-zinc-700"
            >
              {isSearching && <Spinner />}
              {isSearching ? "Searching..." : "Search Knowledge Base"}
            </button>
          </form>

          {searchRateLimitSecs !== null && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400">
              <Spinner />
              <span>
                Gemini&apos;s free tier rate limit was reached. Waiting{" "}
                {searchRateLimitSecs}s before retrying automatically.
              </span>
            </div>
          )}

          {searchError && <WarningBanner message={searchError} />}

          {searchResults !== null && (
            <div className="flex flex-col gap-3">
              {searchResults.length === 0 ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  No chunks found. Have you saved a document to the knowledge
                  base yet?
                </p>
              ) : (
                <>
                  <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    Top {searchResults.length} most relevant{" "}
                    {searchResults.length === 1 ? "chunk" : "chunks"}, ranked
                    by similarity:
                  </p>
                  {searchResults.map((match, i) => (
                    <div
                      key={match.id}
                      className="rounded-lg border border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-black/30"
                    >
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400 dark:text-zinc-500">
                        <span className="font-medium text-zinc-600 dark:text-zinc-300">
                          #{i + 1} &middot; {match.document_name} &middot;
                          chunk {match.chunk_index + 1}
                        </span>
                        <span className="rounded-full bg-indigo-50 px-2 py-0.5 font-medium text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">
                          {(match.similarity * 100).toFixed(1)}% similar
                        </span>
                      </div>
                      {match.section && (
                        <span className="mb-2 inline-block rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                          {match.section}
                        </span>
                      )}
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                        {match.chunk_text}
                      </p>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </StepCard>

        {/* Step 6: Ask AI */}
        <StepCard
          stepNum={6}
          title="Ask AI a question"
          why="This is the full RAG loop: retrieve the most relevant chunks (same as Step 5), then hand them to an AI model as context so it can write an actual answer instead of just listing matching text. The answer is grounded only in your saved documents."
        >
          <form onSubmit={handleAsk} className="flex flex-col gap-3 sm:flex-row">
            <input
              type="text"
              value={askQuestion}
              onChange={(e) => setAskQuestion(e.target.value)}
              placeholder="Ask a question and get an AI-generated answer..."
              className="flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-800 outline-none focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
            />
            <button
              type="submit"
              disabled={isAsking}
              className="flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-zinc-300 dark:disabled:bg-zinc-700"
            >
              {isAsking && <Spinner />}
              {isAsking ? "Thinking..." : "Ask AI"}
            </button>
          </form>

          {isAsking && (
            <p className="text-xs text-zinc-400 dark:text-zinc-500">
              This can take anywhere from a few seconds to a couple of
              minutes on Gemini&apos;s free tier, especially on the first
              request &mdash; please be patient.
            </p>
          )}

          {askRateLimitSecs !== null && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400">
              <Spinner />
              <span>
                Gemini&apos;s free tier rate limit was reached. Waiting{" "}
                {askRateLimitSecs}s before retrying automatically.
              </span>
            </div>
          )}

          {askError && <WarningBanner message={askError} />}

          {askAnswer !== null && (
            <div className="flex flex-col gap-4">
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-4 dark:border-indigo-500/20 dark:bg-indigo-500/5">
                <p className="mb-2 text-xs font-medium text-indigo-600 dark:text-indigo-400">
                  AI answer
                </p>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
                  {askAnswer}
                </p>
              </div>

              {askSources && askSources.length > 0 && (
                <details className="group rounded-xl bg-zinc-50 p-4 dark:bg-black/20">
                  <summary className="cursor-pointer text-sm font-medium text-zinc-700 marker:content-none dark:text-zinc-300">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block transition-transform group-open:rotate-90">
                        &#9656;
                      </span>
                      View {askSources.length} source{" "}
                      {askSources.length === 1 ? "chunk" : "chunks"} this
                      answer was grounded in
                    </span>
                  </summary>
                  <div className="mt-3 flex flex-col gap-3">
                    {askSources.map((source, i) => (
                      <div
                        key={source.id}
                        className="rounded-lg border border-zinc-100 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
                      >
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400 dark:text-zinc-500">
                          <span className="font-medium text-zinc-600 dark:text-zinc-300">
                            Source {i + 1} &middot; {source.document_name}{" "}
                            &middot; chunk {source.chunk_index + 1}
                          </span>
                          <span className="rounded-full bg-indigo-50 px-2 py-0.5 font-medium text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">
                            {(source.similarity * 100).toFixed(1)}% similar
                          </span>
                        </div>
                        {source.section && (
                          <span className="mb-2 inline-block rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                            {source.section}
                          </span>
                        )}
                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                          {source.chunk_text}
                        </p>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
        </StepCard>
      </main>
    </div>
  );
}
