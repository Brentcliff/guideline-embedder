import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import { PDFLoader } from 'langchain/document_loaders/fs/pdf';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Initialize OpenAI and Pinecone
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
  environment: process.env.PINECONE_ENVIRONMENT,
});
const index = pinecone.Index(process.env.PINECONE_INDEX);

// Explicitly install pdf-parse before using PDFLoader
// This is a workaround for Vercel's serverless environment
let pdfParseInstalled = false;
async function ensurePdfParseInstalled() {
  if (!pdfParseInstalled) {
    try {
      // Try to require pdf-parse to check if it's already installed
      const { createRequire } = await import('module');
      const require = createRequire(import.meta.url);
      require('pdf-parse');
      pdfParseInstalled = true;
    } catch (error) {
      console.log('PDF-parse not found, trying to continue anyway...');
      // If not found, we'll just continue and rely on the package.json dependency
    }
  }
}

export default async function handler(req, res) {
  try {
    // Make sure pdf-parse is available
    await ensurePdfParseInstalled();
    
    const { pdf } = req.query;
    if (!pdf) {
      return res.status(400).json({ error: "Missing 'pdf' query parameter" });
    }
    
    // Download PDF to /tmp
    const tmpPath = `/tmp/guideline-${Date.now()}.pdf`;
    const buffer = await (await fetch(pdf)).arrayBuffer();
    fs.writeFileSync(tmpPath, Buffer.from(buffer));
    
    // Load PDF and split
    const loader = new PDFLoader(tmpPath, {
      // Explicitly set pdfjs options to avoid any issues
      pdfjs: {
        disableFontFace: true,
        useSystemFonts: false,
      }
    });
    
    const docs = await loader.load();
    
    // Clean up the temp file
    try {
      fs.unlinkSync(tmpPath);
    } catch (e) {
      console.log('Could not delete temp file:', e);
    }
    
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 800,
      chunkOverlap: 100,
    });
    
    const chunks = await splitter.splitDocuments(docs);
    
    // Embed + upsert into Pinecone
    const batchSize = 10; // Process in smaller batches to avoid timeouts
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      
      // Process batch in parallel
      await Promise.all(
        batch.map(async (chunk, index) => {
          const text = chunk.pageContent;
          const embedding = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: text,
          });
          
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
    
    res.status(200).json({ 
      message: `✅ Successfully uploaded ${chunks.length} chunks.`,
      chunks: chunks.length
    });
  } catch (error) {
    console.error('Handler error:', error);
    res.status(500).json({ 
      error: error.message || 'Internal server error',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}
