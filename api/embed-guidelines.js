// Rebuilding: removed langchain, using manual chunking only v2
import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';

// Initialize OpenAI and Pinecone
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
  environment: process.env.PINECONE_ENVIRONMENT,
});
const index = pinecone.Index(process.env.PINECONE_INDEX);

// Create require function for CommonJS modules
const require = createRequire(import.meta.url);

export default async function handler(req, res) {
  try {
    const { pdf } = req.query;
    if (!pdf) {
      return res.status(400).json({ error: "Missing 'pdf' query parameter" });
    }

    console.log(`Starting process for: ${pdf}`);

    // Download PDF to /tmp
    const tmpPath = `/tmp/guideline-${Date.now()}.pdf`;
    console.log(`Downloading to ${tmpPath}`);

    // Enhanced download process for Dropbox URLs
    try {
      console.log('Fetching from URL:', pdf);
      
      // Follow redirects and set appropriate headers
      const response = await fetch(pdf, {
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/pdf,application/octet-stream'
        }
      });
      
      if (!response.ok) {
        console.error(`Download failed with status: ${response.status} ${response.statusText}`);
        return res.status(400).json({ error: `Failed to download PDF: ${response.status} ${response.statusText}` });
      }
      
      const contentType = response.headers.get('content-type');
      console.log('Content-Type:', contentType);
      
      const buffer = await response.arrayBuffer();
      const pdfBuffer = Buffer.from(buffer);
      
      console.log(`Downloaded file size: ${pdfBuffer.length} bytes`);
      
      // Sanity check to verify it looks like a PDF
      if (pdfBuffer.length >= 5) {
        const header = pdfBuffer.slice(0, 5).toString('ascii');
        console.log('File header:', header);
        if (header !== '%PDF-') {
          console.warn('Warning: File does not have PDF header. Got:', header);
          // Continue anyway, but log the warning
        }
      } else {
        console.error('File too small to be a valid PDF');
        return res.status(400).json({ error: 'Downloaded file is too small to be a valid PDF' });
      }
      
      fs.writeFileSync(tmpPath, pdfBuffer);
      console.log('File written to disk at:', tmpPath);
      
    } catch (fetchError) {
      console.error('Error downloading PDF:', fetchError);
      return res.status(500).json({ error: 'Failed to download PDF', details: fetchError.message });
    }

    // Parse PDF using pdf-parse with enhanced error handling
    let pdfText = '';
    try {
      console.log('Attempting to parse PDF...');
      const pdfParse = require('pdf-parse');

      if (typeof pdfParse !== 'function') {
        console.error('pdf-parse import is not a function:', typeof pdfParse);
        return res.status(500).json({ error: 'pdf-parse module is not a function' });
      }

      const pdfBuffer = fs.readFileSync(tmpPath);
      
      // Use more explicit options for pdf-parse
      const data = await pdfParse(pdfBuffer, {
        max: 0,  // No page limit
        pagerender: function(pageData) { return ''; }, // Skip rendering for speed
        version: 'v2.0.0'  // Use stable version
      });
      
      pdfText = data.text;
      console.log(`PDF parsed successfully: ${pdfText.length} chars, ${data.numpages} pages`);
      
      if (pdfText.length === 0) {
        console.warn('Warning: PDF parsed but contains no text');
      }
      
    } catch (pdfError) {
      console.error('PDF parsing error:', pdfError);
      return res.status(500).json({
        error: 'Failed to parse PDF',
        details: pdfError.message,
        stack: pdfError.stack
      });
    } finally {
      try {
        fs.unlinkSync(tmpPath);
        console.log('Temporary file deleted');
      } catch (e) {
        console.log('Could not delete temp file:', e);
      }
    }

    // Check if we actually got text content
    if (pdfText.length === 0) {
      return res.status(200).json({
        message: "PDF was processed but contained no text to embed",
        chunks: 0
      });
    }

    // Manual chunking
    console.log('Splitting text into chunks...');
    function splitTextIntoChunks(text, chunkSize = 800, overlap = 100) {
      const chunks = [];
      let start = 0;
      while (start < text.length) {
        const end = Math.min(start + chunkSize, text.length);
        chunks.push({
          pageContent: text.slice(start, end),
          metadata: { source: 'VA Guide' }
        });
        start = end - overlap;
      }
      return chunks;
    }

    const manualChunks = splitTextIntoChunks(pdfText);
    console.log(`Split into ${manualChunks.length} chunks`);

    // Embed and upsert to Pinecone
    const batchSize = 10;
    console.log('Beginning embedding process...');
    for (let i = 0; i < manualChunks.length; i += batchSize) {
      const batch = manualChunks.slice(i, i + batchSize);
      console.log(`Processing batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(manualChunks.length / batchSize)}`);

      await Promise.all(
        batch.map(async (chunk, indexInBatch) => {
          const text = chunk.pageContent;
          const embedding = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: text,
          });

          return index.upsert([
            {
              id: `chunk-${Date.now()}-${i + indexInBatch}`,
              values: embedding.data[0].embedding,
              metadata: {
                source: 'VA Guide',
                preview: text.slice(0, 100),
              },
            },
          ]);
        })
      );
    }

    console.log('Process completed successfully');
    res.status(200).json({
      message: `✅ Successfully uploaded ${manualChunks.length} chunks.`,
      chunks: manualChunks.length
    });
  } catch (error) {
    console.error('Unhandled error:', error);
    res.status(500).json({
      error: error.message || 'Internal server error',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}
