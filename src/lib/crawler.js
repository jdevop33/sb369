import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOWNLOAD_DIR = path.join(__dirname, '..', '..', 'data', 'downloads');

// Ensure download directory exists
if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

/**
 * Crawls a municipal website to find bylaws, budgets, and other relevant documents
 * @param {string} baseUrl - The base URL of the municipal website
 * @returns {Promise<import('../types').CrawlResult>} - The crawl results
 */
export async function crawlMunicipalWebsite(baseUrl) {
  const documents = [];
  const errors = [];
  const visitedUrls = new Set();
  const urlsToVisit = [
    `${baseUrl}/EN/main/town/bylaws-all.html`,
    `${baseUrl}/EN/main/town/documents.html`,
    `${baseUrl}/EN/main/town/documents/policies.html`,
    `${baseUrl}/EN/main/town/documents/reportsplans.html`,
    `${baseUrl}/EN/main/town/documents/publications.html`
  ];
  
  console.log(`Starting crawl of ${baseUrl}`);
  
  // For development/testing, limit the number of pages to crawl
  const MAX_PAGES = 50;
  let pageCount = 0;
  
  while (urlsToVisit.length > 0 && pageCount < MAX_PAGES) {
    const url = urlsToVisit.shift();
    
    if (visitedUrls.has(url)) {
      continue;
    }
    
    visitedUrls.add(url);
    pageCount++;
    
    try {
      console.log(`Crawling ${url}`);
      const response = await fetch(url);
      
      if (!response.ok) {
        errors.push({
          url,
          error: `HTTP error ${response.status}: ${response.statusText}`
        });
        continue;
      }
      
      const contentType = response.headers.get('content-type') || '';
      
      // Handle different content types
      if (contentType.includes('text/html')) {
        await processHtmlPage(url, response, documents, urlsToVisit, visitedUrls, baseUrl);
      } else if (contentType.includes('application/pdf')) {
        await processPdfDocument(url, response, documents);
      } else if (url.endsWith('sitemap.xml') || contentType.includes('application/xml') || contentType.includes('text/xml')) {
        await processSitemap(url, response, urlsToVisit, visitedUrls, baseUrl);
      } else {
        console.log(`Skipping unsupported content type: ${contentType} at ${url}`);
      }
      
    } catch (error) {
      console.error(`Error processing ${url}:`, error);
      errors.push({
        url,
        error: error.message
      });
    }
  }
  
  console.log(`Crawl complete. Visited ${visitedUrls.size} pages, found ${documents.length} documents.`);
  
  return {
    documents,
    errors
  };
}

/**
 * Process an HTML page to extract links and document information
 */
async function processHtmlPage(url, response, documents, urlsToVisit, visitedUrls, baseUrl) {
  const html = await response.text();
  const $ = cheerio.load(html);
  
  // Extract page title
  const pageTitle = $('title').text().trim();
  
  // Look for PDF links that might be bylaws or important documents
  $('a[href$=".pdf"]').each((_, element) => {
    const pdfUrl = new URL($(element).attr('href'), url).href;
    const linkText = $(element).text().trim();
    
    // Skip if we've already found this PDF
    if (documents.some(doc => doc.url === pdfUrl)) {
      return;
    }
    
    // Determine document type based on URL and link text
    let documentType = 'other';
    if (/bylaw|ordinance|regulation/i.test(pdfUrl) || /bylaw|ordinance|regulation/i.test(linkText)) {
      documentType = 'bylaw';
    } else if (/budget|financial|fiscal/i.test(pdfUrl) || /budget|financial|fiscal/i.test(linkText)) {
      documentType = 'budget';
    } else if (/report|plan|strategy/i.test(pdfUrl) || /report|plan|strategy/i.test(linkText)) {
      documentType = 'report';
    } else if (/policy/i.test(pdfUrl) || /policy/i.test(linkText)) {
      documentType = 'policy';
    }
    
    // Determine department based on URL path segments
    const urlParts = new URL(pdfUrl).pathname.split('/');
    let department = null;
    const departmentKeywords = [
      'finance', 'planning', 'engineering', 'public-works', 'parks', 
      'recreation', 'fire', 'police', 'water', 'waste', 'transportation'
    ];
    
    for (const part of urlParts) {
      if (departmentKeywords.includes(part.toLowerCase())) {
        department = part;
        break;
      }
    }
    
    // Extract date information if available
    let date = null;
    const dateMatch = linkText.match(/\b(19|20)\d{2}\b/); // Look for years
    if (dateMatch) {
      date = dateMatch[0];
    }
    
    documents.push({
      id: uuidv4(),
      title: linkText || path.basename(pdfUrl),
      url: pdfUrl,
      department,
      documentType,
      fileType: 'pdf',
      date
    });
    
    // Add PDF URL to visit queue to download it later
    urlsToVisit.push(pdfUrl);
  });
  
  // Find links to other pages on the same domain
  $('a[href]').each((_, element) => {
    try {
      const href = $(element).attr('href');
      const fullUrl = new URL(href, url).href;
      
      // Only follow links on the same domain
      if (fullUrl.startsWith(baseUrl) && !visitedUrls.has(fullUrl) && !urlsToVisit.includes(fullUrl)) {
        // Prioritize URLs that likely contain bylaws or important documents
        const lowerUrl = fullUrl.toLowerCase();
        if (
          lowerUrl.includes('bylaw') || 
          lowerUrl.includes('budget') || 
          lowerUrl.includes('finance') || 
          lowerUrl.includes('council') || 
          lowerUrl.includes('department') ||
          lowerUrl.includes('policy') ||
          lowerUrl.includes('document')
        ) {
          urlsToVisit.unshift(fullUrl); // Add to front of queue
        } else {
          urlsToVisit.push(fullUrl); // Add to back of queue
        }
      }
    } catch (error) {
      // Skip invalid URLs
      console.warn(`Invalid URL found: ${$(element).attr('href')}`);
    }
  });
  
  // Check if the current page itself contains bylaw information
  const pageContent = $('body').text();
  if (
    /bylaw|ordinance|regulation/i.test(url) || 
    /bylaw|ordinance|regulation/i.test(pageTitle) ||
    (pageContent && /bylaw no\.\s+\d+/i.test(pageContent))
  ) {
    // This page itself might contain bylaw information
    documents.push({
      id: uuidv4(),
      title: pageTitle,
      url,
      documentType: 'bylaw',
      fileType: 'html',
      content: html
    });
  }
}

/**
 * Process a PDF document
 */
async function processPdfDocument(url, response, documents) {
  // Check if we already have this document
  if (documents.some(doc => doc.url === url)) {
    return;
  }
  
  // Download the PDF for later processing
  const buffer = await response.buffer();
  const filename = `${uuidv4()}.pdf`;
  const filePath = path.join(DOWNLOAD_DIR, filename);
  
  fs.writeFileSync(filePath, buffer);
  
  // Determine document type based on URL
  let documentType = 'other';
  if (/bylaw|ordinance|regulation/i.test(url)) {
    documentType = 'bylaw';
  } else if (/budget|financial|fiscal/i.test(url)) {
    documentType = 'budget';
  } else if (/report|plan|strategy/i.test(url)) {
    documentType = 'report';
  } else if (/policy/i.test(url)) {
    documentType = 'policy';
  }
  
  documents.push({
    id: uuidv4(),
    title: path.basename(url),
    url,
    documentType,
    fileType: 'pdf',
    localPath: filePath
  });
}

/**
 * Process a sitemap XML file
 */
async function processSitemap(url, response, urlsToVisit, visitedUrls, baseUrl) {
  const xml = await response.text();
  const $ = cheerio.load(xml, { xmlMode: true });
  
  // Extract URLs from sitemap
  $('url > loc').each((_, element) => {
    const locUrl = $(element).text().trim();
    
    if (locUrl.startsWith(baseUrl) && !visitedUrls.has(locUrl) && !urlsToVisit.includes(locUrl)) {
      urlsToVisit.push(locUrl);
    }
  });
  
  // Also check for sitemap references
  $('sitemap > loc').each((_, element) => {
    const sitemapUrl = $(element).text().trim();
    
    if (!visitedUrls.has(sitemapUrl) && !urlsToVisit.includes(sitemapUrl)) {
      urlsToVisit.unshift(sitemapUrl); // Prioritize sitemaps
    }
  });
}