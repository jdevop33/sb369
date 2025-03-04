import { retrieveRelevantChunks } from '../../lib/retriever';
import { ModelConfig } from '../../types';
import { z } from 'zod';
import { mockBylawChunks } from '../../lib/mockData';
import { generateAIResponse } from '../../lib/ai';

// Define the expected request body schema
const requestSchema = z.object({
  messages: z.array(
    z.object({
      id: z.string().optional(),
      role: z.enum(['system', 'user', 'assistant']),
      content: z.string(),
      createdAt: z.date().optional(),
    })
  ),
  model: z.object({
    id: z.string(),
    name: z.string(),
    provider: z.string(),
    model: z.string(),
    description: z.string(),
    maxTokens: z.number(),
    temperature: z.number(),
  }).optional(),
});

export async function POST(req: Request) {
  try {
    // Parse and validate the request body
    const body = await req.json();
    const { messages, model } = requestSchema.parse(body);
    
    // Get the last user message
    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
    if (!lastUserMessage) {
      return new Response('No user message found', { status: 400 });
    }
    
    // Retrieve relevant chunks based on the user's question
    const relevantChunks = await retrieveRelevantChunks(lastUserMessage.content, 3);
    
    // Generate a response using the AI model
    const responseText = await generateAIResponse(
      model || {
        id: 'gpt-4-turbo',
        name: 'GPT-4 Turbo',
        provider: 'openai',
        model: 'gpt-4-turbo-preview',
        description: 'Most capable OpenAI model',
        maxTokens: 4096,
        temperature: 0.7
      },
      messages,
      relevantChunks
    );
    
    // Create a streaming response with headers containing metadata
    const headers = new Headers();
    headers.set('Content-Type', 'text/plain; charset=utf-8');
    
    // Add relevant chunks as a header for the client to use
    if (relevantChunks.length > 0) {
      headers.set('x-relevant-chunks', JSON.stringify(relevantChunks));
    }
    
    // Return the response
    return new Response(responseText, { headers });
    
  } catch (error) {
    console.error('Error in chat API:', error);
    return new Response(JSON.stringify({ error: 'An error occurred processing your request' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}