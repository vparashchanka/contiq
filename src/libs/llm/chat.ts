import { openai } from '@ai-sdk/openai';

export async function transformQuery(message: string, context: string): Promise<string> {
  const transformPrompt = `
You are a search query optimizer for a RAG system.

Given the conversation history and the user's latest question,
rewrite the question into a standalone, detailed search query
that will find the most relevant information in legal documents.

Rules:
- Make it self-contained (no references to "you said", "that", "it")
- Use formal language close to legal/document terminology
- Expand abbreviations and implicit references
- If the question references previous context, include that context
- Return ONLY the rewritten query, nothing else
- Return query in the same language as user request (if query in russian, return in russian, if in english, return in english)

Conversation context (if applicable):
${context}

User question: ${message}
`;

  const result = await openai('gpt-4o-mini').doGenerate({
    prompt: [{
      role: 'system',
      content: transformPrompt,
    }],
  });

  const textItem = result.content.find(({type}) => type === 'text');
  if (textItem && textItem.type === 'text') {
    return textItem.text;
  } else {
    return message;
  }
}
