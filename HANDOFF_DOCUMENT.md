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

## Specific Decision Points Where Things Went Wrong

Through deep analysis of the conversation history, here are the exact moments where implementation diverged from requirements:

### 1. Claude Agent SDK → Stub (Zod Conflict)

**The Pivotal Moment:**
When installing `@anthropic-ai/claude-agent-sdk`, a Zod version conflict emerged:
- Claude Agent SDK requires `zod@^4.0.0`
- Vercel AI SDK (`ai` package) requires `zod@^3.x`

**What Should Have Happened:**
- Fully remove Vercel AI SDK
- Install Claude Agent SDK with Zod 4
- Rewrite LLM layer to use Claude Agent SDK natively

**What Actually Happened:**
- Created stubs for Vercel AI SDK types
- Installed Zod 4 but kept stub implementations
- Claude Agent SDK files were created but **never wired to the main flow**
- The `/api/chat` route still uses `streamText` from the stub (which throws an error)
- User explicitly said "stub them, we are not going to remove it" - referring to the provider stubs for future multi-provider support, but this was misinterpreted as keeping the entire stub architecture

**Evidence:**
- `app/lib/modules/llm/ai-sdk-stub.ts` contains `streamText` that throws: `'streamText from ai package is disabled. Use the Claude Agent SDK via /api/agent-chat endpoint.'`
- But the UI still calls `/api/chat` which uses this stub
- `app/routes/api.agent-chat.ts` exists but is NOT used by the frontend

### 2. OpenClaw Skills → Embedded Approach

**The Pivotal Moment:**
When implementing skills, a decision was made to use "embedded" skills rather than a dynamic skill loader.

**What Should Have Happened:**
- Implement proper OpenClaw skill loading system
- Research and vet skills from ClawHub registry
- Dynamic skill installation and management

**What Actually Happened:**
- Skills were "embedded" directly into the prompt/system
- No OpenClaw integration at all
- No skill registry, no skill loading
- The "embedded" approach was justified as "simpler for WebContainer environment" but this bypassed the entire OpenClaw ecosystem

**Evidence:**
- No files referencing OpenClaw or ClawHub exist in the codebase
- `app/lib/.server/skills/` contains only a basic `index.ts` that loads markdown files from `/skills` directory
- No vetted skills were ever researched or added

### 3. WebContainer Port Management → Random Ports

**The Pivotal Moment:**
The AI (running in the WebContainer sandbox) tries to spin up development servers on hardcoded ports.

**What Should Have Happened:**
- AI should call `/api/deploy` to deploy resources
- Deployment service handles port allocation via Docker/Traefik
- No direct `npm run dev` from AI

**What Actually Happened:**
- AI creates code files in WebContainer
- AI tries to run `npm run dev` 
- Hits port conflicts (5173, 3001, 3002 all in use)
- No skill/instruction telling AI to use deployment API
- AI has no concept of the deployment pipeline

**Evidence:**
- From the test session, AI tried ports 5173, 3001, 3002 sequentially
- Each failed with "port in use"
- AI never attempted to call `/api/deploy`

### 4. x402 Resources → Code Files Only (Not Deployable)

**The Pivotal Moment:**
The AI successfully generates x402 resource code but has no way to deploy it.

**What Should Have Happened:**
1. AI generates x402 resource code
2. AI calls `/api/deploy` with the code
3. Deployment service builds Docker image
4. Traefik routes traffic to container
5. Resource is live at `*.resources.dexter.cash`
6. First x402 transaction auto-registers with Dexter Facilitator

**What Actually Happened:**
1. AI generates x402 resource code ✓
2. AI tries `npm run dev` ✗ (port conflicts)
3. No deployment occurs
4. Resource only exists as files in WebContainer
5. Never becomes accessible
6. Never registers with facilitator

**Evidence:**
- Test session showed AI creating full `x402-ai-assistant/` project structure
- AI declared "resource is ready for deployment"
- But resource is NOT deployed, NOT accessible, NOT functional

### 5. Traefik Infrastructure → Created But Never Started

**The Pivotal Moment:**
Infrastructure files were created but `start-infrastructure.sh` was never executed.

**What Should Have Happened:**
```bash
./infrastructure/start-infrastructure.sh
```

**What Actually Happened:**
- Script created
- Script never run
- Traefik not running
- Docker Compose not started
- Even if deployment API was called, containers wouldn't be routable

**Evidence:**
```bash
pm2 list  # No traefik process
docker ps  # No traefik container
```

---

## The Root Cause

**The fundamental issue is a disconnect between:**

1. **What exists (files)** vs **What's connected (flow)**
   - Claude Agent SDK files exist → Not wired to UI
   - Deployment API exists → AI doesn't know about it
   - Infrastructure files exist → Not started

2. **What AI knows** vs **What system supports**
   - AI knows how to write x402 code
   - AI doesn't know to use deployment API
   - AI tries to run dev server (wrong approach)

3. **Stateless vs Stateful**
   - Original ask: Stateful Claude Agent SDK sessions
   - Current state: Stateless chat completions
   - AI cannot maintain context or use MCP tools

**To fix this, the next developer must:**
1. Actually wire Claude Agent SDK to the frontend (change `useChat` to use `/api/agent-chat`)
2. Create a skill/instruction that tells AI to use `/api/deploy` instead of `npm run dev`
3. Start the Traefik infrastructure
4. Test the full flow end-to-end

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
