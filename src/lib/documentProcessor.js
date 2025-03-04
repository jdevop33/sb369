import fs from 'fs';
import pdfParse from 'pdf-parse';
import { v4 as uuidv4 } from 'uuid';

/**
 * Process downloaded PDF documents into chunks
 * @param {Array} documents - Array of document objects with localPath
 * @returns {Promise<Array>} - Array of document chunks
 */
export async function processDocuments(documents) {
  const allChunks = [];
  const errors = [];
  
  console.log(`🔍 Processing ${documents.length} documents...`);
  
  for (const document of documents) {
    try {
      // Skip documents that weren't downloaded successfully
      if (!document.localPath || document.error || document.skipped) {
        continue;
      }
      
      console.log(`Processing document: ${document.title}`);
      
      // Read and parse the PDF
      const dataBuffer = fs.readFileSync(document.localPath);
      const pdfData = await pdfParse(dataBuffer);
      
      // Extract text content
      const text = pdfData.text;
      
      // Extract metadata
      const metadata = extractMetadata(text, document);
      
      // Split the document into chunks
      const chunks = splitIntoChunks(text, document, metadata);
      
      // Add document metadata to each chunk
      chunks.forEach(chunk => {
        chunk.metadata = {
          ...chunk.metadata,
          title: document.title,
          url: document.url,
          category: document.category,
          documentType: document.documentType,
          fileType: document.fileType,
          ...metadata
        };
      });
      
      allChunks.push(...chunks);
      
    } catch (error) {
      console.error(`Error processing document ${document.title}:`, error);
      errors.push({
        id: document.id,
        title: document.title,
        error: error.message
      });
    }
  }
  
  console.log(`🔍 Processing complete. Created ${allChunks.length} chunks.`);
  
  return { chunks: allChunks, errors };
}

/**
 * Extract metadata from document text
 * @param {string} text - Document text content
 * @param {Object} document - Document object
 * @returns {Object} - Extracted metadata
 */
function extractMetadata(text, document) {
  const metadata = {};
  
  // Try to extract document date
  const datePatterns = [
    /(?:Dated|Date):\s*(\w+\s+\d{1,2},?\s+\d{4})/i,
    /(\w+\s+\d{1,2},?\s+\d{4})/i,
    /(\d{1,2}\s+\w+\s+\d{4})/i,
    /(\d{4}-\d{2}-\d{2})/i,
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/i,
    /\b(20\d{2})\b/i  // Just the year as a fallback
  ];
  
  for (const pattern of datePatterns) {
    const match = text.match(pattern);
    if (match) {
      metadata.date = match[1];
      break;
    }
  }
  
  // Try to extract last amended date
  const amendedPatterns = [
    /[Aa]mended\s+on\s+(\w+\s+\d{1,2},?\s+\d{4})/i,
    /[Ll]ast\s+[Aa]mended\s+(\w+\s+\d{1,2},?\s+\d{4})/i,
    /[Aa]mended\s+(\w+\s+\d{1,2},?\s+\d{4})/i,
    /[Rr]evised\s+(\w+\s+\d{1,2},?\s+\d{4})/i
  ];
  
  for (const pattern of amendedPatterns) {
    const match = text.match(pattern);
    if (match) {
      metadata.lastAmended = match[1];
      break;
    }
  }
  
  // Extract bylaw number if applicable
  const bylawNumberPatterns = [
    /[Bb]ylaw\s+[Nn]o\.\s+(\d+-\d+|\d+)/i,
    /[Bb]ylaw\s+(\d+-\d+|\d+)/i,
    /[Bb]ylaw\s+[Nn]umber\s+(\d+-\d+|\d+)/i
  ];
  
  for (const pattern of bylawNumberPatterns) {
    const match = text.match(pattern);
    if (match) {
      metadata.bylawNumber = match[1];
      break;
    }
  }
  
  // Extract tags based on document content
  metadata.tags = extractTags(text, document);
  
  return metadata;
}

/**
 * Extract relevant tags from document content
 * @param {string} text - Document text content
 * @param {Object} document - Document object
 * @returns {Array} - Array of tags
 */
function extractTags(text, document) {
  const tags = [];
  const lowerText = text.toLowerCase();
  
  // Add document type as a tag
  if (document.documentType) {
    tags.push(document.documentType);
  }
  
  // Add category-based tags
  if (document.category) {
    const categoryTag = document.category
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9\s]/g, '')
      .trim()
      .replace(/\s+/g, '-');
    
    if (categoryTag) {
      tags.push(categoryTag);
    }
  }
  
  // Check for common municipal topics
  const topicKeywords = {
    'zoning': /zoning|land use|property|development|building height|setback|residential zone|commercial zone|industrial zone/i,
    'utilities': /utilities|water|sewer|electricity|gas|waste|garbage|recycling/i,
    'traffic': /traffic|parking|vehicle|road|street|highway|speed limit/i,
    'noise': /noise|quiet|sound|decibel|disturbance/i,
    'animals': /animal|pet|dog|cat|livestock|leash/i,
    'business': /business|license|permit|commercial|retail|restaurant|store/i,
    'parks': /park|recreation|playground|trail|green space/i,
    'environmental': /environment|pollution|emission|conservation|sustainable/i,
    'fees': /fee|rate|charge|payment|cost|price/i,
    'enforcement': /enforce|penalty|fine|violation|comply|compliance/i,
    'financial': /financial|budget|fiscal|tax|revenue|expenditure/i,
    'planning': /planning|development|official community plan|ocp|land use/i,
    'housing': /housing|residential|dwelling|apartment|townhouse|affordable/i,
    'transportation': /transportation|transit|bus|cycling|pedestrian|active transportation/i,
    'climate': /climate|greenhouse gas|emission|carbon|sustainability/i,
    'accessibility': /accessibility|disability|barrier|inclusive/i
  };
  
  for (const [topic, regex] of Object.entries(topicKeywords)) {
    if (regex.test(lowerText)) {
      tags.push(topic);
    }
  }
  
  // Extract years
  const yearMatches = text.match(/\b(19|20)\d{2}\b/g);
  if (yearMatches) {
    // Get unique years and add the most recent ones (up to 2)
    const uniqueYears = [...new Set(yearMatches)].sort().reverse().slice(0, 2);
    uniqueYears.forEach(year => tags.push(`year-${year}`));
  }
  
  return [...new Set(tags)]; // Remove duplicates
}

/**
 * Split document text into logical chunks
 * @param {string} text - Document text content
 * @param {Object} document - Document object
 * @param {Object} metadata - Document metadata
 * @returns {Array} - Array of chunks
 */
function splitIntoChunks(text, document, metadata) {
  const chunks = [];
  const MAX_CHUNK_SIZE = 1000; // Maximum characters per chunk
  const MIN_CHUNK_SIZE = 100;  // Minimum characters for a valid chunk
  
  // First, try to split by sections using various patterns
  const sectionPatterns = [
    /\n\s*(?:SECTION|Section|PART|Part|ARTICLE|Article)\s+\d+/g,
    /\n\s*\d+\.\d+\s+[A-Z]/g,
    /\n\s*\d+\.\s+[A-Z]/g,
    /\n\s*[A-Z][A-Z\s]+\n/g,
    /\n\s*[A-Z][a-z].*:\s*\n/g
  ];
  
  let sections = [];
  
  // Try each pattern until we get a reasonable number of sections
  for (const pattern of sectionPatterns) {
    const matches = [...text.matchAll(pattern)];
    
    if (matches.length > 1) {
      sections = [];
      
      for (let i = 0; i < matches.length; i++) {
        const start = matches[i].index;
        const end = i < matches.length - 1 ? matches[i + 1].index : text.length;
        const sectionText = text.substring(start, end).trim();
        
        if (sectionText.length >= MIN_CHUNK_SIZE) {
          sections.push(sectionText);
        }
      }
      
      // If we found a reasonable number of sections, break
      if (sections.length > 0) {
        break;
      }
    }
  }
  
  // If section splitting didn't work well, fall back to paragraph splitting
  if (sections.length <= 1) {
    const paragraphs = text.split(/\n\s*\n/);
    sections = [];
    let currentSection = '';
    
    for (const paragraph of paragraphs) {
      const trimmedParagraph = paragraph.trim();
      
      if (trimmedParagraph.length === 0) {
        continue;
      }
      
      if (currentSection.length + trimmedParagraph.length > MAX_CHUNK_SIZE) {
        if (currentSection.length >= MIN_CHUNK_SIZE) {
          sections.push(currentSection.trim());
        }
        currentSection = trimmedParagraph;
      } else {
        currentSection += '\n\n' + trimmedParagraph;
      }
    }
    
    if (currentSection.length >= MIN_CHUNK_SIZE) {
      sections.push(currentSection.trim());
    }
  }
  
  // Create chunks from sections
  sections.forEach((sectionText, index) => {
    // Extract section title from the first line
    const lines = sectionText.split('\n');
    const sectionTitle = lines[0]?.trim() || `Section ${index + 1}`;
    
    chunks.push({
      id: uuidv4(),
      content: sectionText,
      metadata: {
        section: sectionTitle,
        sectionIndex: index + 1,
        ...metadata
      }
    });
  });
  
  return chunks;
}