# Trust Dashboard — Frontend Spec

**Audience:** Frontend team. This doc assumes you know nothing about 8004, the verification system, or on-chain reputation. Everything you need is here.

**Repo:** `dexter-lab` (Remix + Vite + UnoCSS + Radix UI)
**API:** `dexter-api` at `https://api.dexter.cash` (backend team builds the endpoints from this same spec)
**GitHub Issues:** dexter-lab#1, dexter-api#23

---

## Table of Contents

1. [What is this](#1-what-is-this)
2. [Why it matters](#2-why-it-matters)
3. [The data — what exists today](#3-the-data--what-exists-today)
4. [Real examples — what the content looks like](#4-real-examples--what-the-content-looks-like)
5. [Routes and pages](#5-routes-and-pages)
6. [API endpoints you'll consume](#6-api-endpoints-youll-consume)
7. [Component breakdown](#7-component-breakdown)
8. [Design direction](#8-design-direction)
9. [Technical requirements](#9-technical-requirements)
10. [OpenGraph / share cards](#10-opengraph--share-cards)
11. [What's already done](#11-whats-already-done)

---

## 1. What is this

Dexter runs an automated **resource quality verifier**. Every 15 minutes, it:
1. Picks up to 50 API endpoints from the marketplace
2. **Pays real money** (USDC on Solana or Base) to call each endpoint
3. Sends a realistic test input (AI-generated based on the endpoint's purpose)
4. Gets the actual response back
5. **AI evaluates** the response: Did it match what was advertised? Is it useful? Is it too large? Is it fast enough?
6. Assigns a **score 0-100** and a verdict: `pass`, `fail`, or `inconclusive`
7. Writes the full assessment to **IPFS** (permanent, public, auditable)
8. Publishes the score **on-chain** to the 8004 agent reputation system on Solana

The **Trust Dashboard** makes all of this visible to users at `lab.dexter.cash/trust`.

Think of it as: **Yelp for AI APIs**, except every review is backed by a real payment receipt, an AI assessment pinned to IPFS, and an on-chain transaction.

---

## 2. Why it matters

- **28,942 verifications** have been performed
- **$216 USDC** spent on real endpoint tests
- **281 distinct sellers** verified
- **Average score: 39.7/100** — most endpoints are bad
- **16.2% pass rate** — only 1 in 6 endpoints actually delivers what it claims

Nobody else in the x402/8004 ecosystem has this data. This dashboard is Dexter's biggest differentiator.

---

## 3. The data — what exists today

### Verification record
Each time we test an endpoint, a record is created with:
- **endpoint URL** + display name + description + category
- **AI score** (0-100), **verdict** (pass/fail/inconclusive), **notes** (1-2 sentences), **fix instructions** (for failures)
- **test input** we sent (JSON) + reasoning for why we chose it
- **response metadata**: HTTP status, size in bytes, latency in ms
- **payment**: amount in USDC (atomic units, divide by 1,000,000), network (Solana/Base), transaction hash
- **on-chain feedback**: IPFS CID linking to the full assessment, Solana transaction hash of the 8004 feedback submission

### Seller / agent
Each seller who receives payments has:
- Wallet address
- Display name, logo, description, category
- 8004 agent identity (on-chain NFT with asset pubkey, trust tier, feedback count)

### Aggregate stats
Total verifications, pass rate, total spent, agents verified, endpoints verified, feedback on-chain count.

---

## 4. Real examples — what the content looks like

### A passing endpoint (score: 92)

> **Jupiter Pro Swap Quote** · DeFi
> `x402.dexter.cash/api/jupiter/quote/pro`
>
> Paid **$0.10** on Solana · 3.8s latency · 1.2KB response
>
> "Response returns a full Jupiter quote object matching the claimed ExactIn quote preview with route plan, amounts, slippage, price impact, and metadata. Size is small and useful."
>
> [IPFS Proof] [Solscan Tx] [Full Review →]

### A failing endpoint (score: 20)

> **StatusPay** · Infrastructure
> `api.syraa.fun/check-status`
>
> Paid **$0.001** on Solana · 7.9s latency · 58 bytes response
>
> "Response is just a health check message and does not return the status of any resource/transaction as described. No inputs handled, no actionable status data."
>
> **Fix:** "Implement the check-status endpoint to accept a transaction/resource identifier (e.g., query param `tx_hash` or `resource_id`) and return the actual payment/status fields. Replace the health-check message with real status data or return a 4xx error if the required identifier is missing."
>
> [IPFS Proof] [Full Review →]

These AI assessments are the core content. They're specific, opinionated, and actionable. The failing ones are more interesting than the passing ones — that's what people share.

---

## 5. Routes and pages

### `app/routes/trust.tsx` → `/trust`

The main dashboard. Three tabs: Live Feed, Leaderboard, About.
- **Public.** No wallet. No auth. Anyone can view.
- Server loader fetches initial stats + first page of feed data for SSR.
- Client-side fetch for pagination, filter changes, tab switches.

### `app/routes/trust.agent.$id.tsx` → `/trust/agent/:walletOrAsset`

Agent profile page. `$id` is either a Solana wallet address or an 8004 asset pubkey.
- Shows score trend over time, endpoint breakdown, verification history.
- Links to 8004scan.io agent page.

### `app/routes/trust.review.$id.tsx` → `/trust/review/:verificationId`

Single verification receipt. **This is the shareable unit.** `$id` is a UUID.
- Shows the full three-step receipt chain: Payment → AI Evaluation → On-chain Publication.
- Each step has proof links (Solscan tx, IPFS doc, 8004 feedback tx).
- **Must have OpenGraph meta tags** for Twitter/social sharing (see section 10).

---

## 6. API endpoints you'll consume

All are `GET`, all are public (no auth headers needed), all return JSON.

Base URL: use the existing `DEXTER_API_BASE` from `app/lib/.server/deployment/api-client.ts`.

> **Note:** These endpoints don't exist yet. The backend team builds them from this same spec. Until they're ready, you can mock the responses using the shapes below.

### `GET /api/trust/stats`

Hero section numbers. **Cache-friendly** (changes slowly).

```typescript
{
  totalVerifications: number;     // 28,942
  paidVerifications: number;      // 8,242
  totalSpentUsd: number;          // 216.20
  averageScore: number;           // 39.7
  passRate: number;               // 16.2 (percentage)
  agentsVerified: number;         // 281
  endpointsVerified: number;      // ~1,100
  feedbackOnChain: number;        // 60+
  last24h: {
    verifications: number;
    spent: number;
    avgScore: number;
  };
}
```

### `GET /api/trust/feed?limit=20&offset=0&status=all&category=&minScore=0&maxScore=100`

Paginated verification stream. Each item is one AI assessment of one endpoint.

```typescript
{
  items: Array<{
    id: string;                   // UUID — used for /trust/review/:id links
    endpoint: {
      url: string;                // "https://x402.dexter.cash/api/jupiter/quote/pro"
      name: string | null;        // "Jupiter Pro Swap Quote"
      description: string | null; // "Provides Pro-tier Jupiter swap..."
      category: string | null;    // "DeFi" | "AI" | "Data" | "Tools" | ...
      currentScore: number | null;// latest quality score on the resource
    };
    verification: {
      score: number;              // 0-100
      status: 'pass' | 'fail' | 'inconclusive';
      notes: string;              // "Response returns a full Jupiter quote..."
      fixInstructions: string | null; // null for pass, specific fix text for fail
      testInput: object | null;   // {"symbol": "DEXTER"} — what we sent
      testInputReasoning: string | null; // "Used a concise, specific token..."
      responseStatus: number | null; // HTTP status code (200, 500, etc.)
      responseSize: number | null;// bytes
      latencyMs: number | null;   // milliseconds
      paidAmount: string;         // "$0.10" — human-readable
      paidAmountAtomic: string;   // "100000" — raw USDC atomic units
      paidNetwork: string;        // "Solana" | "Base"
      paymentTx: string | null;   // Solana tx signature (44-88 chars)
      verifiedAt: string;         // ISO timestamp
    };
    onChain: {
      feedbackTx: string | null;  // Solana tx signature for 8004 feedback
      feedbackIpfs: string | null;// "ipfs://bafkrei..." — IPFS CID
      feedbackIpfsUrl: string | null; // "https://gateway.pinata.cloud/ipfs/bafkrei..."
      submittedAt: string | null;
    } | null;
    seller: {
      wallet: string;             // Solana/EVM address
      name: string | null;        // display name if known
    };
  }>;
  total: number;
  hasMore: boolean;
}
```

**Filter params:**
- `status`: `pass`, `fail`, `inconclusive`, or `all` (default `all`)
- `category`: `ai`, `defi`, `data`, `tools`, `gaming`, `social`, `infrastructure`, `other`, or empty for all
- `minScore` / `maxScore`: integer 0-100
- `limit` / `offset`: pagination

### `GET /api/trust/leaderboard?sort=score&limit=50&offset=0`

Agent rankings table.

```typescript
{
  agents: Array<{
    wallet: string;
    name: string | null;
    category: string | null;
    imageUrl: string | null;
    identity: {
      chain: string;              // "solana" | "base"
      agentId: string;
      mintAddress: string | null; // for Solscan link
    } | null;
    stats: {
      averageScore: number;
      verificationCount: number;
      passCount: number;
      failCount: number;
      passRate: number;           // percentage
      totalVolumeUsd: number;
      endpointCount: number;
      lastVerifiedAt: string | null;
      scoreTrend: number | null;  // +/- change over 7 days
    };
  }>;
  total: number;
}
```

**Sort params:** `score`, `verifications`, `volume`, `passRate`

### `GET /api/trust/agent/:walletOrAsset`

Full agent profile.

```typescript
{
  agent: {
    wallet: string;
    name: string | null;
    description: string | null;
    imageUrl: string | null;
    category: string | null;
    identity: {
      chain: string;
      agentId: string;
      mintAddress: string | null;
      scan8004Url: string | null; // "https://www.8004scan.io/agents?id=..."
    } | null;
  };
  stats: {
    averageScore: number;
    scoreHistory: Array<{ date: string; score: number }>; // daily averages for chart
    verificationCount: number;
    passRate: number;
    avgLatencyMs: number;
    avgResponseSize: number;
    totalVolumeUsd: number;
    endpointCount: number;
    scoreTrend7d: number | null;
  };
  endpoints: Array<{
    url: string;
    name: string | null;
    lastScore: number | null;
    lastStatus: string | null;
    verificationCount: number;
    avgScore: number;
  }>;
  recentVerifications: Array</* same shape as feed items */>;
}
```

### `GET /api/trust/review/:verificationId`

Single verification receipt.

```typescript
{
  verification: {
    id: string;
    endpoint: { url: string; name: string | null; description: string | null; category: string | null };
    testInput: object | null;
    testInputReasoning: string | null;
    score: number;
    status: string;
    notes: string;
    fixInstructions: string | null;
    responseStatus: number | null;
    responseSize: number | null;
    latencyMs: number | null;
    verifiedAt: string;
    aiModel: string | null;
  };
  payment: {
    amount: string;               // "$0.10"
    amountAtomic: string;
    network: string;
    txSignature: string | null;
    txUrl: string | null;         // "https://solscan.io/tx/..."
  };
  feedback: {
    ipfsCid: string | null;
    ipfsUrl: string | null;       // "https://gateway.pinata.cloud/ipfs/..."
    onChainTx: string | null;
    onChainTxUrl: string | null;  // "https://solscan.io/tx/..."
    status: 'pending' | 'submitted' | 'failed' | null;
  } | null;
  seller: {
    wallet: string;
    name: string | null;
    agentAsset: string | null;
    profileUrl: string | null;    // "/trust/agent/:wallet"
  };
}
```

---

## 7. Component breakdown

```
app/routes/trust.tsx
  └── TrustDashboard
      ├── TrustHero            — headline copy + stats bar (5 stat cards)
      ├── TrustTabs            — [Live Feed] [Leaderboard] [About]
      ├── TrustFeed            — when "Live Feed" tab active
      │   ├── FeedFilters      — dropdowns: status, category, score range
      │   └── FeedCard[]       — repeating card for each verification
      │       ├── ScoreBadge   — large color-coded circle (green/amber/red)
      │       ├── EndpointInfo — name, URL, category badge, price + latency
      │       ├── AiReview     — notes text (always visible), fix instructions
      │       │                  (shown for fail/inconclusive, collapsible)
      │       ├── TestInput    — collapsible: "We sent: {json}" + reasoning
      │       └── ReceiptLinks — [IPFS Proof] [Payment Tx] [On-chain] [Full Review →]
      ├── TrustLeaderboard     — when "Leaderboard" tab active
      │   └── AgentRow[]       — clickable row → /trust/agent/:wallet
      └── TrustAbout           — methodology explanation (static content)

app/routes/trust.agent.$id.tsx
  └── AgentProfile
      ├── AgentHeader          — name, image, wallet (truncated), 8004scan link
      ├── ScoreTrendChart      — area chart of daily avg score over time
      ├── StatsGrid            — pass rate, avg latency, avg size, volume, endpoints
      ├── EndpointList         — table of endpoints with per-endpoint scores
      └── VerificationHistory  — reuses FeedCard[], paginated

app/routes/trust.review.$id.tsx
  └── ReviewReceipt
      ├── ReceiptHero          — big score badge + verdict + endpoint name
      ├── ReceiptChain         — visual 3-step indicator:
      │   ├── Step 1: Payment  — "$0.10 paid on Solana" + tx link
      │   ├── Step 2: AI Eval  — score, model, notes, fix instructions
      │   └── Step 3: On-chain — IPFS CID + 8004 feedback tx + status
      ├── TestDetails          — what input we sent, why, response metadata
      └── SellerContext        — link to agent profile, category
```

---

## 8. Design direction

**Not generic SaaS.** This should feel like a high-quality editorial product. Think Dune Analytics meets a Bloomberg terminal.

- **Dark theme.** Matches existing dexter-lab. Use existing CSS variables.
- **Monospace accents.** URLs, scores, wallet addresses in monospace.
- **Data-dense but scannable.** Each feed card should show score + verdict + notes in ~3 lines without expanding.

### Score badges
Large color-coded circles (or pill badges):
- **70-100**: Green (`#22c55e` / emerald-500)
- **40-69**: Amber (`#f59e0b` / amber-500)
- **0-39**: Red (`#ef4444` / red-500)

The score number goes inside the circle. Big and bold.

### Feed cards
- Left side: score badge (large)
- Right side: endpoint name (bold), URL (mono, muted), price + latency (small), AI notes (the most prominent text — 2-3 lines)
- For failures: fix instructions in a distinct callout box (border-left accent)
- Bottom: receipt links as small text buttons

### Receipt chain (review page)
Three circles connected by a line (horizontal on desktop, vertical on mobile):
```
  [$0.10 paid]  ──────  [AI: 92/100]  ──────  [On-chain ✓]
   Solana tx →           IPFS proof →          8004 feedback →
```
Each circle is clickable and links to proof.

### Leaderboard
Table with sortable column headers. Rows are clickable. Score column has the color badge. Trend column shows +/- with green/red arrow.

### Charts (agent profile)
- **Score trend**: Area chart, 30-day window, daily average scores. Use Recharts.
- Keep it minimal. One chart is enough. Don't over-chart.

---

## 9. Technical requirements

### Stack (use what already exists)
- **UnoCSS** for all styling (Tailwind-compat utilities). No new CSS framework.
- **Radix UI** for tabs (`@radix-ui/react-tabs`), tooltips, collapsible sections.
- **Recharts** for the score trend chart on agent profiles. Only new dependency needed (~30KB gzipped). Install: `npm install recharts`
- **Framer Motion** for entrance animations (already in the project).

### Data fetching pattern
Follow the existing pattern from `app/components/landing/RecentlyDeployed.tsx`:
```typescript
const DEXTER_API_BASE = 'https://api.dexter.cash';
// or import from app/lib/.server/deployment/api-client.ts

// In a useEffect or server loader:
const res = await fetch(`${DEXTER_API_BASE}/api/trust/feed?limit=20`);
const data = await res.json();
```

### Server loaders (SSR)
The `/trust` and `/trust/review/:id` routes should use Remix server loaders for initial data. This enables:
- SSR for SEO (Google indexes the content)
- OpenGraph meta tags that work when shared on Twitter/social

```typescript
// app/routes/trust.tsx
export async function loader() {
  const [stats, feed] = await Promise.all([
    fetch(`${DEXTER_API_BASE}/api/trust/stats`).then(r => r.json()),
    fetch(`${DEXTER_API_BASE}/api/trust/feed?limit=20`).then(r => r.json()),
  ]);
  return json({ stats, feed });
}
```

Client-side fetch for pagination, filtering, tab changes.

### File structure
```
app/
  routes/
    trust.tsx                    ← main dashboard page
    trust.agent.$id.tsx          ← agent profile page
    trust.review.$id.tsx         ← single review receipt page
  components/
    trust/
      TrustHero.tsx
      TrustFeed.tsx
      FeedCard.tsx
      FeedFilters.tsx
      ScoreBadge.tsx
      ReceiptLinks.tsx
      AiReview.tsx
      TrustLeaderboard.tsx
      AgentRow.tsx
      TrustAbout.tsx
      AgentHeader.tsx
      ScoreTrendChart.tsx
      ReceiptChain.tsx
      TestDetails.tsx
```

### No wallet dependency
These pages are 100% public. No wallet connect. No auth. No Supabase session. Anyone with a browser can view everything.

### Mobile responsive
- Feed cards: full-width stack on mobile
- Leaderboard: becomes cards instead of table on mobile (< 768px)
- Receipt chain: vertical steps on mobile, horizontal on desktop
- Stats bar: 2x3 grid on mobile instead of 5-across

### Loading states
Skeleton cards (animated gray rectangles matching card shape). No spinners. Follow the existing pattern from `RecentlyDeployed.tsx`.

---

## 10. OpenGraph / share cards

The `/trust/review/:id` page MUST have dynamic OpenGraph tags. This is the viral mechanic — when someone shares a review link on Twitter, the card preview shows the score and AI assessment.

Use Remix's `meta` export:

```typescript
// app/routes/trust.review.$id.tsx
export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data?.verification) return [{ title: 'Trust Review | Dexter' }];

  const v = data.verification;
  const emoji = v.score >= 70 ? '✅' : v.score >= 40 ? '⚠️' : '❌';
  const title = `${emoji} ${v.score}/100 — ${v.endpoint.name || v.endpoint.url}`;
  const description = v.notes.slice(0, 200);

  return [
    { title: `${title} | Dexter Trust` },
    { name: 'description', content: description },
    { property: 'og:title', content: title },
    { property: 'og:description', content: description },
    { property: 'og:type', content: 'article' },
    { property: 'og:url', content: `https://lab.dexter.cash/trust/review/${v.id}` },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: title },
    { name: 'twitter:description', content: description },
  ];
};
```

---

## 11. What's already done

The backend pipeline is live and producing data. You don't need to worry about any of this — it's listed for context only.

| Component | Status |
|-----------|--------|
| Resource quality verifier (runs every 15 min) | ✅ Live, 28,942 assessments |
| AI evaluation (GPT-5.2 Codex) | ✅ Live |
| IPFS assessment uploads (Pinata) | ✅ Live, 192+ docs |
| 8004 on-chain feedback submission | ✅ Live, 60+ on-chain |
| Payment tx signature capture | ✅ Fixed (header parse + facilitator event fallback) |
| Settlement-rollup IPFS docs | ✅ Backfilled 544 items |
| Agent ID data integrity | ✅ All 12 Solana agents corrected |
| DB index for feed query JOIN | ✅ Added |
| **Backend API endpoints (`/api/trust/*`)** | **🔴 Not built yet — BE team builds from this spec** |

### Example IPFS assessments you can view right now

- **PASS (score 88):** https://gateway.pinata.cloud/ipfs/bafkreiclqnpds22dstkvrlldq4ipjgsivxlk35pv5sxo3zmwsn46jsara4
- **FAIL (score 20):** https://gateway.pinata.cloud/ipfs/bafkreiawnb6s3hz7sgp6hdg3dkydmjhe6x5gjh4m6s7ypunt4m7ebtdt5q
- **FAIL (score 8):** https://gateway.pinata.cloud/ipfs/bafkreiahoz2xcjkgntvyvp5dqukhselvujxwbwscnkvwqzyzqntflz52we

Click those links — that's the raw JSON that powers each review card.

### Existing 8004scan agent page (for reference)

https://www.8004scan.io/agents?id=CFdpZorXGX57aN3QxgB28KkxgcdWEfKnguVb1mBP6t47

This is "Dexter AI" on 8004scan — 55+ feedback entries. Our dashboard should be 10x better than this page.
