import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import { PDFLoader } from 'langchain/document_loaders/fs/pdf';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import fs from 'fs';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pinecone.Index(process.env.PINECONE_INDEX);

export default async function handler(req, res) {
  try {
    const { pdf } = req.query;

    if (!pdf) return res.status(400).json({ error: "Missing 'pdf' query param" });

    const tmpPath = `/tmp/guideline.pdf`;
    const buffer = await (await fetch(pdf)).arrayBuffer();
    fs.writeFileSync(tmpPath, Buffer.from(buffer));

    const loader = new PDFLoader(tmpPath);
    const docs = await loader.load();

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 800,
      chunkOverlap: 100
    });

    const chunks = await splitter.splitDocuments(docs);

    for (let i = 0; i < chunks.length; i++) {
      const text = chunks[i].pageContent;
      const embedding = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: text
      });

      await index.upsert([
        {
          id: `chunk-${Date.now()}-${i}`,
          values: embedding.data[0].embedding,
          metadata: {
            source: "VA Guide",
            preview: text.slice(0, 100)
          }
        }
      ]);
    }

    res.status(200).json({ message: `✅ Uploaded ${chunks.length} chunks.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}


