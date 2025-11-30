import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { chromium } from 'playwright-core';
import { Browserbase } from '@browserbasehq/sdk';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '.env');
dotenv.config({ path: envPath });

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { 
  cors: { origin: "http://localhost:5173", methods: ["GET", "POST"] }
});

const BROWSERBASE_API_KEY = process.env.BROWSERBASE_API_KEY;
const BROWSERBASE_PROJECT_ID = process.env.BROWSERBASE_PROJECT_ID;
let CONTEXT_ID = process.env.CONTEXT_ID || '';

function saveContextIdToEnv(contextId) {
  try {
    let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    
    if (envContent.includes('CONTEXT_ID=')) {
      envContent = envContent.replace(/CONTEXT_ID=.*/, `CONTEXT_ID="${contextId}"`);
    } else {
      envContent += `\nCONTEXT_ID="${contextId}"`;
    }
    
    fs.writeFileSync(envPath, envContent.trim() + '\n');
    console.log(`Context ID saved to .env: ${contextId}`);
  } catch (error) {
    console.error('Failed to save context ID to .env:', error.message);
  }
}

const bb = new Browserbase({ apiKey: BROWSERBASE_API_KEY });

let globalSession = null;
let currentContextId = null;
let keepAliveInterval = null;
let isShuttingDown = false;
let isInitializing = false;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function createContext() {
  const context = await bb.contexts.create({ projectId: BROWSERBASE_PROJECT_ID });
  return context.id;
}

async function createSession(contextId) {
  const session = await bb.sessions.create({
    projectId: BROWSERBASE_PROJECT_ID,
    keepAlive: true,
    timeout: 3600,
    proxies: true,
    browserSettings: {
      blockAds: true,
      context: { id: contextId, persist: true },
    },
  });
  return session;
}

async function initSession(socket, emitEvents = true) {
  if (globalSession?.browser?.isConnected()) {
    // Session already exists... just return it without emitting events
    return globalSession;
  }

  if (globalSession) {
    globalSession = null;
    if (keepAliveInterval) {
      clearInterval(keepAliveInterval);
      keepAliveInterval = null;
    }
  }

  if (isInitializing) {
    while (isInitializing) await sleep(500);
    if (globalSession?.browser?.isConnected()) {
      socket.emit('agent-session-start', {
        debugUrl: globalSession.debugUrl,
        sessionId: globalSession.sessionId,
        contextId: currentContextId,
      });
      return globalSession;
    }
  }

  isInitializing = true;
  socket.emit('session-init', { message: 'Initializing session...' });

  try {
    if (CONTEXT_ID) {
      currentContextId = CONTEXT_ID;
    } else {
      currentContextId = await createContext();
      CONTEXT_ID = currentContextId;
      saveContextIdToEnv(currentContextId);
      console.log(`\nNEW CONTEXT: ${currentContextId}\n`);
    }

    const session = await createSession(currentContextId);
    const debug = await bb.sessions.debug(session.id);
    const debugUrl = debug.debuggerFullscreenUrl;

    console.log(`\nDebug url: ${debugUrl}\n`);

    const browser = await chromium.connectOverCDP(session.connectUrl, { timeout: 30000 });
    
    browser.on('disconnected', () => {
      if (!isShuttingDown) globalSession = null;
    });

    const context = browser.contexts()[0];
    const page = context.pages()[0] || await context.newPage();
    
    page.setDefaultNavigationTimeout(60000);
    page.setDefaultTimeout(30000);

    globalSession = { browser, page, sessionId: session.id, debugUrl };

    if (keepAliveInterval) clearInterval(keepAliveInterval);
    keepAliveInterval = setInterval(async () => {
      if (globalSession?.page && !isShuttingDown) {
        try { await globalSession.page.evaluate(() => 1); } catch {}
      }
    }, 30000);

    socket.emit('agent-session-start', { debugUrl, sessionId: session.id, contextId: currentContextId });
    
    // Check if user is logged in by visiting LinkedIn
    try {
      await page.goto('https://www.linkedin.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(2000);
      
      const url = page.url();
      // If redirected to login page the user isn't logged in
      if (url.includes('/login') || url.includes('/checkpoint')) {
        socket.emit('login-status', { loggedIn: false });
      } else {
        socket.emit('login-status', { loggedIn: true });
      }
    } catch (error) {
      socket.emit('login-status', { loggedIn: false });
    }

    isInitializing = false;
    return globalSession;

  } catch (error) {
    isInitializing = false;
    socket.emit('agent-error', { message: error.message });
    throw error;
  }
}

//The selectors for selecting the right element
const SELECTORS = {
  profileName: 'h1.inline.v-align-middle',
  profileHeadline: 'div.text-body-medium.break-words',
  connectButton: 'main button:has-text("Connect"):not(.artdeco-button--muted)',
  likeButton: 'button[aria-label*="Like"]',
  addNoteBtn: 'button:has-text("Add a note")',
  textArea: 'textarea[name="message"], textarea#custom-message',
  sendBtn:'button[aria-label="Send invitation"], button:has-text("Send")',
  sendWithoutNoteBtn: 'button[aria-label="Send without a note"], button:has-text("Send without a note")',
};

async function findElement(page, selector) {
  try {
    const el = page.locator(selector).first();
    if (await el.count() > 0 && await el.isVisible({ timeout: 3000 })) {
      return el;
    }
  } catch {}
  return null;
}

const ACTION_HANDLERS = {
  visit: {
    execute: async (page, profileUrl, socket, index) => {
      socket.emit('node-update', { nodeId: `action-${index}`, status: 'active' });
      
      await page.goto(profileUrl, { waitUntil: 'domcontentloaded' });
      await sleep(2000);
      await page.evaluate(() => window.scrollBy(0, 300));      
      let name = '', headline = '';
      const nameEl = await findElement(page, SELECTORS.profileName);
      if (nameEl) 
      {
        name = (await nameEl.innerText()).trim();
      }
      
      const headEl = await findElement(page, SELECTORS.profileHeadline);
      if (headEl)
        {
          headline = (await headEl.innerText()).trim();
        }      
      socket.emit('node-update', { nodeId: `action-${index}`, status: 'completed', data: { name, headline } });
      return { success: true, data: { name, headline } };
    }
  },
  connect: {
    execute: async (page, profileUrl, socket, index, options = {}) => {
      socket.emit('node-update', { nodeId: `action-${index}`, status: 'active' });
      const btn = await findElement(page, SELECTORS.connectButton);
      if (btn) {
        await btn.scrollIntoViewIfNeeded();
        await sleep(500);
        await btn.click();
        await sleep(1500);
        if (options.message && options.message.trim()) {
          const addNoteBtn = await findElement(page, SELECTORS.addNoteBtn);
          if (addNoteBtn) {
            await addNoteBtn.click();
            await sleep(500);
            
            const textarea = page.locator(SELECTORS.textArea).first();
            if (await textarea.count() > 0) {
              let msg = options.message;
              if (options.profileData) {
                const firstName = options.profileData.name?.split(' ')[0] || '';
                const lastName = options.profileData.name?.split(' ').slice(1).join(' ') || '';
                msg = msg.replace(/\{\{firstName\}\}/g, firstName);
                msg = msg.replace(/\{\{lastName\}\}/g, lastName);
              }
              await textarea.fill(msg);
              await sleep(500);
              
              const sendBtn = await findElement(page, SELECTORS.sendBtn);
              if (sendBtn) {
                await sendBtn.click();
                await sleep(1000);
              }
            }
          }
        } else {
          const sendWithoutNoteBtn = await findElement(page, SELECTORS.sendWithoutNoteBtn);
          if (sendWithoutNoteBtn) {
            await sendWithoutNoteBtn.click();
            await sleep(500);
          } else {
            const sendBtn = await findElement(page, SELECTORS.sendBtn);
            if (sendBtn) {
              await sendBtn.click();
              await sleep(500);
            }
          }
        }
      }
      else
      { 
        //Custom selector for more button (two buttons had the same structure :( )
        const allMoreButtons = await page.locator('button[aria-label="More actions"]').all();        
        let moreBtn = allMoreButtons[1];
        if (moreBtn) {
          await sleep(100);
          await moreBtn.click();
          await sleep(1500);          
          const cbtn = page.locator('.artdeco-dropdown__item[aria-label*="to connect"]').last();
          if (await cbtn.count() > 0) {
            await cbtn.click();
            await sleep(1500);         
            if (options.message && options.message.trim()) {
              const addNoteBtn = await findElement(page, SELECTORS.addNoteBtn);
              if (addNoteBtn) {
                await addNoteBtn.click();
                await sleep(500);        
                const textarea = page.locator(SELECTORS.textArea).first();
                if (await textarea.count() > 0) {
                  let msg = options.message;
                  if (options.profileData) {
                    //First name
                    const firstName = options.profileData.name?.split(' ')[0] || '';
                    //Last name
                    const lastName = options.profileData.name?.split(' ').slice(1).join(' ') || '';
                    msg = msg.replace(/\{\{firstName\}\}/g, firstName);
                    msg = msg.replace(/\{\{lastName\}\}/g, lastName);
                  }
                  await textarea.fill(msg);
                  await sleep(500);
                  
                  const sendBtn = await findElement(page, SELECTORS.sendBtn);
                  if (sendBtn) {
                    await sendBtn.click();
                    await sleep(1000);
                  }
                }
              }
            } else {
              const sendWithoutNoteBtn = await findElement(page, SELECTORS.sendWithoutNoteBtn);
              if (sendWithoutNoteBtn) {
                await sendWithoutNoteBtn.click();
                await sleep(500);
              } else {
                const sendBtn = await findElement(page, SELECTORS.sendBtn);
                if (sendBtn) {
                  await sendBtn.click();
                  await sleep(500);
                }
              }
            }
          } 
        }
      }
      socket.emit('node-update', { nodeId: `action-${index}`, status: 'completed', data: { connected: !!btn } });
      return { success: !!btn };
    }
  },
  like: {
    execute: async (page, profileUrl, socket, index) => {
      socket.emit('node-update', { nodeId: `action-${index}`, status: 'active' });
      await page.evaluate(() => window.scrollBy(0, 800));
      await sleep(1000);
      const btn = await findElement(page, SELECTORS.likeButton);
      if (btn) {
        await btn.click();
      }
      socket.emit('node-update', { nodeId: `action-${index}`, status: 'completed', data: { liked: !!btn } });
      return { success: !!btn };
    }
  }
};

async function runWorkflow(socket, profileUrl, workflow) {
  const session = await initSession(socket, false);
  const { page } = session;
  const results = [];
  let profileData = {};

  for (let i = 0; i < workflow.length; i++) {
    const action = typeof workflow[i] === 'string' ? { type: workflow[i] } : workflow[i];
    const handler = ACTION_HANDLERS[action.type];
    
    if (handler) {
      try {
        const options = {
          message: action.message,
          profileData
        };
        
        const result = await handler.execute(page, profileUrl, socket, i, options);
        
        if (action.type === 'visit' && result.data) {
          profileData = result.data;
        }
        
        if (action.delayMs) await sleep(action.delayMs);
        results.push({ action: action.type, ...result });
      } catch (e) {
        socket.emit('node-update', { nodeId: `action-${i}`, status: 'error' });
      }
    }
  }
  return { status: 'completed', results };
}

async function checkLoginStatus(socket, navigate = false) {
  if (!globalSession?.page) return;
  try {
    const url = globalSession.page.url();
    if (url.includes('/feed') || url.includes('/in/')) {
      socket.emit('login-status', { loggedIn: true });
    } else if (navigate) {
      // Only navigate if requested
      await globalSession.page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      const newUrl = globalSession.page.url();
      socket.emit('login-status', { loggedIn: newUrl.includes('/feed') });
    } else {

      // Just report based on current URL without navigating
      socket.emit('login-status', { loggedIn: false });
    }
  } catch {
    socket.emit('login-status', { loggedIn: false });
  }
}

io.on('connection', (socket) => {
  socket.on('get-session', async () => {
    if (globalSession?.browser?.isConnected()) {
      socket.emit('agent-session-start', {
        debugUrl: globalSession.debugUrl,
        sessionId: globalSession.sessionId,
        contextId: currentContextId,
      });
      // Check login status without navigating
      await checkLoginStatus(socket, false);
    } else if (!isInitializing) {
      await initSession(socket, true);
    } else {
      while (isInitializing) await sleep(500);
      if (globalSession?.browser?.isConnected()) {
        socket.emit('agent-session-start', {
          debugUrl: globalSession.debugUrl,
          sessionId: globalSession.sessionId,
          contextId: currentContextId,
        });
        await checkLoginStatus(socket, false);
      }
    }
  });

  socket.on('start-campaign', async ({ urls, workflow }) => {
    if (!globalSession?.browser?.isConnected()) {
      await initSession(socket, true);
    }
    if (!globalSession) {
      socket.emit('agent-error', { message: 'No browser session' });
      return;
    }
    
    const actions = workflow?.length ? workflow : [{ type: 'visit' }];

    for (let i = 0; i < urls.length; i++) {
      await runWorkflow(socket, urls[i], actions);
      socket.emit('campaign-progress', { current: i + 1, total: urls.length });
      if (i < urls.length - 1) await sleep(5000);
      socket.emit('reset-graph');
    }
    socket.emit('campaign-finished');
  });

  socket.on('save-session', async () => await shutdown());
});

//Shutdown the instance saving the auth cookies
async function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log('\nShutting down...');
  if (keepAliveInterval) clearInterval(keepAliveInterval);

  if (globalSession) {
    try {
      await globalSession.browser.close();
      console.log('Session saved');
    } catch {}

    try {
      await bb.sessions.update(globalSession.sessionId, { 
        status: 'REQUEST_RELEASE', 
        projectId: BROWSERBASE_PROJECT_ID 
      });
    } catch {}
  }

  if (currentContextId) console.log(`Context: ${currentContextId}`);
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

httpServer.listen(3001, () => {
  console.log('Server: http://localhost:3001');
  console.log(`Context: ${CONTEXT_ID || '(new)'}`);
});
