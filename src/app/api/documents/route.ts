import { NextResponse } from "next/server";
import { listKnowledgeBaseDocuments } from "@/lib/supabase";

export async function GET() {
  try {
    const documents = await listKnowledgeBaseDocuments();
    return NextResponse.json({ documents });
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "Failed to list the knowledge base.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
