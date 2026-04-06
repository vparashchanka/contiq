import { NextRequest } from 'next/server';
import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { createClient } from '@/libs/supabase/server';
import { db } from '@/libs/db/db';
import { messages } from '@/libs/db/schemas/messages';
import { chats } from '@/libs/db/schemas/chats';
import { and, asc, eq } from 'drizzle-orm';
import { retrieveContextForChat } from '@/libs/llm/rag';
import { checkAndSpendTokens, TOKEN_COSTS } from '@/libs/db/tokens';
import {transformQuery} from "@/libs/llm/chat";

export const runtime = 'nodejs';

const SOURCES_SENTINEL = '\n\n__SOURCES__';
// Keep at most this many prior turns (user+assistant pairs) to bound context size.
const MAX_HISTORY_TURNS = 10;

export async function POST(req: NextRequest): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { chatId, projectId, message } = (await req.json()) as {
    chatId: string
    projectId: string
    message: string
  };

  const [chat] = await db
    .select({ id: chats.id })
    .from(chats)
    .where(and(eq(chats.id, chatId), eq(chats.userId, user.id)));

  if (!chat) {
    return new Response('Not found', { status: 404 });
  }

  const tokenResult = await checkAndSpendTokens(user.id, TOKEN_COSTS.message, 'Chat message');
  if (!tokenResult.success) {
    return new Response(tokenResult.error, { status: 402 });
  }

  // Fetch existing conversation history before inserting the new message so the
  // new user turn is not double-counted in the messages we send to the LLM.
  const history = await db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(and(eq(messages.chatId, chatId), eq(messages.userId, user.id)))
    .orderBy(asc(messages.createdAt));

  await db.insert(messages).values({
    chatId,
    userId: user.id,
    role: 'user',
    content: message,
    tokensSpent: 0,
  });

  const { systemPrompt, sourcesUsed } = await retrieveContextForChat({
    message,
    history: history.map((historyMessage) => ({
      role: historyMessage.role as 'user' | 'assistant',
      content: historyMessage.content,
    })),
    projectId,
    userId: user.id,
  });

  // Limit history to the last N turns to keep the context window predictable.
  const recentHistory = history.slice(-MAX_HISTORY_TURNS * 2);

  const userMessage = await transformQuery(message, recentHistory[recentHistory.length - 1]?.content || '');

  const result = streamText({
    model: openai('gpt-4o'),
    messages: [
      { role: 'system', content: systemPrompt },
      ...recentHistory.map((historyMessage) => ({
        role: historyMessage.role as 'user' | 'assistant',
        content: historyMessage.content,
      })),
      { role: 'user', content: userMessage },
    ],
    onFinish: async ({ text }) => {
      try {
        await db.insert(messages).values({
          chatId,
          userId: user.id,
          role: 'assistant',
          content: text,
          sourcesUsed,
          tokensSpent: 1,
        });

        await db
          .update(chats)
          .set({ title: message.slice(0, 60) })
          .where(and(eq(chats.id, chatId), eq(chats.title, 'New Chat')));
      } catch (error) {
        console.error('Failed to save assistant message:', error);
      }
    },
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      for await (const textPart of result.textStream) {
        controller.enqueue(encoder.encode(textPart));
      }
      controller.enqueue(encoder.encode(`${SOURCES_SENTINEL}${JSON.stringify(sourcesUsed)}`));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
