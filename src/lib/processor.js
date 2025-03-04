import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import * as cheerio from 'cheerio';
import pdfParse from 'pdf-parse';

/**
 * Process documents into chunks suitable for vectorization
 * @param {import('../types').MunicipalDocument[]} documents - The documents to process
 * @returns {Promise<import('../types').BylawChunk[]>} - The processed chunks
 */
export async function processDocuments(documents) {
  const allChunks = [];
  
  for (const document of documents) {
    try {
      console.log(`Processing document: ${document.title}`);
      
      let chunks = [];
      
      if (document.fileType === 'pdf' && document.localPath) {
        chunks = await processPdfDocument(document);
      } else if (document.fileType === 'html' && document.content) {
        chunks = processHtmlDocument(document);
      } else {
        console.warn(`Skipping document with unsupported or missing content: ${document.title}`);
        continue;
      }
      
      // Add document metadata to each chunk
      chunks.forEach(chunk => {
        chunk.metadata = {
          ...chunk.metadata,
          url: document.url,
          department: document.department,
          documentType: document.documentType,
          fileType: document.fileType
        };
      });
      
      allChunks.push(...chunks);
      
    } catch (error) {
      console.error(`Error processing document ${document.title}:`, error);
    }
  }
  
  return allChunks;
}

/**
 * Process a PDF document into chunks
 */
async function processPdfDocument(document) {
  const chunks = [];
  
  try {
    const dataBuffer = fs.readFileSync(document.localPath);
    const pdfData = await pdfParse(dataBuffer);
    
    // Extract text content
    const text = pdfData.text;
    
    // Try to extract document date if not already available
    if (!document.date) {
      const dateMatch = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+(19|20)\d{2}\b/);
      if (dateMatch) {
        document.date = dateMatch[0];
      }
    }
    
    // Try to extract last amended date
    const amendedMatch = text.match(/amended\s+on\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+(19|20)\d{2}/i);
    if (amendedMatch) {
      document.lastAmended = amendedMatch[0].replace(/amended\s+on\s+/i, '');
    }
    
    // Split the document into sections
    const sections = splitIntoSections(text);
    
    // Process each section
    sections.forEach((section, index) => {
      // Extract section title
      const lines = section.split('\n').filter(line => line.trim().length > 0);
      const sectionTitle = lines[0]?.trim() || `Section ${index + 1}`;
      
      // Create a chunk for this section
      chunks.push({
        id: uuidv4(),
        content: section,
        metadata: {
          title: document.title,
          section: sectionTitle,
          date: document.date || 'Unknown',
          lastAmended: document.lastAmended,
          tags: extractTags(section, document.documentType)
        }
      });
    });
    
  } catch (error) {
    console.error(`Error processing PDF ${document.title}:`, error);
  }
  
  return chunks;
}

/**
 * Process an HTML document into chunks
 */
function processHtmlDocument(document) {
  const chunks = [];
  
  try {
    const $ = cheerio.load(document.content);
    
    // Remove navigation, headers, footers, and other non-content elements
    $('nav, header, footer, script, style, .navigation, .menu, .sidebar').remove();
    
    // Find main content area
    const mainContent = $('main, #content, .content, article, .main-content, body').first();
    
    // Extract sections based on headings
    const sections = [];
    let currentSection = '';
    let currentHeading = '';
    
    mainContent.find('h1, h2, h3, h4, h5, h6, p, li, table').each((_, element) => {
      const tagName = element.tagName.toLowerCase();
      
      if (tagName.match(/^h[1-6]$/)) {
        // If we have content in the current section, save it
        if (currentSection.trim().length > 0) {
          sections.push({
            heading: currentHeading,
            content: currentSection
          });
        }
        
        // Start a new section
        currentHeading = $(element).text().trim();
        currentSection = currentHeading + '\n\n';
      } else {
        // Add content to the current section
        currentSection += $(element).text().trim() + '\n\n';
      }
    });
    
    // Add the last section if it has content
    if (currentSection.trim().length > 0) {
      sections.push({
        heading: currentHeading,
        content: currentSection
      });
    }
    
    // Create chunks from sections
    sections.forEach((section, index) => {
      chunks.push({
        id: uuidv4(),
        content: section.content,
        metadata: {
          title: document.title,
          section: section.heading || `Section ${index + 1}`,
          date: document.date || 'Unknown',
          lastAmended: document.lastAmended,
          tags: extractTags(section.content, document.documentType)
        }
      });
    });
    
  } catch (error) {
    console.error(`Error processing HTML ${document.title}:`, error);
  }
  
  return chunks;
}

/**
 * Split text into logical sections based on headings and structure
 */
function splitIntoSections(text) {
  // First, try to split by section headings
  const sectionRegex = /\n\s*(SECTION|Section|Part|PART|ARTICLE|Article)\s+\d+/g;
  const sectionMatches = [...text.matchAll(sectionRegex)];
  
  if (sectionMatches.length > 1) {
    const sections = [];
    
    for (let i = 0; i < sectionMatches.length; i++) {
      const start = sectionMatches[i].index;
      const end = i < sectionMatches.length - 1 ? sectionMatches[i + 1].index : text.length;
      sections.push(text.substring(start, end).trim());
    }
    
    return sections;
  }
  
  // If no clear section markers, try to split by numbered items
  const numberedRegex = /\n\s*\d+\.\d+\s+/g;
  const numberedMatches = [...text.matchAll(numberedRegex)];
  
  if (numberedMatches.length > 3) { // Only use if we have several numbered items
    const sections = [];
    
    for (let i = 0; i < numberedMatches.length; i++) {
      const start = numberedMatches[i].index;
      const end = i < numberedMatches.length - 1 ? numberedMatches[i + 1].index : text.length;
      sections.push(text.substring(start, end).trim());
    }
    
    return sections;
  }
  
  // If no clear structure, split by paragraphs with a maximum length
  const MAX_CHUNK_LENGTH = 1000;
  const paragraphs = text.split(/\n\s*\n/);
  const sections = [];
  let currentSection = '';
  
  for (const paragraph of paragraphs) {
    if (currentSection.length + paragraph.length > MAX_CHUNK_LENGTH) {
      sections.push(currentSection.trim());
      currentSection = paragraph;
    } else {
      currentSection += '\n\n' + paragraph;
    }
  }
  
  if (currentSection.trim().length > 0) {
    sections.push(currentSection.trim());
  }
  
  return sections;
}

/**
 * Extract relevant tags from text content
 */
function extractTags(text, documentType) {
  const tags = [];
  
  // Add document type as a tag
  if (documentType) {
    tags.push(documentType);
  }
  
  // Check for common bylaw topics
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
    'enforcement': /enforce|penalty|fine|violation|comply|compliance/i
  };
  
  for (const [topic, regex] of Object.entries(topicKeywords)) {
    if (regex.test(text)) {
      tags.push(topic);
    }
  }
  
  // Extract specific numbers that might be important
  const bylawNumberMatch = text.match(/bylaw\s+no\.\s+(\d+-\d+|\d+)/i);
  if (bylawNumberMatch) {
    tags.push(`bylaw-${bylawNumberMatch[1]}`);
  }
  
  // Extract years
  const yearMatches = text.match(/\b(19|20)\d{2}\b/g);
  if (yearMatches) {
    yearMatches.slice(0, 2).forEach(year => tags.push(`year-${year}`));
  }
  
  return tags;
}