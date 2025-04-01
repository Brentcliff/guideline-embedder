import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import fs from 'fs';
import { createRequire } from 'module';

// Initialize OpenAI and Pinecone
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
  environment: process.env.PINECONE_ENVIRONMENT,
});
const index = pinecone.Index(process.env.PINECONE_INDEX);

// Create require function for importing CommonJS modules
const require = createRequire(import.meta.url);

export default async function handler(req, res) {
  try {
    const { pdf } = req.query;
    if (!pdf) {
      return res.status(400).json({ error: "Missing 'pdf' query parameter" });
    }
    
    console.log(`Downloading PDF from: ${pdf}`);
    
    // Download PDF to /tmp
    const tmpPath = `/tmp/guideline-${Date.now()}.pdf`;
    const buffer = await (await fetch(pdf)).arrayBuffer();
    fs.writeFileSync(tmpPath, Buffer.from(buffer));
    
    console.log(`PDF downloaded to: ${tmpPath}`);
    
    // Use pdf-parse directly instead of Langchain's PDFLoader
    let pdfText = '';
    try {
      // Dynamically import pdf-parse
      const pdfParse = require('pdf-parse');
      const pdfBuffer = fs.readFileSync(tmpPath);
      
      console.log(`PDF file size: ${pdfBuffer.length} bytes`);
      
      const data = await pdfParse(pdfBuffer);
      pdfText = data.text;
      
      console.log(`Successfully parsed PDF: ${pdfText.length} characters`);
    } catch (pdfError) {
      console.error('PDF parsing error:', pdfError);
      return res.status(500).json({ 
        error: 'Failed to parse PDF document', 
        details: pdfError.message 
      });
    }
    
    // Clean up the temp file
    try {
      fs.unlinkSync(tmpPath);
    } catch (e) {
      console.log('Could not delete temp file:', e);
    }
    
    // Split text into chunks using Langchain's splitter
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 800,
      chunkOverlap: 100,
    });
    
    // Create document-like objects that match Langchain's format
    const doc = { pageContent: pdfText, metadata: { source: tmpPath } };
    const chunks = await splitter.splitDocuments([doc]);
    
    console.log(`Split into ${chunks.length} chunks`);
    
    // Embed + upsert into Pinecone
    const batchSize = 10; // Process in smaller batches to avoid timeouts
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      
      console.log(`Processing batch ${i/batchSize + 1} of ${Math.ceil(chunks.length/batchSize)}`);
      
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
