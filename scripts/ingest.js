import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { crawlMunicipalWebsite } from '../src/lib/crawler.js';
import { processDocuments } from '../src/lib/processor.js';
import { vectorizeChunks } from '../src/lib/vectorizer.js';

// Load environment variables
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Helper function to get environment variables that works in both Node.js and browser
const getEnvVariable = (key) => {
  if (typeof process !== 'undefined' && process.env) {
    return process.env[key];
  } else if (typeof import.meta !== 'undefined' && import.meta.env) {
    return import.meta.env[`VITE_${key}`];
  }
  return undefined;
};

async function main() {
  try {
    console.log('🔍 Starting municipal data ingestion process...');
    
    // Validate environment variables
    const requiredEnvVars = [
      'PINECONE_API_KEY',
      'PINECONE_ENVIRONMENT',
      'PINECONE_INDEX_NAME',
      'OPENAI_API_KEY',
      'MUNICIPAL_WEBSITE_URL'
    ];
    
    const missingEnvVars = requiredEnvVars.filter(varName => !getEnvVariable(varName));
    if (missingEnvVars.length > 0) {
      console.error(`❌ Missing required environment variables: ${missingEnvVars.join(', ')}`);
      console.error('Please check your .env file and try again.');
      process.exit(1);
    }
    
    // Create data directory if it doesn't exist
    const dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    // Step 1: Crawl the municipal website
    console.log(`🌐 Crawling municipal website: ${getEnvVariable('MUNICIPAL_WEBSITE_URL')}`);
    const crawlResult = await crawlMunicipalWebsite(getEnvVariable('MUNICIPAL_WEBSITE_URL'));
    
    // Save crawl results
    fs.writeFileSync(
      path.join(dataDir, 'crawl-results.json'),
      JSON.stringify(crawlResult, null, 2)
    );
    console.log(`✅ Crawling complete. Found ${crawlResult.documents.length} documents.`);
    
    if (crawlResult.errors.length > 0) {
      console.warn(`⚠️ Encountered ${crawlResult.errors.length} errors during crawling.`);
      fs.writeFileSync(
        path.join(dataDir, 'crawl-errors.json'),
        JSON.stringify(crawlResult.errors, null, 2)
      );
    }
    
    // Step 2: Process documents into chunks
    console.log('📄 Processing documents into chunks...');
    const chunks = await processDocuments(crawlResult.documents);
    
    // Save processed chunks
    fs.writeFileSync(
      path.join(dataDir, 'processed-chunks.json'),
      JSON.stringify(chunks, null, 2)
    );
    console.log(`✅ Processing complete. Created ${chunks.length} chunks.`);
    
    // Step 3: Vectorize chunks and store in Pinecone
    console.log('🧠 Vectorizing chunks and storing in Pinecone...');
    const vectorizeResult = await vectorizeChunks(chunks);
    
    // Save vectorization results
    fs.writeFileSync(
      path.join(dataDir, 'vectorize-results.json'),
      JSON.stringify(vectorizeResult, null, 2)
    );
    console.log(`✅ Vectorization complete. Stored ${vectorizeResult.successCount} vectors in Pinecone.`);
    
    if (vectorizeResult.errors.length > 0) {
      console.warn(`⚠️ Encountered ${vectorizeResult.errors.length} errors during vectorization.`);
      fs.writeFileSync(
        path.join(dataDir, 'vectorize-errors.json'),
        JSON.stringify(vectorizeResult.errors, null, 2)
      );
    }
    
    console.log('🎉 Municipal data ingestion process completed successfully!');
    
  } catch (error) {
    console.error('❌ Error during ingestion process:', error);
    process.exit(1);
  }
}

main();