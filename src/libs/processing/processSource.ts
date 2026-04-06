import OpenAI from 'openai';
import { db } from '@/libs/db/db';
import { sources } from '@/libs/db/schemas/sources';
import { chunks } from '@/libs/db/schemas/chunks';
import { eq } from 'drizzle-orm';
import { processFile } from './processFile';
import { processUrl } from './processUrl';
import { processText } from './processText';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

const EMBED_BATCH = 100;
const CHUNK_BATCH = 50;

type RawChunk = { content: string; pageNumber?: number; chunkIndex: number }

export async function processSource(sourceId: string): Promise<void> {
  const [source] = await db.select().from(sources).where(eq(sources.id, sourceId));
  if (!source) throw new Error(`Source not found: ${sourceId}`);

  await db.update(sources).set({ status: 'processing' }).where(eq(sources.id, sourceId));

  try {
    let rawChunks: RawChunk[];
    if (source.type === 'url') rawChunks = await processUrl(source);
    else if (source.type === 'text') rawChunks = await processText(source);
    else rawChunks = await processFile(source);

    rawChunks = rawChunks.map((chunk) => ({
      ...chunk,
      content: `
        ---
        Source: ${source.name}
        Type: ${source.type}
        ${source.url ? `URL: ${source.url}` : ''}
        ---
        ${chunk.content.trim()}
      `,
    }));

    const embeddings: number[][] = [];
    for (let i = 0; i < rawChunks.length; i += EMBED_BATCH) {
      const batch = rawChunks.slice(i, i + EMBED_BATCH);
      const res = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: batch.map((c) => c.content),
      });
      for (const item of res.data) embeddings.push(item.embedding);
    }

    for (let i = 0; i < rawChunks.length; i += CHUNK_BATCH) {
      await db.insert(chunks).values(
        rawChunks.slice(i, i + CHUNK_BATCH).map((c, j) => ({
          sourceId: source.id,
          projectId: source.projectId,
          userId: source.userId,
          content: c.content,
          embedding: embeddings[i + j],
          sourceUrl: source.type === 'url' ? source.url : source.storagePath,
          pageNumber: c.pageNumber,
          chunkIndex: c.chunkIndex,
        }))
      );
    }

    await db
      .update(sources)
      .set({ status: 'ready', chunksCount: rawChunks.length })
      .where(eq(sources.id, sourceId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(sources)
      .set({ status: 'error', errorMsg: message })
      .where(eq(sources.id, sourceId));
    throw err;
  }
}
