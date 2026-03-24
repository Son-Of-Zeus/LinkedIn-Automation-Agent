import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { Browserbase } from '@browserbasehq/sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

async function deleteContext(contextId) {
  try {
    if (!process.env.BROWSERBASE_API_KEY) {
      throw new Error('Missing BROWSERBASE_API_KEY in server/.env');
    }

    const bb = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY });
    await bb.contexts.delete(contextId);
    console.log('Context deleted successfully');
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
