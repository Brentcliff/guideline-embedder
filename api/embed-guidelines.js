import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import { PDFLoader } from 'langchain/document_loaders/fs/pdf';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import fs from 'fs';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const pinecone = new Pinecone({
  apiKey: process.env.pcsk_6DQyJ9_PMWJuN4jhCdPY5KwaX2bTf81YZce1ErGFaG8JRkpz1QCidLVe2Tjn8LDh6snVC7,
  environment: process.env.PINECONE_ENVIRONMENT,
});

const index = pinecone.Index(process.env.PINECONE_INDEX);

export default async function handler(req, res) {
  try {
    const { pdf } = req.query;

    if (!pdf) {
      return res.status(400).json({ error: "Missing 'pdf' query parameter" });
    }

    // Download PDF to /tmp
    const tmpPath = `/tmp/guideline.pdf`;
    const buffer = await (await fetch(pdf)).arrayBuffer();
    fs.writeFileSync(tmpPath, Buffer.from(buffer));

    // Load PDF and split
    const loader = new PDFLoader(tmpPath);
    const docs = await loader.load();

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 800,
      chunkOverlap: 100,
    });

    const chunks = await splitter.splitDocuments(docs);

    // Embed + upsert into Pinecone
    for (let i = 0; i < chunks.length; i++) {
      const text = chunks[i].pageContent;

      const embedding = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
      });

      await index.upsert([
        {
          id: `chunk-${Date.now()}-${i}`,
          values: embedding.data[0].embedding,
          metadata: {
            source: 'VA Guide',
            preview: text.slice(0, 100),
          },
        },
      ]);
    }

    res.status(200).json({ message: `✅ Uploaded ${chunks.length} chunks.` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

