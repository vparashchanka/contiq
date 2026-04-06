import { embed } from 'ai';
import { openai } from '@ai-sdk/openai';
import { db } from '@/libs/db/db';
import { chunks } from '@/libs/db/schemas/chunks';
import { sources } from '@/libs/db/schemas/sources';
import { and, eq, sql } from 'drizzle-orm';

export type SourceUsed = {
  chunkId: string
  sourceId: string
  sourceType: 'file' | 'url' | 'text'
  sourceUrl: string | null
  sourceName: string
  pageNumber: number | null
}

// Maximum cosine distance (0–2 scale) for a chunk to be considered relevant.
// Lower = stricter. 0.4 filters out chunks that are only loosely related.
const SIMILARITY_THRESHOLD = 0.4;

// Rough character budget for all context blocks combined. gpt-4o-mini has a
// 128k token window; 1 token ≈ 4 chars. 12 000 chars ≈ 3 000 tokens, leaving
// plenty of room for history + system prompt overhead.
const CONTEXT_CHAR_BUDGET = 20_000;

export async function retrieveContextForChat(params: {
  message: string
  history: { role: 'user' | 'assistant'; content: string }[]
  projectId: string
  userId: string
}): Promise<{ systemPrompt: string; sourcesUsed: SourceUsed[] }> {
  const { message, history, projectId, userId } = params;

  // Build a richer query by appending the last assistant reply so the vector
  // search reflects the ongoing conversation, not just the isolated new message.
  const lastAssistantTurn = [...history].reverse().find((turn) => turn.role === 'assistant');
  const enrichedQuery = lastAssistantTurn
    ? `${lastAssistantTurn.content.slice(0, 300)}\n\n${message}`
    : message;

  const { embedding } = await embed({
    model: openai.embedding('text-embedding-3-small'),
    value: enrichedQuery,
  });
  const vectorStr = `[${embedding.join(',')}]`;

  const topChunks = await db
    .select({
      id: chunks.id,
      content: chunks.content,
      sourceId: chunks.sourceId,
      sourceType: sources.type,
      sourceUrl: chunks.sourceUrl,
      pageNumber: chunks.pageNumber,
      sourceName: sources.name,
      distance: sql<number>`chunks.embedding <=> ${vectorStr}::vector`,
    })
    .from(chunks)
    .innerJoin(sources, eq(sources.id, chunks.sourceId))
    .where(
      and(
        eq(chunks.projectId, projectId),
        eq(chunks.userId, userId),
        sql`chunks.embedding <=> ${vectorStr}::vector < ${SIMILARITY_THRESHOLD}`,
      ),
    )
    .orderBy(sql`chunks.embedding <=> ${vectorStr}::vector`)
    .limit(8);

  // Apply token-budget: include chunks greedily until we hit the char cap.
  const budgetedChunks: typeof topChunks = [];
  let charCount = 0;
  for (const chunk of topChunks) {
    if (charCount + chunk.content.length > CONTEXT_CHAR_BUDGET) break;
    budgetedChunks.push(chunk);
    charCount += chunk.content.length;
  }

  const seen = new Set<string>();
  const sourcesUsed: SourceUsed[] = [];
  for (const chunk of budgetedChunks) {
    const key = `${chunk.sourceId}-${chunk.pageNumber ?? 0}`;
    if (!seen.has(key)) {
      seen.add(key);
      sourcesUsed.push({
        chunkId: chunk.id,
        sourceId: chunk.sourceId,
        sourceType: chunk.sourceType,
        sourceUrl: chunk.sourceUrl,
        sourceName: chunk.sourceName,
        pageNumber: chunk.pageNumber,
      });
    }
  }

  const context = budgetedChunks
    .map(
      (chunk, index) =>
        `[${index + 1}] (${chunk.sourceName}${chunk.pageNumber ? `, page ${chunk.pageNumber}` : ''})\n${chunk.content}`,
    )
    .join('\n\n---\n\n');

  const systemPrompt =
    budgetedChunks.length > 0
      ? `You are a helpful AI assistant that answers questions based on the provided project documents.
Use the following document excerpts to answer the user's question. If the answer cannot be found in the provided context, say so honestly.
Answer in the same language as the user's question. Be thorough and detailed.

Context:
${context}`
      : `You are a helpful AI assistant. No relevant documents were found for this project yet.
Answer the user's question to the best of your ability.
Answer in the same language as the user's question.`;

  return { systemPrompt, sourcesUsed };
}
