import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Helper function to get environment variables that works in both Node.js and browser
const getEnvVariable = (key) => {
  if (typeof process !== 'undefined' && process.env) {
    return process.env[key];
  } else if (typeof import.meta !== 'undefined' && import.meta.env) {
    return import.meta.env[`VITE_${key}`];
  }
  return undefined;
};

// Create directories for downloaded files
const createDirectories = () => {
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const DOWNLOAD_DIR = path.join(__dirname, '..', '..', 'data', 'downloads');
    
    if (!fs.existsSync(DOWNLOAD_DIR)) {
      fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
    }
    
    return DOWNLOAD_DIR;
  } catch (error) {
    console.error('Error creating directories:', error);
    return null;
  }
};

/**
 * Extract PDF links from the document library page
 * @param {string} html - HTML content of the page
 * @param {string} baseUrl - Base URL of the website
 * @returns {Array} - Array of PDF document objects
 */
export async function extractPdfLinks(html, baseUrl) {
  const $ = cheerio.load(html);
  const documents = [];
  
  // Find all document links in the document library
  $('.document-section ul li').each((_, element) => {
    try {
      const linkElement = $(element).find('.document a');
      const categoryElement = $(element).find('.category a');
      
      const pdfUrl = linkElement.attr('href');
      const title = linkElement.text().replace(/\[PDF.*\]$/, '').trim();
      const category = categoryElement.text().trim();
      
      // Only process PDF links
      if (pdfUrl && pdfUrl.toLowerCase().endsWith('.pdf')) {
        // Extract file size if available
        const sizeMatch = linkElement.text().match(/\[PDF\s*-\s*(\d+)\s*KB\]/i);
        const fileSizeKB = sizeMatch ? parseInt(sizeMatch[1], 10) : null;
        
        // Determine document type based on category
        let documentType = 'other';
        if (category.includes('Policies')) {
          documentType = 'policy';
        } else if (category.includes('Reports, Maps & Plans')) {
          documentType = 'report';
        } else if (category.includes('Applications & Forms')) {
          documentType = 'form';
        } else if (category.includes('Publications & Information')) {
          documentType = 'publication';
        }
        
        documents.push({
          id: uuidv4(),
          title: title,
          url: pdfUrl,
          category: category,
          documentType: documentType,
          fileSizeKB: fileSizeKB,
          fileType: 'pdf'
        });
      }
    } catch (error) {
      console.error('Error processing document link:', error);
    }
  });
  
  return documents;
}

/**
 * Crawl the municipal website document library
 * @returns {Promise<Array>} - Array of document objects
 */
export async function crawlDocumentLibrary() {
  const baseUrl = getEnvVariable('MUNICIPAL_WEBSITE_URL') || 'https://www.viewroyal.ca';
  const documentLibraryUrl = `${baseUrl}/EN/main/town/documents.html`;
  const documents = [];
  const errors = [];
  
  console.log(`🌐 Crawling document library: ${documentLibraryUrl}`);
  
  try {
    // Fetch the main document library page
    const response = await fetch(documentLibraryUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch document library: ${response.status} ${response.statusText}`);
    }
    
    const html = await response.text();
    const mainPageDocuments = await extractPdfLinks(html, baseUrl);
    documents.push(...mainPageDocuments);
    
    // Fetch category pages for more documents
    const categoryPages = [
      `${baseUrl}/EN/main/town/documents/policies.html`,
      `${baseUrl}/EN/main/town/documents/reportsplans.html`,
      `${baseUrl}/EN/main/town/documents/publications.html`,
      `${baseUrl}/EN/main/town/documents/applicationsforms.html`
    ];
    
    for (const categoryUrl of categoryPages) {
      try {
        console.log(`Crawling category page: ${categoryUrl}`);
        const categoryResponse = await fetch(categoryUrl);
        if (categoryResponse.ok) {
          const categoryHtml = await categoryResponse.text();
          const categoryDocuments = await extractPdfLinks(categoryHtml, baseUrl);
          
          // Add only documents that aren't already in the list (avoid duplicates)
          for (const doc of categoryDocuments) {
            if (!documents.some(existingDoc => existingDoc.url === doc.url)) {
              documents.push(doc);
            }
          }
        }
      } catch (categoryError) {
        console.error(`Error crawling category page ${categoryUrl}:`, categoryError);
        errors.push({
          url: categoryUrl,
          error: categoryError.message
        });
      }
    }
    
    console.log(`Found ${documents.length} PDF documents`);
    return { documents, errors };
    
  } catch (error) {
    console.error('Error crawling document library:', error);
    errors.push({
      url: documentLibraryUrl,
      error: error.message
    });
    return { documents, errors };
  }
}

/**
 * Download PDF documents
 * @param {Array} documents - Array of document objects
 * @returns {Promise<Array>} - Updated array of document objects with local paths
 */
export async function downloadDocuments(documents) {
  const DOWNLOAD_DIR = createDirectories();
  if (!DOWNLOAD_DIR) {
    throw new Error('Failed to create download directory');
  }
  
  const updatedDocuments = [];
  const errors = [];
  
  console.log(`📥 Downloading ${documents.length} documents...`);
  
  // Process documents in batches to avoid overwhelming the server
  const BATCH_SIZE = 5;
  for (let i = 0; i < documents.length; i += BATCH_SIZE) {
    const batch = documents.slice(i, Math.min(i + BATCH_SIZE, documents.length));
    
    const batchPromises = batch.map(async (document) => {
      try {
        // Skip very large files (optional, adjust threshold as needed)
        if (document.fileSizeKB && document.fileSizeKB > 20000) {
          console.log(`Skipping large file (${document.fileSizeKB} KB): ${document.title}`);
          return {
            ...document,
            skipped: true,
            reason: 'File too large'
          };
        }
        
        console.log(`Downloading: ${document.title}`);
        const response = await fetch(document.url);
        
        if (!response.ok) {
          throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
        }
        
        // Generate a filename based on the document title
        const sanitizedTitle = document.title
          .replace(/[^a-z0-9]/gi, '_')
          .replace(/_+/g, '_')
          .toLowerCase();
        const filename = `${sanitizedTitle}_${uuidv4().substring(0, 8)}.pdf`;
        const filePath = path.join(DOWNLOAD_DIR, filename);
        
        // Save the file
        const buffer = await response.buffer();
        fs.writeFileSync(filePath, buffer);
        
        return {
          ...document,
          localPath: filePath
        };
      } catch (error) {
        console.error(`Error downloading ${document.url}:`, error);
        errors.push({
          url: document.url,
          error: error.message
        });
        return {
          ...document,
          error: error.message
        };
      }
    });
    
    const batchResults = await Promise.all(batchPromises);
    updatedDocuments.push(...batchResults);
    
    // Add a small delay between batches
    if (i + BATCH_SIZE < documents.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  const successCount = updatedDocuments.filter(doc => doc.localPath).length;
  const skippedCount = updatedDocuments.filter(doc => doc.skipped).length;
  const errorCount = updatedDocuments.filter(doc => doc.error).length;
  
  console.log(`📥 Download complete: ${successCount} successful, ${skippedCount} skipped, ${errorCount} failed`);
  
  return { documents: updatedDocuments, errors };
}