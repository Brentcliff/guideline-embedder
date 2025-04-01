import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
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
    
    try {
      const response = await fetch(pdf);
      if (!response.ok) {
        throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}`);
      }
      const buffer = await response.arrayBuffer();
      fs.writeFileSync(tmpPath, Buffer.from(buffer));
      console.log(`Download complete, file size: ${Buffer.from(buffer).length} bytes`);
    } catch (fetchError) {
      console.error('Error downloading PDF:', fetchError);
      return res.status(500).json({ error: 'Failed to download PDF', details: fetchError.message });
    }
    
    // Parse PDF
    let pdfText = '';
    try {
      console.log('Attempting to parse PDF...');
      // We need to use a direct require here to avoid any import issues
      const pdfParse = require('pdf-parse');
      
      if (typeof pdfParse !== 'function') {
        console.error('pdf-parse import is not a function:', typeof pdfParse);
        return res.status(500).json({ error: 'pdf-parse module is not a function' });
      }
      
      // Read the file buffer
      const pdfBuffer = fs.readFileSync(tmpPath);
      console.log(`Read PDF buffer: ${pdfBuffer.length} bytes`);
      
      // Parse the PDF
      const data = await pdfParse(pdfBuffer);
      pdfText = data.text;
      console.log(`PDF parsed successfully, text length: ${pdfText.length} chars`);
    } catch (pdfError) {
      console.error('PDF parsing error:', pdfError);
      return res.status(500).json({ 
        error: 'Failed to parse PDF', 
        details: pdfError.message,
        stack: pdfError.stack
      });
    } finally {
      // Clean up the temp file
      try {
        fs.unlinkSync(tmpPath);
        console.log('Temporary file deleted');
      } catch (e) {
        console.log('Could not delete temp file:', e);
      }
    }
    
    // Split text into chunks
    console.log('Splitting text into chunks...');
    const chunks = [];
    
    // Manual chunking function
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
    
    // Use our own chunking function instead of Langchain's splitter
    const manualChunks = splitTextIntoChunks(pdfText);
    console.log(`Split into ${manualChunks.length} chunks`);
    
    // Embed + upsert into Pinecone
    const batchSize = 10;
    console.log('Beginning embedding process...');
    
    for (let i = 0; i < manualChunks.length; i += batchSize) {
      const batch = manualChunks.slice(i, i + batchSize);
      console.log(`Processing batch ${Math.floor(i/batchSize) + 1} of ${Math.ceil(manualChunks.length/batchSize)}`);
      
      // Process batch in parallel
      await Promise.all(
        batch.map(async (chunk, index) => {
          const text = chunk.pageContent;
          console.log(`Creating embedding for chunk ${i + index} (${text.length} chars)`);
          
          const embedding = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: text,
          });
          
          console.log(`Upserting embedding for chunk ${i + index}`);
          return index.upsert([
            {
              id: `chunk-${Date.now()}-${i + index}`,
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
