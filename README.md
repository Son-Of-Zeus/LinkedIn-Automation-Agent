# LinkedIn Automation Agent

A full-stack automation tool for LinkedIn profile outreach campaigns using Browserbase for persistent browser sessions.

## Features

- **Automated LinkedIn Actions**: Visit, Connect, Like, and Message
- **Persistent Sessions**: Browser context saved across runs
- **Real-time Progress**: Live workflow visualization with ReactFlow
- **Custom Messages**: Optional Personalized connection notes with variables
- **Batch Processing**: Upload CSV files for bulk campaigns
- **Dark/Light Theme**: Modern UI with theme switching

## Tech Stack

**Frontend:**
- React 19 with Vite
- ReactFlow for workflow visualization
- Socket.io-client for real-time updates
- Radix UI for accessible tooltips
- TailwindCSS for styling

**Backend:**
- Node.js + Express
- Socket.io for WebSocket communication
- Playwright + Browserbase for browser automation
- dotenv for environment management

## Prerequisites

- Node.js (v18 or higher)
- Browserbase account
- LinkedIn account

## Installation

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd linkedIn-agent
   ```

2. **Install dependencies**
   ```bash
   # Install server dependencies
   cd server
   npm install

   # Install client dependencies
   cd ../client
   npm install
   ```

3. **Set up environment variables**
   
   Create a `.env` file in the `server/` directory:
   ```env
   BROWSERBASE_API_KEY=your_api_key_here
   # Optional: if omitted, Browserbase infers project from your API key
   BROWSERBASE_PROJECT_ID=your_project_id_here
   ```

   > **Note**: `CONTEXT_ID` will be automatically generated and saved to `.env` on first run.

## Running the Application


**Terminal 1 - Server:**
```bash
cd server
node server.js
```

**Terminal 2 - Client:**
```bash
cd client
npm run dev
```

## Usage

1. **Start the application** using either method above
2. **Open your browser** to `http://localhost:5173`
3. **Click the Debug URL** shown in the server.js console log to access the Browserbase browser
4. **Login to LinkedIn** in the Browserbase browser
5. **Refresh the page** to unlock controls
6. **Configure your workflow:**
   - Click `[+]` to add actions (Visit, Connect, Like, Message)
   - Click on Connect nodes to add custom connection notes
   - Use `{{firstName}}` and `{{lastName}}` variables in messages
7. **Run a campaign:**
   - **Single Mode**: Paste a LinkedIn profile URL and click "RUN"
   - **Batch Mode**: Upload a CSV file with profile URLs (one per line)

## Important Notes

### ⚠️ Server Shutdown

**CRITICAL**: When stopping the server, press `Ctrl+C` **ONLY ONCE** and wait for graceful shutdown.

```bash
# ✅ CORRECT:
Press Ctrl+C once
Wait for "Session saved" message
Wait for "Context: <id>" to appear

# ❌ INCORRECT:
Pressing Ctrl+C multiple times (will corrupt the session)
Force killing the process
```

The server needs time to:
- Save the browser session to Browserbase
- Release the context properly
- Store cookies for next run

If you force-kill the server, you may lose your LinkedIn login session.

### Context Management

- **First run**: Creates a new Browserbase context (saves to `.env`)
- **Subsequent runs**: Reuses existing context (keeps cookies/session)
- **To reset**: Delete `CONTEXT_ID` from `server/.env` or run `node deleteContext.js <context-id>`

### Rate Limiting

- Default delay between profiles: **5 seconds**
- Recommended daily limit: **50-100 connection requests**
- LinkedIn has rate limits - space out large campaigns

## Troubleshooting

### "Login Required" overlay stuck
- Click the Debug URL shown in the server.js logs and login manually
- After logging in, click "I'VE ALREADY LOGGED IN"
- If still stuck, refresh the page

### Session lost after restart
- Make sure you pressed Ctrl+C only once during shutdown
- Check if `CONTEXT_ID` exists in `server/.env`
- If lost, delete `CONTEXT_ID` and login again

### Browser session disconnected
- Browserbase sessions can still end due to timeout, release, or unexpected disconnects
- The server sends periodic CDP heartbeat pings to reduce idle disconnects
- Restart the server to create a new session
- Context will be reused (cookies preserved)


## API Endpoints (Socket.io Events)

### Client → Server
- `get-session`: Request current session status
- `start-campaign`: Start automation with URLs and workflow
- `save-session`: Gracefully shutdown and save session

### Server → Client
- `agent-session-start`: Session created (includes debugUrl)
- `login-status`: Login state changed
- `node-update`: Workflow node status update
- `campaign-progress`: Progress counter update
- `campaign-finished`: All profiles processed
- `agent-error`: Error occurred


## License

MIT

## Disclaimer

This tool is for educational purposes. Use responsibly and comply with LinkedIn's Terms of Service. Automated activity may result in account restrictions. The authors are not responsible for any consequences of using this tool.

## Support

For issues or questions:
- Check the Troubleshooting section above
- Review Browserbase documentation
- Check Playwright documentation for selector issues
