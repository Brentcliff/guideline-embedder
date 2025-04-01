// setup.js - Run this before deployment to ensure all dependencies are correctly set up
import { exec } from 'child_process';
import fs from 'fs';

// Function to run shell commands
function runCommand(command) {
  return new Promise((resolve, reject) => {
    console.log(`Running: ${command}`);
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error: ${error.message}`);
        reject(error);
        return;
      }
      if (stderr) {
        console.log(`stderr: ${stderr}`);
      }
      console.log(`stdout: ${stdout}`);
      resolve(stdout);
    });
  });
}

async function setup() {
  try {
    // Make sure pdf-parse is explicitly installed
    await runCommand('npm install pdf-parse@1.1.1 --save');
    
    // Check if pdfjs-dist is installed correctly
    await runCommand('npm install pdfjs-dist@3.11.174 --save');
    
    // Create a simple test to verify pdf-parse works
    const testFile = 'test-pdf-parse.js';
    fs.writeFileSync(testFile, `
      const { createRequire } = await import('module');
      const require = createRequire(import.meta.url);
      const pdfParse = require('pdf-parse');
      console.log('PDF-parse loaded successfully');
    `);
    
    // Try to run the test
    await runCommand('node test-pdf-parse.js');
    fs.unlinkSync(testFile);
    
    console.log('✅ Setup completed successfully!');
  } catch (error) {
    console.error('❌ Setup failed:', error);
    process.exit(1);
  }
}

setup();
