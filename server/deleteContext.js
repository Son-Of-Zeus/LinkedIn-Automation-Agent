import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

async function deleteContext(contextId) {
  try {
    const response = await fetch(
      `https://api.browserbase.com/v1/contexts/${contextId}`,
      {
        method: 'DELETE',
        headers: {
          'X-BB-API-Key': process.env.BROWSERBASE_API_KEY,
        },
      }
    );
    
    if (response.ok) {
      console.log('Context deleted successfully:', response.status);
    } else {
      const errorBody = await response.text();
      console.error('Error deleting context:', response.status, errorBody);
    }
  } catch (error) {
    console.error('Error deleting context:', error.message);
  }
}

// Pass context ID as command line argument or replace here
const contextId = process.argv[2] || '<context-id>';

if (contextId === '<context-id>') {
  console.log('Usage: node deleteContext.js <context-id>');
  console.log('Example: node deleteContext.js 90b6a7e2-c900-42fa-ae78-6da3ab8d3487');
  process.exit(1);
}

deleteContext(contextId);
