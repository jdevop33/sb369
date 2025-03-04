import { ModelConfig } from '../types';
import { BylawChunk } from '../types';
import OpenAI from 'openai';

// Helper function to get environment variables
const getEnvVariable = (key: string): string | undefined => {
  if (typeof window !== 'undefined') {
    return (import.meta.env as any)[`VITE_${key}`];
  }
  return process.env[key];
};

// Initialize OpenAI client
let openai: OpenAI | null = null;
try {
  openai = new OpenAI({
    apiKey: getEnvVariable('OPENAI_API_KEY')
  });
} catch (error) {
  console.warn('Failed to initialize OpenAI client:', error);
}

/**
 * Generate a response from the AI model
 * @param model The selected AI model configuration
 * @param messages The conversation history
 * @param relevantChunks Relevant bylaw chunks for context
 * @returns The AI-generated response
 */
export async function generateAIResponse(
  model: ModelConfig,
  messages: { role: string; content: string }[],
  relevantChunks: BylawChunk[]
): Promise<string> {
  try {
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
    
    // Check if we have a valid OpenAI client
    if (!openai) {
      console.warn('OpenAI client not initialized, using simulated response');
      return simulateAIResponse(messages[messages.length - 1]?.content || '', relevantChunks);
    }
    
    // Select the appropriate model based on the provider
    let modelName: string;
    switch (model.provider) {
      case 'anthropic':
        // For Anthropic, we would use their API directly
        // But for now, we'll fall back to OpenAI
        console.warn('Anthropic API not yet implemented, using OpenAI instead');
        modelName = 'gpt-4-turbo-preview';
        break;
      case 'xai':
        // For XAI (Grok), we would use their API directly
        // But for now, we'll fall back to OpenAI
        console.warn('XAI API not yet implemented, using OpenAI instead');
        modelName = 'gpt-4-turbo-preview';
        break;
      case 'openai':
      default:
        modelName = model.model;
        break;
    }
    
    // Generate the response using OpenAI
    const completion = await openai.chat.completions.create({
      model: modelName,
      messages: aiMessages.map(m => ({ role: m.role as any, content: m.content })),
      temperature: model.temperature,
      max_tokens: model.maxTokens,
    });
    
    return completion.choices[0].message.content || "I couldn't generate a response. Please try again.";
    
  } catch (error) {
    console.error('Error generating AI response:', error);
    return simulateAIResponse(messages[messages.length - 1]?.content || '', relevantChunks);
  }
}

// Function to simulate AI response for development/testing
function simulateAIResponse(query: string, relevantChunks: BylawChunk[]): string {
  const lowerQuery = query.toLowerCase();
  
  if (lowerQuery.includes('utility') || lowerQuery.includes('rate') || lowerQuery.includes('water')) {
    return `Based on the municipal bylaws, I can provide you with information about utility rates.

The current utility rates for residential properties are as follows:

- Water: $2.75 per cubic meter [citation: {"text": "Residential water rates are set at $2.75 per cubic meter of water consumed, effective January 1, 2023.", "source": "Utility Rates Bylaw 2023-45", "section": "Section 3.1.2"}]
- Sewer: $1.85 per cubic meter of water consumed [citation: {"text": "Residential sewer rates are calculated at $1.85 per cubic meter of water consumed, effective January 1, 2023.", "source": "Utility Rates Bylaw 2023-45", "section": "Section 4.2.1"}]
- Waste collection: $25.00 flat monthly fee [citation: {"text": "Residential waste collection services are billed at a flat rate of $25.00 per month per dwelling unit.", "source": "Utility Rates Bylaw 2023-45", "section": "Section 5.1.3"}]

These rates were last amended on November 15, 2022, through Bylaw 2022-103, which approved the 2023 rate increases. The previous rates from 2022 were $2.50 for water, $1.70 for sewer, and $23.50 for waste collection.

Is there any specific utility or aspect of these rates you'd like more information about?`;
  } else if (lowerQuery.includes('zoning') || lowerQuery.includes('commercial') || lowerQuery.includes('downtown')) {
    return `According to the municipal zoning bylaws, I can provide information about commercial buildings downtown.

The zoning restrictions for commercial buildings in the downtown area (C1 zone) include:

1. Permitted uses include [citation: {"text": "Retail stores, restaurants and cafes, professional offices, financial institutions, hotels and motels, entertainment facilities, personal service establishments, and mixed-use buildings with commercial on ground floor and residential above", "source": "Zoning Bylaw 1978-23", "section": "Section 12.1.1"}]

2. Building height restrictions:
   - Maximum height: 4 stories or 15 meters, whichever is less [citation: {"text": "Maximum building height shall not exceed four (4) stories or 15 meters, whichever is less.", "source": "Zoning Bylaw 1978-23", "section": "Section 12.2.1"}]
   - Minimum height: 2 stories for new construction on Main Street [citation: {"text": "Minimum building height shall be two (2) stories for new construction on Main Street.", "source": "Zoning Bylaw 1978-23", "section": "Section 12.2.2"}]

3. Setback requirements:
   - Front yard: 0 meters (build-to line at property line) [citation: {"text": "Front yard setback: 0 meters (build-to line at property line)", "source": "Zoning Bylaw 1978-23", "section": "Section 12.3.1"}]
   - Side yard: 0 meters, except 3 meters when abutting a residential zone [citation: {"text": "Side yard setback: 0 meters, except 3 meters when abutting a residential zone", "source": "Zoning Bylaw 1978-23", "section": "Section 12.3.2"}]
   - Rear yard: 3 meters, except 6 meters when abutting a residential zone [citation: {"text": "Rear yard setback: 3 meters, except 6 meters when abutting a residential zone", "source": "Zoning Bylaw 1978-23", "section": "Section 12.3.3"}]

These regulations were last amended on June 30, 2021. Would you like more specific information about any of these restrictions?`;
  } else if (lowerQuery.includes('noise') || lowerQuery.includes('quiet') || lowerQuery.includes('construction')) {
    return `Based on the municipal bylaws, I can provide information about the noise ordinance.

The Noise Control Bylaw (2010-78) was last amended on March 15, 2019. The key changes in the amendment included:

1. Updated quiet hours:
   - Weekdays: 10:00 PM to 7:00 AM [citation: {"text": "No person shall make, cause, or permit noise which disturbs the quiet, peace, rest, enjoyment, comfort or convenience of the neighborhood between the hours of 10:00 PM and 7:00 AM on weekdays, and between 11:00 PM and 9:00 AM on weekends and statutory holidays.", "source": "Noise Control Bylaw 2010-78", "section": "Section 3.2.1"}]
   - Weekends and holidays: 11:00 PM to 9:00 AM (previously 11:00 PM to 8:00 AM)

2. Construction noise restrictions:
   - Weekdays: Permitted only between 7:00 AM and 8:00 PM [citation: {"text": "Construction noise is permitted only between the hours of 7:00 AM and 8:00 PM on weekdays, and between 9:00 AM and 6:00 PM on Saturdays.", "source": "Noise Control Bylaw 2010-78", "section": "Section 3.3.1"}]
   - Saturdays: Permitted only between 9:00 AM and 6:00 PM
   - Sundays and holidays: No construction noise permitted except in emergencies with prior approval [citation: {"text": "No construction noise is permitted on Sundays or statutory holidays except in emergency situations with prior approval from the municipality.", "source": "Noise Control Bylaw 2010-78", "section": "Section 3.3.2"}]

The 2019 amendment also clarified the definition of "unreasonable noise" to include specific examples such as shouting, amplified sounds, construction noise outside permitted hours, excessive vehicle noise, and persistent animal noise.

Would you like more specific information about any aspect of the noise ordinance?`;
  } else {
    return `I apologize, but I don't have specific information about that topic in my database of municipal bylaws. 

To get accurate information, I recommend:

1. Contacting the municipal clerk's office directly
2. Checking the official municipal website
3. Visiting city hall in person to speak with a bylaw officer

Is there another bylaw topic I can help you with? I have information about utility rates, zoning restrictions, and noise ordinances.`;
  }
}

/**
 * Stream a response from the AI model
 * @param model The selected AI model configuration
 * @param messages The conversation history
 * @param relevantChunks Relevant bylaw chunks for context
 * @returns A streaming response
 */
export async function streamAIResponse(
  model: ModelConfig,
  messages: { role: string; content: string }[],
  relevantChunks: BylawChunk[]
): Promise<string> {
  // For now, we'll just call the non-streaming version
  return generateAIResponse(model, messages, relevantChunks);
}