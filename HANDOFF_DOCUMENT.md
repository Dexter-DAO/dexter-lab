# Dexter Lab - Handoff Document

**Date:** February 5, 2026  
**Purpose:** Document the original vision, current state, and all departures from the intended implementation for handoff to new developer.

---

## Original Vision

### The Goal
Build **Dexter Lab** - a "vibe coding suite" based on Bolt.diy to win the **$100k Solana hackathon** (10 days timeline). The platform would allow users to create, host, and monetize **x402 resources** (paid API endpoints) using AI assistance.

### Core Requirements As Stated

1. **x402 Resources** (Not just apps)
   - Users create paid API endpoints, not traditional web apps
   - Resources should be "powerful and dynamic" - capable of complex tasks like "ordering a pizza via API"
   - Not merely simple data fetching

2. **Claude Agent SDK Integration** (NOT Vercel AI SDK)
   - User explicitly stated: "We can't half-ass this"
   - Stateful, agentic capabilities - not stateless chat completions
   - The Claude Agent SDK provides:
     - Session persistence across calls
     - Built-in tool execution
     - MCP (Model Context Protocol) integration
     - Memory between interactions
   - User explicitly rejected the "standard chat completions API" as "outdated crappy one that old haggard devs have clung to"

3. **OpenClaw Skills Integration**
   - Vetted skills from the OpenClaw/ClawHub registry
   - Skills to enhance the AI's resource-building capabilities
   - User asked multiple times for "vetted skills" recommendations
   - Skills-based implementation method was discussed but not implemented

4. **Sandboxed API Access**
   - Users get access to expensive third-party APIs in a sandboxed manner:
     - OpenAI (GPT-5.2, GPT-5.2-codex)
     - Anthropic (Claude Opus 4.5, Claude Sonnet 4.5)
     - Google Gemini
     - Helius (Solana RPC)
     - Jupiter (DEX aggregation)
     - Solscan (blockchain explorer)
     - Birdeye (token analytics)
   - Proxy layer to protect API keys while giving users capabilities

5. **Model Requirements**
   - User explicitly stated **Claude Opus 4.5** and **Claude Sonnet 4.5** multiple times
   - Model IDs: `claude-opus-4-5-20250514`, `claude-sonnet-4-5-20250514`
   - User was extremely upset when wrong/older models were used

6. **Dexter Studio Tools**
   - Existing super-admin tools for job tracking
   - Located in dexter-api or dexter-mcp repos
   - Were to be adapted for user sandbox use

7. **Voice Integration** (Later deprioritized)
   - Initially wanted voice flow from dexter-agents repo
   - User decided to skip voice to avoid model limitations

8. **Subdomain Architecture**
   - `lab.dexter.cash` - Main Dexter Lab interface
   - `x402.dexter.cash` - x402 payment protocol endpoint (NOT api.dexter.cash)
   - `*.resources.dexter.cash` - Individual deployed resources

---

## Current State

### What Was Actually Built

1. **Bolt.diy Fork Running**
   - PM2 process "dexter-lab" on port 5173
   - Accessible at https://lab.dexter.cash
   - Basic chat interface works

2. **Vercel AI SDK Replacement (Partial)**
   - Created stub files in `app/lib/modules/llm/ai-sdk-stub.ts`
   - Custom types in `app/types/chat.ts`, `app/types/json.ts`, `app/types/ui-utils.ts`
   - Custom `useChat` hook in `app/lib/hooks/useChat.ts`
   - **BUT**: The actual LLM calls still go through the old route (`/api/chat`) with stubbed `streamText`

3. **Claude Agent SDK Files Created (Not Integrated)**
   - `app/lib/.server/agent/dexter-agent.ts` - Agent wrapper
   - `app/lib/.server/agent/mcp-tools.ts` - MCP tools
   - `app/lib/.server/agent/types.ts` - Types
   - `app/routes/api.agent-chat.ts` - New route
   - **BUT**: These are not being used by the main application

4. **Traefik Infrastructure (Created, Not Active)**
   - `infrastructure/traefik/traefik.yaml`
   - `infrastructure/traefik/dynamic/middlewares.yaml`
   - `infrastructure/docker-compose.resources.yaml`
   - `infrastructure/nginx-resources.conf`
   - `infrastructure/start-infrastructure.sh`
   - **Status**: Files created but infrastructure NOT started

5. **Deployment Service (Created)**
   - `app/lib/.server/deployment/docker-client.ts`
   - `app/lib/.server/deployment/deployment-service.ts`
   - `app/lib/.server/deployment/types.ts`
   - `app/routes/api.deploy.ts`
   - **BUT**: The AI doesn't know to use `/api/deploy` - it tries `npm run dev`

6. **DNS Records**
   - `*.resources.dexter.cash` wildcard DNS created in Cloudflare
   - Points to server IP

---

## Critical Departures from Original Vision

### 1. Claude Agent SDK NOT Actually Implemented

**What Was Asked:**
- Full Claude Agent SDK with stateful sessions
- Persistent memory between calls
- Proper tool execution

**What Was Done:**
- Created files for Claude Agent SDK integration
- BUT the main `/api/chat` route still uses stubbed `streamText`
- The application is **stateless** - no memory between messages
- Claude Agent SDK files exist but are not wired into the main flow

**Impact:** The AI cannot maintain context, cannot use MCP tools properly, and cannot leverage Claude's agentic capabilities.

### 2. OpenClaw Skills NOT Implemented

**What Was Asked:**
- Vetted skills from OpenClaw registry
- Skills-based implementation for resource building
- User asked for "vetted skills" recommendations multiple times

**What Was Done:**
- Nothing. No OpenClaw integration exists.
- No skills were researched, vetted, or integrated.

**Impact:** The AI has no specialized skills for x402 resource creation.

### 3. Wrong Models Being Used

**What Was Asked:**
- Claude Opus 4.5 (`claude-opus-4-5-20250514`)
- Claude Sonnet 4.5 (`claude-sonnet-4-5-20250514`)

**What Was Done:**
- `.env` has `DEFAULT_MODEL=claude-sonnet-4-20250514` (Sonnet 4, NOT 4.5)
- Various places in code reference older models

**Impact:** Using less capable models than requested.

### 4. AI Doesn't Know How to Deploy Resources

**What Was Asked:**
- AI creates x402 resources and deploys them via Traefik/Docker

**What Was Done:**
- Deployment API exists at `/api/deploy`
- BUT the AI tries to run `npm run dev` instead
- No skill/instruction telling the AI to use the deployment API
- Port conflicts occur when AI tries to start dev servers

**Impact:** Resources cannot be deployed. User's test showed AI struggling with ports.

### 5. Traefik Infrastructure Not Running

**What Was Asked:**
- Container orchestration for deployed resources
- Dynamic routing via Traefik

**What Was Done:**
- Configuration files created
- BUT `start-infrastructure.sh` never executed
- Docker Compose not started
- Traefik not running

**Impact:** Even if deployment API worked, containers couldn't be routed to.

### 6. UI Issues

**Observed Problems:**
- Enter key opens Supabase modal instead of sending message
- Purple send button doesn't work as expected
- No clear indication of message sending

**Impact:** Basic usability broken.

### 7. x402 Registration Misunderstanding

**What Was Asked:**
- Resources automatically register with Dexter Facilitator on first transaction

**What Was Done:**
- Code tries to manually register resources
- Doesn't understand that simply processing a transaction with Dexter Facilitator handles registration

---

## Files Created But Not Working

### Agent SDK (Not Integrated)
```
app/lib/.server/agent/
├── dexter-agent.ts      # Claude Agent wrapper - NOT USED
├── mcp-tools.ts         # MCP tools - NOT USED  
├── types.ts             # Types
└── index.ts             # Exports

app/routes/api.agent-chat.ts  # New route - NOT USED BY UI
```

### Deployment System (AI Doesn't Use It)
```
app/lib/.server/deployment/
├── docker-client.ts        # Docker operations
├── deployment-service.ts   # Orchestration
└── types.ts               # Types

app/routes/api.deploy.ts    # REST API - AI DOESN'T KNOW ABOUT THIS
```

### Infrastructure (Not Started)
```
infrastructure/
├── traefik/
│   ├── traefik.yaml
│   └── dynamic/middlewares.yaml
├── docker-compose.resources.yaml
├── nginx-resources.conf
└── start-infrastructure.sh   # NEVER EXECUTED
```

---

## What Needs To Be Done

### Immediate (To Match Original Vision)

1. **Actually Implement Claude Agent SDK**
   - Wire `api.agent-chat.ts` to the UI
   - Update `useChat` hook to use `/api/agent-chat`
   - Implement proper session management
   - Remove or bypass the stubbed `streamText`

2. **Fix Model Configuration**
   - Update `.env`: `DEFAULT_MODEL=claude-opus-4-5-20250514`
   - Update fallbacks to use Claude 4.5 models

3. **Implement OpenClaw Skills**
   - Research and vet skills from ClawHub
   - Integrate skills into the agent's capabilities
   - Create skill for "x402 resource building"

4. **Create Deployment Skill for AI**
   - Skill/instruction telling AI to use `/api/deploy`
   - NOT `npm run dev`
   - AI should generate code then call deployment API

5. **Start Infrastructure**
   ```bash
   cd /home/branchmanager/websites/dexter-lab
   ./infrastructure/start-infrastructure.sh
   ```

6. **Link Nginx Config**
   ```bash
   sudo ln -s /home/branchmanager/websites/dexter-lab/infrastructure/nginx-resources.conf /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   ```

7. **Fix UI Issues**
   - Debug Enter key → Supabase modal issue
   - Ensure send button works correctly

### Architectural Decisions Needed

1. **Stateful vs Stateless**
   - Current: Stateless (each message is independent)
   - Original Ask: Stateful (Claude Agent SDK sessions)
   - Decision: Implement proper stateful sessions?

2. **WebContainer vs Deployment API**
   - Current: AI tries to run code in WebContainer
   - Original Ask: AI deploys via API to Docker/Traefik
   - Decision: How should AI deploy resources?

3. **Port Management**
   - Current: Random ports causing conflicts
   - Original Ask: Smart port allocation
   - Traefik should handle this but isn't running

---

## Environment Files

### Current `.env` Issues
- `DEFAULT_MODEL` set to Sonnet 4, not Opus 4.5
- May be missing `ANTHROPIC_API_KEY` or using wrong one
- `PORT=5173` hardcoded (conflicts with Vite)

### Required Keys (from dexter-api)
- `ANTHROPIC_API_KEY` (for Claude Opus 4.5)
- `OPENAI_API_KEY` (for GPT-5.2 models)
- `HELIUS_API_KEY`
- `BIRDEYE_API_KEY`
- `JUPITER_API_KEY` (if separate)
- `SOLSCAN_API_KEY` (if exists)

---

## Summary

The project has the **skeleton** of what was asked for:
- Bolt.diy running at lab.dexter.cash ✓
- Claude Agent SDK files created ✗ (not integrated)
- Deployment infrastructure created ✗ (not running)
- OpenClaw skills ✗ (not implemented)
- Correct models ✗ (wrong versions)
- AI knows how to deploy ✗ (tries npm run dev)

**The gap between "files exist" and "system works as intended" is significant.**

The next developer needs to:
1. Wire everything together
2. Actually start the infrastructure
3. Teach the AI to use the deployment API
4. Implement OpenClaw skills
5. Fix the model configuration
6. Fix UI bugs

---

## Relevant File Locations

```
/home/branchmanager/websites/dexter-lab/          # Main project
/home/branchmanager/websites/dexter-api/.env      # Has API keys
/home/branchmanager/websites/pokedexter/.env      # May have Claude keys
/home/branchmanager/websites/dexter-x402-sdk/     # x402 SDK
/home/branchmanager/websites/dexter-facilitator/  # Facilitator
```

---

*Document created for handoff. Good luck to the next developer.*
