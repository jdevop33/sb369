import { retrieveRelevantChunks } from '../../lib/retriever';
import { ModelConfig } from '../../types';
import { z } from 'zod';
import { mockBylawChunks } from '../../lib/mockData';
import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { streamText, createDataStreamResponse, generateText } from 'ai';

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

    return createDataStreamResponse({
      execute: async (dataStream) => {
        try {
          // Retrieve relevant chunks based on the user's question
          const relevantChunks = await retrieveRelevantChunks(lastUserMessage.content, 3);
          
          // Stream relevant chunks to the client
          if (relevantChunks.length > 0) {
            dataStream.writeData({
              type: 'relevant_chunks',
              chunks: relevantChunks,
            });
          }
          
          // Create a context from the relevant chunks
          let context = '';
          if (relevantChunks.length > 0) {
            context = 'Here are some relevant bylaw sections that may help answer the question:\n\n';
            relevantChunks.forEach((chunk, index) => {
              context += `Source ${index + 1}: ${chunk.metadata.title}, ${chunk.metadata.section}\n`;
              context += `Content: ${chunk.content}\n`;
              context += `Date: ${chunk.metadata.date}`;
              if (chunk.metadata.lastAmended) {
                context += `, Last Amended: ${chunk.metadata.lastAmended}`;
              }
              context += '\n\n';
            });
          }
          
          // Create a system message with instructions and context
          const systemMessage = {
            role: 'system',
            content: `You are a helpful municipal bylaw assistant. Your purpose is to provide accurate information about municipal bylaws, regulations, and amendments.

Always cite your sources using the format [citation: {"text": "exact text from bylaw", "source": "bylaw name", "section": "section number or name"}].

If you're unsure about something, acknowledge the uncertainty rather than making up information.

Focus on providing factual, up-to-date information based on the most recent amendments.

${context}`
          };
          
          // Prepare messages for the AI, including the system message with context
          const aiMessages = [
            systemMessage,
            ...messages.filter(m => m.role !== 'system')
          ];
          
          // Select the appropriate model based on the provider
          const selectedModel = model || {
            id: 'claude-3-7-sonnet',
            name: 'Claude 3.7 Sonnet',
            provider: 'anthropic',
            model: 'claude-3-7-sonnet-20250219',
            description: 'Anthropic\'s latest model with enhanced reasoning',
            maxTokens: 4096,
            temperature: 0.7
          };
          
          switch (selectedModel.provider) {
            case 'anthropic':
              // Use Claude with reasoning capabilities
              const result = await generateText({
                model: anthropic(selectedModel.model),
                messages: aiMessages,
                temperature: selectedModel.temperature,
                maxTokens: selectedModel.maxTokens,
                providerOptions: {
                  anthropic: {
                    thinking: { type: 'enabled', budgetTokens: 12000 },
                  },
                },
              });
              
              // Write the response to the data stream
              dataStream.writeText(result.text);
              
              // Add annotations with reasoning and relevant chunks
              dataStream.writeMessageAnnotation({ 
                reasoning: result.reasoning,
                reasoningDetails: result.reasoningDetails,
                relevant_chunks: relevantChunks 
              });
              
              break;
              
            case 'xai':
              // TODO: Add support for XAI (Grok) when available in AI SDK
              throw new Error('XAI provider not yet implemented in AI SDK');
              
            case 'openai':
            default:
              // Use streamText for OpenAI
              const openaiResult = streamText({
                model: openai(selectedModel.model),
                messages: aiMessages,
                temperature: selectedModel.temperature,
                maxTokens: selectedModel.maxTokens,
                onFinish: () => {
                  // Add annotations if needed
                  dataStream.writeMessageAnnotation({ 
                    relevant_chunks: relevantChunks 
                  });
                }
              });
              
              // Merge the stream into our data stream
              openaiResult.mergeIntoDataStream(dataStream);
              break;
          }
          
        } catch (error) {
          console.error('Error in chat API:', error);
          dataStream.writeData({
            type: 'error',
            error: 'An error occurred processing your request'
          });
          dataStream.writeMessageAnnotation({ 
            error: 'An error occurred processing your request' 
          });
        }
      }
    });
    
  } catch (error) {
    console.error('Error in chat API:', error);
    return new Response(JSON.stringify({ error: 'An error occurred processing your request' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}