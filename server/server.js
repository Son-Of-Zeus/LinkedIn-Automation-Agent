import express from 'express';
import cors from 'cors';
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
app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

const BROWSERBASE_API_KEY = process.env.BROWSERBASE_API_KEY;
const BROWSERBASE_PROJECT_ID = process.env.BROWSERBASE_PROJECT_ID;
let CONTEXT_ID = process.env.CONTEXT_ID || '';

if (!BROWSERBASE_API_KEY) {
  console.error('Missing BROWSERBASE_API_KEY in server/.env');
  process.exit(1);
}

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
let isShuttingDown = false;
let isInitializing = false;

// Job state management for polling
let currentJob = null;
let jobEvents = [];
let eventIdCounter = 0;
let heartbeatInterval = null;

const CDP_HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
const DESKTOP_VIEWPORT = { width: 1440, height: 900 };

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Add event to the queue for polling
function addEvent(type, data = {}) {
  jobEvents.push({
    id: ++eventIdCounter,
    type,
    data,
    timestamp: Date.now()
  });
  // Keep only last 100 events
  if (jobEvents.length > 100) {
    jobEvents = jobEvents.slice(-100);
  }
}

function withOptionalProjectId(payload = {}) {
  if (BROWSERBASE_PROJECT_ID) {
    return { ...payload, projectId: BROWSERBASE_PROJECT_ID };
  }
  return payload;
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

function startHeartbeat(page) {
  stopHeartbeat();

  // Browserbase CDP connections can close after inactivity; keep the page warm.
  heartbeatInterval = setInterval(async () => {
    if (!globalSession?.browser?.isConnected()) {
      stopHeartbeat();
      return;
    }

    try {
      await page.evaluate(() => undefined);
    } catch {
      stopHeartbeat();
      if (!isShuttingDown) {
        globalSession = null;
      }
    }
  }, CDP_HEARTBEAT_INTERVAL_MS);
}

async function createContext() {
  const context = await bb.contexts.create(withOptionalProjectId());
  return context.id;
}

async function createSession(contextId) {
  const session = await bb.sessions.create(withOptionalProjectId({
    keepAlive: true,
    timeout: 3600,
    proxies: true,
    browserSettings: {
      blockAds: true,
      context: { id: contextId, persist: true },
    },
  }));
  return session;
}

async function ensureDesktopViewport(page) {
  try {
    await page.setViewportSize(DESKTOP_VIEWPORT);
  } catch {}
}

async function initSession(emitEvents = true) {
  if (globalSession?.browser?.isConnected()) {
    return globalSession;
  }

  if (globalSession) {
    globalSession = null;
  }

  if (isInitializing) {
    while (isInitializing) await sleep(500);
    if (globalSession?.browser?.isConnected()) {
      if (emitEvents) {
        addEvent('agent-session-start', {
          debugUrl: globalSession.debugUrl,
          liveUrls: globalSession.liveUrls,
          sessionId: globalSession.sessionId,
          contextId: currentContextId,
        });
      }
      return globalSession;
    }
  }

  isInitializing = true;
  addEvent('session-init', { message: 'Initializing session...' });

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
    const liveUrls = {
      debuggerFullscreenUrl: debug.debuggerFullscreenUrl,
      debuggerUrl: debug.debuggerUrl,
      wsUrl: debug.wsUrl,
      pages: debug.pages,
    };
    const debugUrl = debug.debuggerFullscreenUrl || debug.debuggerUrl;

    console.log(`\nDebug url: ${debugUrl}\n`);

    const browser = await chromium.connectOverCDP(session.connectUrl, { timeout: 30000 });

    browser.on('disconnected', () => {
      stopHeartbeat();
      if (!isShuttingDown) globalSession = null;
    });

    const context = browser.contexts()[0];
    const page = context.pages()[0] || await context.newPage();

    page.setDefaultNavigationTimeout(60000);
    page.setDefaultTimeout(30000);
    await ensureDesktopViewport(page);
    startHeartbeat(page);

    globalSession = { browser, page, sessionId: session.id, debugUrl, liveUrls };

    addEvent('agent-session-start', { debugUrl, liveUrls, sessionId: session.id, contextId: currentContextId });

    // Check if user is logged in by visiting LinkedIn
    try {
      await page.goto('https://www.linkedin.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(2000);

      const url = page.url();
      if (url.includes('/login') || url.includes('/checkpoint')) {
        addEvent('login-status', { loggedIn: false });
      } else {
        addEvent('login-status', { loggedIn: true });
      }
    } catch (error) {
      addEvent('login-status', { loggedIn: false });
    }

    isInitializing = false;
    return globalSession;

  } catch (error) {
    isInitializing = false;
    addEvent('agent-error', { message: error.message });
    throw error;
  }
}

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
    execute: async (page, profileUrl, index) => {
      addEvent('node-update', { nodeId: `action-${index}`, status: 'active' });

      await page.goto(profileUrl, { waitUntil: 'domcontentloaded' });
      await sleep(2000);
      await page.evaluate(() => window.scrollBy(0, 300));
      let name = '', headline = '';
      const nameEl = await findElement(page, SELECTORS.profileName);
      if (nameEl) {
        name = (await nameEl.innerText()).trim();
      }

      const headEl = await findElement(page, SELECTORS.profileHeadline);
      if (headEl) {
        headline = (await headEl.innerText()).trim();
      }
      addEvent('node-update', { nodeId: `action-${index}`, status: 'completed', data: { name, headline } });
      return { success: true, data: { name, headline } };
    }
  },
  connect: {
    execute: async (page, profileUrl, index, options = {}) => {
      addEvent('node-update', { nodeId: `action-${index}`, status: 'active' });
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
      else {
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
        }
      }
      addEvent('node-update', { nodeId: `action-${index}`, status: 'completed', data: { connected: !!btn } });
      return { success: !!btn };
    }
  },
  like: {
    execute: async (page, profileUrl, index) => {
      addEvent('node-update', { nodeId: `action-${index}`, status: 'active' });
      await page.evaluate(() => window.scrollBy(0, 800));
      await sleep(1000);
      const btn = await findElement(page, SELECTORS.likeButton);
      if (btn) {
        await btn.click();
      }
      addEvent('node-update', { nodeId: `action-${index}`, status: 'completed', data: { liked: !!btn } });
      return { success: !!btn };
    }
  }
};

async function runWorkflow(profileUrl, workflow) {
  const session = await initSession(false);
  const { page } = session;
  await ensureDesktopViewport(page);
  const results = [];
  let profileData = {};

  for (let i = 0; i < workflow.length; i++) {
    // Check if job was stopped
    if (currentJob?.status === 'stopped') {
      break;
    }

    const action = typeof workflow[i] === 'string' ? { type: workflow[i] } : workflow[i];
    const handler = ACTION_HANDLERS[action.type];

    if (handler) {
      try {
        const options = {
          message: action.message,
          profileData
        };

        const result = await handler.execute(page, profileUrl, i, options);

        if (action.type === 'visit' && result.data) {
          profileData = result.data;
        }

        if (action.delayMs) await sleep(action.delayMs);
        results.push({ action: action.type, ...result });
      } catch (e) {
        addEvent('node-update', { nodeId: `action-${i}`, status: 'error' });
      }
    }
  }
  return { status: 'completed', results };
}

async function checkLoginStatus(navigate = false) {
  if (!globalSession?.page) return { loggedIn: false };
  try {
    const url = globalSession.page.url();
    if (url.includes('/feed') || url.includes('/in/')) {
      return { loggedIn: true };
    } else if (navigate) {
      await ensureDesktopViewport(globalSession.page);
      await globalSession.page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      const newUrl = globalSession.page.url();
      return { loggedIn: newUrl.includes('/feed') };
    } else {
      return { loggedIn: false };
    }
  } catch {
    return { loggedIn: false };
  }
}

// Run campaign in background
async function runCampaign(urls, workflow) {
  currentJob = {
    id: Date.now().toString(),
    status: 'running',
    current: 0,
    total: urls.length,
    startedAt: Date.now()
  };

  try {
    if (!globalSession?.browser?.isConnected()) {
      await initSession(true);
    }
    if (!globalSession) {
      addEvent('agent-error', { message: 'No browser session' });
      currentJob.status = 'error';
      return;
    }

    const actions = workflow?.length ? workflow : [{ type: 'visit' }];

    for (let i = 0; i < urls.length; i++) {
      if (currentJob.status === 'stopped') {
        break;
      }

      await runWorkflow(urls[i], actions);
      currentJob.current = i + 1;
      addEvent('campaign-progress', { current: i + 1, total: urls.length });
      if (i < urls.length - 1) await sleep(5000);
      addEvent('reset-graph');
    }

    if (currentJob.status !== 'stopped') {
      currentJob.status = 'finished';
      addEvent('campaign-finished');
    }
  } catch (error) {
    currentJob.status = 'error';
    addEvent('agent-error', { message: error.message });
  }
}

// REST API Endpoints

// Get session status and initialize if needed
app.get('/api/session', async (req, res) => {
  try {
    if (globalSession?.browser?.isConnected()) {
      await ensureDesktopViewport(globalSession.page);
      const loginStatus = await checkLoginStatus(false);
      res.json({
        connected: true,
        debugUrl: globalSession.debugUrl,
        liveUrls: globalSession.liveUrls,
        sessionId: globalSession.sessionId,
        contextId: currentContextId,
        loggedIn: loginStatus.loggedIn
      });
    } else if (!isInitializing) {
      await initSession(true);
      if (globalSession?.page) {
        await ensureDesktopViewport(globalSession.page);
      }
      const loginStatus = await checkLoginStatus(false);
      res.json({
        connected: !!globalSession,
        debugUrl: globalSession?.debugUrl,
        liveUrls: globalSession?.liveUrls,
        sessionId: globalSession?.sessionId,
        contextId: currentContextId,
        loggedIn: loginStatus.loggedIn
      });
    } else {
      while (isInitializing) await sleep(500);
      if (globalSession?.page) {
        await ensureDesktopViewport(globalSession.page);
      }
      const loginStatus = await checkLoginStatus(false);
      res.json({
        connected: !!globalSession?.browser?.isConnected(),
        debugUrl: globalSession?.debugUrl,
        liveUrls: globalSession?.liveUrls,
        sessionId: globalSession?.sessionId,
        contextId: currentContextId,
        loggedIn: loginStatus.loggedIn
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start a campaign
app.post('/api/campaign/start', async (req, res) => {
  const { urls, workflow } = req.body;

  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'URLs are required' });
  }

  if (currentJob?.status === 'running') {
    return res.status(409).json({ error: 'A campaign is already running' });
  }

  // Clear old events
  jobEvents = [];
  eventIdCounter = 0;

  // Start campaign in background (don't await)
  runCampaign(urls, workflow);

  res.json({
    success: true,
    jobId: currentJob?.id,
    message: 'Campaign started'
  });
});

// Stop campaign
app.post('/api/campaign/stop', (req, res) => {
  if (currentJob && currentJob.status === 'running') {
    currentJob.status = 'stopped';
    addEvent('campaign-stopped');
    res.json({ success: true, message: 'Campaign stopped' });
  } else {
    res.json({ success: false, message: 'No running campaign' });
  }
});

// Get campaign status and events (polling endpoint)
app.get('/api/campaign/status', (req, res) => {
  const lastEventId = parseInt(req.query.lastEventId) || 0;

  // Get events since lastEventId
  const newEvents = jobEvents.filter(e => e.id > lastEventId);

  res.json({
    job: currentJob ? {
      id: currentJob.id,
      status: currentJob.status,
      current: currentJob.current,
      total: currentJob.total
    } : null,
    events: newEvents
  });
});

// Save session and shutdown
app.post('/api/session/save', async (req, res) => {
  await shutdown();
  res.json({ success: true });
});

// Shutdown the instance saving the auth cookies
async function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  stopHeartbeat();

  console.log('\nShutting down...');

  if (globalSession) {
    try {
      await globalSession.browser.close();
      console.log('Session saved');
    } catch {}

    try {
      await bb.sessions.update(globalSession.sessionId, {
        status: 'REQUEST_RELEASE'
      });
    } catch {}
  }

  if (currentContextId) console.log(`Context: ${currentContextId}`);
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

app.listen(3001, () => {
  console.log('Server: http://localhost:3001');
  console.log(`Context: ${CONTEXT_ID || '(new)'}`);
});
