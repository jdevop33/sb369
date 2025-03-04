import { Pinecone } from '@pinecone-database/pinecone';
import dotenv from 'dotenv';
import OpenAI from 'openai';

// In browser environments, we need to handle the absence of process.env
const getEnvVariable = (key) => {
  // Check if we're in a browser environment
  if (typeof window !== 'undefined') {
    // For browser, we'll use import.meta.env
    const mockEnvVars = {
      PINECONE_API_KEY: import.meta.env.VITE_PINECONE_API_KEY,
      PINECONE_ENVIRONMENT: import.meta.env.VITE_PINECONE_ENVIRONMENT,
      PINECONE_INDEX_NAME: import.meta.env.VITE_PINECONE_INDEX_NAME,
      OPENAI_API_KEY: import.meta.env.VITE_OPENAI_API_KEY,
      ANTHROPIC_API_KEY: import.meta.env.VITE_ANTHROPIC_API_KEY,
      XAI_API_KEY: import.meta.env.VITE_XAI_API_KEY
    };
    return mockEnvVars[key];
  }
  
  // For Node.js environment
  try {
    dotenv.config();
    return process.env[key];
  } catch (error) {
    console.warn('Error accessing process.env:', error);
    return undefined;
  }
};

// Initialize Pinecone client
let pinecone;
try {
  pinecone = new Pinecone({
    apiKey: getEnvVariable('PINECONE_API_KEY'),
    environment: getEnvVariable('PINECONE_ENVIRONMENT'),
  });
} catch (error) {
  console.warn('Failed to initialize Pinecone client:', error.message);
}

// Initialize OpenAI client for embeddings
let openai;
try {
  openai = new OpenAI({
    apiKey: getEnvVariable('OPENAI_API_KEY')
  });
} catch (error) {
  console.warn('Failed to initialize OpenAI client:', error.message);
}

/**
 * Generate embeddings for text using OpenAI
 * @param {string} text - The text to embed
 * @returns {Promise<number[]>} - The embedding vector
 */
async function generateEmbedding(text) {
  if (!openai) {
    console.warn('OpenAI client not initialized, using mock embedding');
    return new Array(1536).fill(0);
  }
  
  try {
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
      encoding_format: "float"
    });
    
    return response.data[0].embedding;
  } catch (error) {
    console.error('Error generating embedding:', error);
    // Return a mock embedding in case of error
    return new Array(1536).fill(0);
  }
}

/**
 * Vectorize chunks and store them in Pinecone
 * @param {import('../types').BylawChunk[]} chunks - The chunks to vectorize
 * @returns {Promise<{successCount: number, errors: Array<{id: string, error: string}>}>} - Result of vectorization
 */
export async function vectorizeChunks(chunks) {
  const errors = [];
  let successCount = 0;
  
  try {
    if (!pinecone) {
      throw new Error('Pinecone client not initialized. Check your API key and environment.');
    }
    
    // Get or create the index
    const indexName = getEnvVariable('PINECONE_INDEX_NAME');
    const indexes = await pinecone.listIndexes();
    
    if (!indexes.some(idx => idx.name === indexName)) {
      console.log(`Creating new Pinecone index: ${indexName}`);
      await pinecone.createIndex({
        name: indexName,
        dimension: 1536, // Dimension for text-embedding-3-small
        metric: 'cosine',
      });
      
      // Wait for index initialization
      await new Promise(resolve => setTimeout(resolve, 60000));
    }
    
    const index = pinecone.index(indexName);
    
    // Process chunks in batches to avoid rate limits
    const BATCH_SIZE = 10;
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      console.log(`Processing batch ${i / BATCH_SIZE + 1} of ${Math.ceil(chunks.length / BATCH_SIZE)}`);
      
      // Process each chunk in the batch
      const batchPromises = batch.map(async (chunk) => {
        try {
          // Generate embedding for the chunk content
          const embedding = await generateEmbedding(chunk.content);
          
          // Prepare metadata (excluding the content which might be too large)
          const metadata = {
            ...chunk.metadata,
            content: chunk.content.slice(0, 1000) + (chunk.content.length > 1000 ? '...' : ''),
            chunkId: chunk.id,
          };
          
          // Upsert the vector to Pinecone
          await index.upsert([{
            id: chunk.id,
            values: embedding,
            metadata
          }]);
          
          successCount++;
          return { success: true, id: chunk.id };
        } catch (error) {
          console.error(`Error vectorizing chunk ${chunk.id}:`, error);
          errors.push({ id: chunk.id, error: error.message });
          return { success: false, id: chunk.id, error: error.message };
        }
      });
      
      await Promise.all(batchPromises);
      
      // Add a small delay between batches to avoid rate limits
      if (i + BATCH_SIZE < chunks.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    console.log(`Vectorization complete. Successfully vectorized ${successCount} chunks.`);
    
    return {
      successCount,
      errors
    };
    
  } catch (error) {
    console.error('Error in vectorization process:', error);
    errors.push({ id: 'global', error: error.message });
    
    return {
      successCount,
      errors
    };
  }
}

/**
 * Query Pinecone for relevant chunks based on a query
 * @param {string} query - The query to search for
 * @param {number} topK - Number of results to return
 * @returns {Promise<import('../types').BylawChunk[]>} - Relevant chunks
 */
export async function queryVectors(query, topK = 5) {
  try {
    if (!pinecone) {
      throw new Error('Pinecone client not initialized. Check your API key and environment.');
    }
    
    // Generate embedding for the query
    const queryEmbedding = await generateEmbedding(query);
    
    // Query Pinecone
    const index = pinecone.index(getEnvVariable('PINECONE_INDEX_NAME'));
    const queryResponse = await index.query({
      vector: queryEmbedding,
      topK,
      includeMetadata: true
    });
    
    // Convert results to BylawChunk format
    return queryResponse.matches.map(match => ({
      id: match.id,
      content: match.metadata.content,
      metadata: {
        title: match.metadata.title,
        section: match.metadata.section,
        date: match.metadata.date,
        lastAmended: match.metadata.lastAmended,
        tags: match.metadata.tags || [],
        url: match.metadata.url,
        department: match.metadata.department,
        documentType: match.metadata.documentType,
        fileType: match.metadata.fileType,
        score: match.score
      }
    }));
    
  } catch (error) {
    console.error('Error querying vectors:', error);
    throw error;
  }
}