// Rebuilding: removed langchain, using manual chunking only
import { createRequire } from 'module';

// Create require function for CommonJS modules
const require = createRequire(import.meta.url);

// Helper function to convert Dropbox links to direct download links
async function getDirectDownloadURL(url) {
  // Check if it's a Dropbox URL
  if (url.includes('dropbox.com')) {
    // If it already has dl=1, use it directly
    if (url.includes('dl=1')) {
      return url;
    }
    
    // Replace dl=0 with dl=1 if present
    if (url.includes('dl=0')) {
      return url.replace('dl=0', 'dl=1');
    }
    
    // Add dl=1 if no dl parameter
    if (url.includes('?')) {
      return `${url}&dl=1`;
    } else {
      return `${url}?dl=1`;
    }
  }
  
  // Not a Dropbox URL, return as is
  return url;
}

// In embed-guidelines.js
export default async function handler(req, res) {
  const { pdf } = req.query;
  
  if (!pdf) {
    return res.status(400).json({ error: "Missing 'pdf' query parameter" });
  }
  
  const jobId = Date.now().toString();
  
  try {
    // Get direct download URL
    const directUrl = await getDirectDownloadURL(pdf);
    console.log(`Original URL: ${pdf}`);
    console.log(`Direct download URL: ${directUrl}`);
    
    // Use absolute URLs instead of relative ones
    const host = req.headers.host || 'guideline-embedder.vercel.app';
    const processUrl = `https://${host}/api/process-pdf?pdf=${encodeURIComponent(directUrl)}&jobId=${jobId}`;
    console.log(`Calling process-pdf endpoint: ${processUrl}`);
    
    // Use node-fetch options to ensure proper handling
    const processResponse = await fetch(processUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });
    
    // Check if the response is valid JSON
    const contentType = processResponse.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      console.error(`Received non-JSON response: ${contentType}`);
      const text = await processResponse.text();
      console.error(`Response body: ${text.substring(0, 500)}...`);
      return res.status(500).json({ 
        error: 'Invalid response from process-pdf endpoint',
        contentType: contentType,
        responsePreview: text.substring(0, 200)
      });
    }
    
    const processResult = await processResponse.json();
    
    if (!processResponse.ok) {
      console.error('PDF processing failed:', processResult);
      return res.status(processResponse.status).json(processResult);
    }
    
    // Start the embedding process but don't wait for it to complete
    const embedUrl = `https://${host}/api/embed-chunks?jobId=${jobId}`;
    console.log(`Starting background embedding process: ${embedUrl}`);
    
    // Fire and forget
    fetch(embedUrl).catch(error => {
      console.error('Error starting embedding process:', error);
    });
    
    // Respond to the user immediately
    return res.status(200).json({
      message: "PDF processing started",
      jobId: jobId,
      status: `Your document is being processed in the background. Files with more than 10 pages may take 1-2 minutes to complete.`,
      chunks: processResult.chunkCount
    });
    
  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({ error: error.message });
  }
}
