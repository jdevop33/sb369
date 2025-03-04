import { queryVectors } from './vectorizer';
import { BylawChunk } from '../types';
import { mockBylawChunks } from './mockData';

/**
 * Retrieve relevant bylaw chunks based on a user query
 * @param query The user's query
 * @param topK Number of chunks to retrieve
 * @returns Array of relevant bylaw chunks
 */
export async function retrieveRelevantChunks(query: string, topK: number = 5): Promise<BylawChunk[]> {
  try {
    // Check if we have the necessary environment variables
    const hasPineconeConfig = 
      import.meta.env.VITE_PINECONE_API_KEY && 
      import.meta.env.VITE_PINECONE_ENVIRONMENT && 
      import.meta.env.VITE_PINECONE_INDEX_NAME;
    
    if (!hasPineconeConfig) {
      console.warn('Pinecone configuration not found, using mock data');
      return getMockRelevantChunks(query);
    }
    
    // Query Pinecone for relevant chunks
    try {
      const chunks = await queryVectors(query, topK);
      return chunks;
    } catch (error) {
      console.error('Error querying Pinecone:', error);
      return getMockRelevantChunks(query);
    }
  } catch (error) {
    console.error('Error retrieving relevant chunks:', error);
    return getMockRelevantChunks(query);
  }
}

/**
 * Get mock relevant chunks for development
 */
function getMockRelevantChunks(query: string): BylawChunk[] {
  // Simple keyword matching for demo purposes
  const lowerQuery = query.toLowerCase();
  
  if (lowerQuery.includes('water') || lowerQuery.includes('utility') || lowerQuery.includes('rate')) {
    return mockBylawChunks.filter(chunk => 
      chunk.metadata.title.includes('Utility') || 
      chunk.content.includes('water') || 
      chunk.content.includes('utility') ||
      chunk.metadata.tags.some(tag => ['utilities', 'water', 'rates'].includes(tag))
    );
  } else if (lowerQuery.includes('zoning') || lowerQuery.includes('commercial') || lowerQuery.includes('downtown')) {
    return mockBylawChunks.filter(chunk => 
      chunk.metadata.title.includes('Zoning') || 
      chunk.content.includes('commercial') || 
      chunk.content.includes('downtown') ||
      chunk.metadata.tags.some(tag => ['zoning', 'commercial', 'downtown'].includes(tag))
    );
  } else if (lowerQuery.includes('noise') || lowerQuery.includes('quiet') || lowerQuery.includes('construction')) {
    return mockBylawChunks.filter(chunk => 
      chunk.metadata.title.includes('Noise') || 
      chunk.content.includes('noise') || 
      chunk.content.includes('quiet') ||
      chunk.metadata.tags.some(tag => ['noise', 'construction', 'restrictions'].includes(tag))
    );
  }
  
  // Default response if no keywords match
  return [];
}