// api/embed-chunks.js
import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import fs from 'fs';

// Initialize OpenAI and Pinecone
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
  environment: process.env.PINECONE_ENVIRONMENT,
});
const index = pinecone.Index(process.env.PINECONE_INDEX);

export default async function handler(req, res) {
  try {
    const { jobId } = req.query;
    if (!jobId) {
      return res.status(400).json({ error: "Missing 'jobId' parameter" });
    }

    // Path to the processed chunks file
    const dataFile = `/tmp/processed-pdfs/${jobId}.json`;
    
    // Check if the file exists
    if (!fs.existsSync(dataFile)) {
      return res.status(404).json({ 
        error: "Job not found. The PDF may not have been processed yet.",
        suggestedAction: "Process the PDF first using the /api/process-pdf endpoint."
      });
    }
    
    // Read the processed chunks
    const processingData = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    const { chunks } = processingData;
    
    if (!chunks || chunks.length === 0) {
      return res.status(400).json({ error: "No text chunks found for embedding" });
    }
    
    console.log(`Embedding ${chunks.length} chunks for job ${jobId}`);
    
    // Process chunks in smaller batches to avoid timeouts
    const batchSize = 5; // Smaller batch size to prevent timeouts
    const maxChunks = req.query.limit ? parseInt(req.query.limit) : chunks.length;
    const startIndex = req.query.start ? parseInt(req.query.start) : 0;
    
    // Only process a subset of chunks in this request
    const endIndex = Math.min(startIndex + maxChunks, chunks.length);
    const chunksToProcess = chunks.slice(startIndex, endIndex);
    
    // Track progress
    let processedCount = 0;
    
    // Process in batches
    for (let i = 0; i < chunksToProcess.length; i += batchSize) {
      const batch = chunksToProcess.slice(i, i + batchSize);
      
      console.log(`Processing batch ${Math.floor(i/batchSize) + 1} of ${Math.ceil(chunksToProcess.length/batchSize)}`);
      
      await Promise.all(
        batch.map(async (chunk) => {
          const text = chunk.pageContent;
          const embedding = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: text,
          });
          
          return index.upsert([
            {
              id: `chunk-${jobId}-${startIndex + processedCount++}`,
              values: embedding.data[0].embedding,
              metadata: {
                source: 'VA Guide',
                preview: text.slice(0, 100),
                jobId: jobId
              },
            },
          ]);
        })
      );
    }
    
    const remainingChunks = chunks.length - (startIndex + processedCount);
    
    if (remainingChunks > 0) {
      // More chunks remain to be processed
      return res.status(200).json({
        message: `Partially processed. ${processedCount} chunks embedded, ${remainingChunks} remaining.`,
        progress: {
          total: chunks.length,
          processed: startIndex + processedCount,
          remaining: remainingChunks
        },
        nextBatch: `/api/embed-chunks?jobId=${jobId}&start=${startIndex + processedCount}&limit=${batchSize * 2}`
      });
    } else {
      // All chunks processed
      return res.status(200).json({
        message: `✅ Successfully embedded all ${chunks.length} chunks.`,
        jobId: jobId
      });
    }
    
  } catch (error) {
    console.error('Embedding error:', error);
    return res.status(500).json({ error: error.message });
  }
}
