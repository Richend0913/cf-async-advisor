// Free tool: describe what you're building / what async behavior you need, and get an
// AI-personalized recommendation for which Cloudflare async/background primitive
// (Queues, Workflows, Durable Objects, Cron Triggers) fits — grounded only in Cloudflare's
// own official docs (RAG-lite: the model is restricted to the facts below, not allowed to
// invent limits/behavior that aren't listed).
// Built by BURNING AUTONOMY (Richend Digital / NEXT GROWTH).
// Data source: official Cloudflare docs (developers.cloudflare.com/workflows/,
// /workflows/reference/limits/, /workflows/reference/pricing/, /queues/,
// /queues/platform/limits/, /queues/platform/pricing/, /durable-objects/,
// /workers/platform/triggers/cron-triggers/, /workers/platform/limits/), checked 2026-07-13.
// Positioning: Cloudflare shipped Workflows V2 in May 2026 (50,000 concurrent instances,
// up from 4,500) and the "Queues vs Workflows vs Durable Objects" question now shows up
// repeatedly in architecture write-ups and community threads, but as of this check there is
// no interactive tool that takes a specific use case and applies the official facts to it —
// only static comparison articles and separate docs pages for each product.
// Unofficial, independent project — not affiliated with or endorsed by Cloudflare.

const SITE_URL = "https://cf-async-advisor.burningbros.workers.dev";
const REPO_URL = "https://github.com/Richend0913/cf-async-advisor";
const INDEXNOW_KEY = "479a9517b944475f4fe81d2f23622691";
const DATA_CHECKED = "2026-07-13";
const AI_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8-fast";
const DAILY_AI_CALLS_CAP = 300;
const MAX_OUTPUT_TOKENS = 320;

// Sibling free tools from the same project (BURNING AUTONOMY Track C). Cross-linking them is a
// zero-cost discovery aid: no new platform/account, just pointing visitors of one tool at the
// others. Filtered so each site never lists itself.
const RELATED_TOOLS = [
  { url: "https://workers-ai-cost-calculator.burningbros.workers.dev/", label: "Workers AI Free Tier Neuron Calculator" },
  { url: "https://cf-error-explainer.burningbros.workers.dev/", label: "Cloudflare Error Code AI Explainer" },
  { url: "https://cf-storage-advisor.burningbros.workers.dev/", label: "Cloudflare Storage Advisor (KV vs D1 vs R2 vs Durable Objects)" },
  { url: "https://cf-async-advisor.burningbros.workers.dev/", label: "Cloudflare Async Processing Advisor (Queues vs Workflows vs Durable Objects vs Cron)" },
].filter((t) => t.url !== SITE_URL + "/");
const RELATED_TOOLS_HTML = RELATED_TOOLS.map(
  (t) => `<a href="${t.url}" target="_blank" rel="noopener">${t.label}</a>`
).join(" &middot; ");

// Self-hosted traffic counter (same pattern across all Track C tools — see
// workers-ai-cost-calculator / cf-error-explainer / cf-storage-advisor). Built because the
// CF GraphQL Analytics API is unreachable with the deploy-time wrangler OAuth token (no
// Account Analytics:Read scope) — see track-c README/RUNLOG. Best-effort only: not deduped
// by visitor, no bot-detection beyond a common-crawler/self-test User-Agent filter, and
// concurrent KV writes can undercount slightly (eventual consistency). /stats is left public
// on purpose: publishing real measured numbers, even small ones, is the point (STRATEGY.md —
// verifiable measured data is how an anonymous AI-run tool earns trust).
const ANALYTICS_SITE = "cf-async-advisor";
const SELF_TEST_UA = /curl|Playwright|HeadlessChrome|python-requests|wrangler/i;
const KNOWN_BOT_UA = /discordbot|slackbot|telegrambot|whatsapp|facebookexternalhit|twitterbot|linkedinbot|skypeuripreview|redditbot|pinterest|iframely|googlebot|google-inspectiontool|bingbot|duckduckbot|yandexbot|baiduspider|applebot|petalbot|sogou|bytespider|ahrefsbot|semrushbot|mj12bot|dotbot|gptbot|chatgpt-user|ccbot|claudebot|anthropic-ai|perplexitybot|slurp|ia_archiver/i;

async function recordHit(env, request) {
  if (!env.ANALYTICS) return;
  if (request.headers.get("X-Skip-Analytics") === "1") return;
  const ua = request.headers.get("User-Agent") || "";
  if (SELF_TEST_UA.test(ua) || KNOWN_BOT_UA.test(ua)) return;
  const day = new Date().toISOString().slice(0, 10);
  const key = `hits:${ANALYTICS_SITE}:${day}`;
  const cur = await env.ANALYTICS.get(key);
  const n = (cur ? parseInt(cur, 10) || 0 : 0) + 1;
  await env.ANALYTICS.put(key, String(n), { expirationTtl: 60 * 60 * 24 * 400 });
}

async function statsResponse(env) {
  if (!env.ANALYTICS) {
    return new Response(JSON.stringify({ error: "analytics not configured" }), { status: 503, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }
  const list = await env.ANALYTICS.list({ prefix: `hits:${ANALYTICS_SITE}:` });
  const by_day = {};
  for (const k of list.keys) {
    const day = k.name.split(":")[2];
    const v = await env.ANALYTICS.get(k.name);
    by_day[day] = parseInt(v, 10) || 0;
  }
  const total = Object.values(by_day).reduce((a, b) => a + b, 0);
  const body = JSON.stringify({
    site: ANALYTICS_SITE,
    method: "self-hosted KV request counter on the '/' route only. Excludes requests sending an X-Skip-Analytics header, a self-test User-Agent (curl/Playwright/etc), or a known link-preview/search-crawler bot (Discordbot, Googlebot, Bingbot, GPTBot, etc). Not deduped by visitor. Not exact — measured trend only.",
    by_day,
    total,
  }, null, 2);
  return new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8" } });
}

// [id, name, model, idealUseCases[], limits[], freeTier, sourceUrl]
const ASYNC_DB = [
  [
    "queues",
    "Queues",
    "Fire-and-forget message passing with guaranteed delivery. No ordering guarantee, no step dependencies, no durable cross-step state — messages go in, a consumer Worker processes them, retries happen on failure.",
    ["Offloading slow work out of the request path (e.g. send email after signup)", "Worker-to-Worker communication / fan-out", "buffering or batching high-volume events before writing to storage", "simple retry-on-failure background jobs"],
    ["Max message size 128 KB", "max 100 messages per sendBatch (or 256 KB total)", "max consumer batch size 100 messages", "max batch wait time 60s", "message retries: 100", "consumer wall-clock duration 15 minutes", "per-queue throughput ~5,000 msg/s", "10,000 queues per account", "Free tier: 10,000 operations/day (Workers Free) or 1,000,000 operations/month included (Workers Paid), then $0.40/million"],
    "Free and Paid plans",
    "https://developers.cloudflare.com/queues/",
  ],
  [
    "workflows",
    "Workflows",
    "Durable multi-step execution with automatic retries and state that persists across steps for minutes to weeks. Each step's result is checkpointed, so a crash or redeploy resumes from the last completed step, not from zero.",
    ["Multi-step business processes where step order matters (e.g. onboarding: create account -> send email -> wait for verification -> provision resources)", "long-running jobs that need to sleep/wait (step.sleep, step.sleepUntil) for hours or days", "human-in-the-loop approval flows waiting on a webhook or external event", "data pipelines chaining several API calls with per-step retry"],
    ["Concurrent instances: 100 (Workers Free) / 50,000 (Workers Paid, up from 4,500 pre-V2)", "instance creation rate: 100/s (Free) / 300 per account & 100 per workflow per second (Paid)", "max steps per workflow: 1,024 (Free) / 10,000 default, configurable up to 25,000 (Paid)", "max step sleep duration: 365 days", "CPU time per step: 10ms (Free) / 30s default, up to 5 min (Paid)", "max persisted state per instance: 100MB (Free) / 1GB (Paid)", "max queued instances: 100,000 (Free) / 2,000,000 (Paid)", "state retention: 3 days (Free) / 30 days (Paid)", "Free tier: 100,000 requests/day (shared with Workers), 3,000 steps/day, 1GB storage; Paid: 10M requests/mo + $0.30/additional million, 500,000 steps/mo + $0.80/additional 100,000, step & storage billing starts 2026-08-10"],
    "Free and Paid plans",
    "https://developers.cloudflare.com/workflows/",
  ],
  [
    "do",
    "Durable Objects",
    "Strictly serializable, transactional, single-threaded coordination point with co-located compute and storage. Every request to the same Durable Object ID is handled by the exact same instance, in order — this is the strongest consistency and lowest coordination latency of the four, but one object is a single-threaded bottleneck if it needs very high write throughput.",
    ["Real-time collaboration (chat, multiplayer, live co-editing)", "per-user or per-tenant live state that many requests need to read/write with strict ordering", "rate limiters needing an exact, non-racy count", "AI agent session/conversation state", "WebSocket connection coordination"],
    ["SQLite-backed Durable Objects available on the Free plan", "single-threaded per object (correct, but a throughput ceiling for one hot object)", "global uniqueness: exactly one live instance per object ID worldwide at a time"],
    "Free and Paid plans",
    "https://developers.cloudflare.com/durable-objects/",
  ],
  [
    "cron",
    "Cron Triggers",
    "Time-based scheduled invocation of a Worker's scheduled() handler — no queue, no steps, no persisted cross-run state (each run is independent unless you read/write your own storage).",
    ["Periodic maintenance jobs (cache warming, cleanup)", "polling a third-party API on a fixed schedule to refresh cached data", "sending a daily/weekly digest", "any job that just needs to run on a clock, not react to an event or a chain of steps"],
    ["Max Cron Triggers per account: 5 (Workers Free) / 250 (Workers Paid)", "5-field cron syntax with Quartz-style extensions (L, W, #), UTC only", "schedule changes propagate within up to 15 minutes", "dashboard keeps the 100 most recent invocation logs"],
    "Free and Paid plans",
    "https://developers.cloudflare.com/workers/platform/triggers/cron-triggers/",
  ],
];

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const PAGE_TITLE = "Cloudflare Async Advisor (AI-Powered) — Queues vs Workflows vs Durable Objects vs Cron Triggers";
const PAGE_DESC = "Free tool: describe the background/async job you're building, get an AI recommendation for whether Cloudflare Queues, Workflows, Durable Objects, or Cron Triggers fits — grounded in Cloudflare's own official docs, not guesses.";

const SCHEMA_JSON = JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebApplication",
      "name": "Cloudflare Async Advisor",
      "url": SITE_URL,
      "description": PAGE_DESC,
      "applicationCategory": "DeveloperApplication",
      "operatingSystem": "Any (browser-based)",
      "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" },
      "browserRequirements": "Requires JavaScript",
      "isAccessibleForFree": true,
      "sameAs": [REPO_URL],
    },
    {
      "@type": "WebPage",
      "@id": SITE_URL + "/",
      "url": SITE_URL + "/",
      "name": PAGE_TITLE,
      "description": PAGE_DESC,
      "isPartOf": { "@type": "WebSite", "url": SITE_URL, "name": "Cloudflare Async Advisor" },
    },
  ],
});

const UI = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${PAGE_TITLE}</title>
<meta name="description" content="${PAGE_DESC}">
<link rel="canonical" href="${SITE_URL}/">
<meta property="og:type" content="website">
<meta property="og:title" content="${PAGE_TITLE}">
<meta property="og:description" content="${PAGE_DESC}">
<meta property="og:url" content="${SITE_URL}/">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${PAGE_TITLE}">
<meta name="twitter:description" content="${PAGE_DESC}">
<script type="application/ld+json">${SCHEMA_JSON}</script>
<style>
:root{--ac:#f6821f;--ac2:#f38020}
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,"Segoe UI",Roboto,sans-serif;background:#0c0f16;color:#e6e8ee;line-height:1.6}
.wrap{max-width:820px;margin:0 auto;padding:28px 16px 80px}
h1{font-size:1.4rem;margin:.2em 0 .1em}
.sub{color:#9aa3b2;font-size:.92rem;margin-bottom:10px}
.badge{display:inline-block;background:rgba(246,130,31,.15);color:#ffb066;border:1px solid rgba(246,130,31,.4);font-size:.72rem;padding:3px 10px;border-radius:999px;margin:2px 4px 2px 0}
.card{background:#121722;border:1px solid #202838;border-radius:14px;padding:20px;margin:18px 0}
label{display:block;font-size:.82rem;color:#9aa3b2;margin:14px 0 4px}
select,input,textarea{width:100%;background:#0c0f16;color:#e6e8ee;border:1px solid #2a3346;border-radius:8px;padding:10px;font:inherit;font-size:.95rem}
textarea{resize:vertical;min-height:90px}
button{margin-top:18px;background:linear-gradient(135deg,var(--ac),var(--ac2));color:#0c0f16;font-weight:800;border:0;border-radius:10px;padding:12px 18px;font-size:.95rem;cursor:pointer;width:100%}
button:disabled{opacity:.6;cursor:wait}
.result{margin-top:18px;padding:16px;border-radius:10px;font-size:.92rem;background:rgba(16,185,129,.1);border:1px solid rgba(16,185,129,.35);white-space:pre-wrap}
.err{background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.4)}
.hint{font-size:.78rem;color:#6b7385;margin-top:6px}
.foot{margin-top:26px;font-size:.8rem;color:#7b8496;border-top:1px solid #1c2432;padding-top:16px}
.foot a{color:#5eead4}
.src{font-size:.78rem;color:#6b7385;margin-top:10px}
.src a{color:#93c5fd}
.mat{display:inline-block;background:rgba(94,234,212,.12);color:#5eead4;border:1px solid rgba(94,234,212,.35);font-size:.78rem;padding:2px 8px;border-radius:6px;margin:2px 4px 2px 0}
</style></head><body>
<div class="wrap">
<h1>Cloudflare Async Advisor</h1>
<p class="sub">Describe the background job or async behavior you need — an AI model recommends Queues, Workflows, Durable Objects, or Cron Triggers, grounded in Cloudflare's own official docs.</p>
<span class="badge">Free</span><span class="badge">No login</span><span class="badge">Real AI inference</span><span class="badge">Grounded in official docs</span>

<div class="card">
<label for="usecase">What are you building, and what should happen in the background?</label>
<textarea id="usecase" placeholder="e.g. After a user signs up I need to send a welcome email, wait a day, then send a follow-up if they haven't logged in yet"></textarea>

<label for="ctx">Any constraints? (optional — e.g. ordering needs, how long it can take, how often it runs)</label>
<textarea id="ctx" placeholder="e.g. Steps must run in order and survive a redeploy; doesn't need to be instant"></textarea>

<button id="go">Get recommendation</button>
<div id="out"></div>
</div>

<div class="foot">
This tool grounds an AI model in a curated table of Cloudflare's own documented facts about
<a href="https://developers.cloudflare.com/queues/" target="_blank" rel="noopener">Queues</a>,
<a href="https://developers.cloudflare.com/workflows/" target="_blank" rel="noopener">Workflows</a>,
<a href="https://developers.cloudflare.com/durable-objects/" target="_blank" rel="noopener">Durable Objects</a>, and
<a href="https://developers.cloudflare.com/workers/platform/triggers/cron-triggers/" target="_blank" rel="noopener">Cron Triggers</a>
(execution model, ordering/consistency, limits, ideal use cases), then asks
<a href="https://developers.cloudflare.com/workers-ai/" target="_blank" rel="noopener">Cloudflare Workers AI</a>
to apply those facts to your specific use case — not invent new ones. Data checked ${DATA_CHECKED}.
This is an independent, unofficial tool — not affiliated with or endorsed by Cloudflare, Inc. No login, no tracking, no data stored.
Source code: <a href="${REPO_URL}" target="_blank" rel="noopener">open on GitHub</a>.
<br>More free Cloudflare tools from the same project: ${RELATED_TOOLS_HTML}
</div>
</div>
<script>
const useEl = document.getElementById('usecase');
const ctxEl = document.getElementById('ctx');
const out = document.getElementById('out');
const btn = document.getElementById('go');

function renderResult(data) {
  out.innerHTML = '';
  if (data.matched && data.matched.length) {
    const row = document.createElement('div');
    data.matched.forEach((m) => {
      const span = document.createElement('span');
      span.className = 'mat';
      span.textContent = m.name;
      row.appendChild(span);
    });
    out.appendChild(row);
  }
  const div = document.createElement('div');
  div.className = 'result';
  div.textContent = data.recommendation;
  out.appendChild(div);
  if (data.matched && data.matched.length) {
    const src = document.createElement('div');
    src.className = 'src';
    data.matched.forEach((m, i) => {
      if (i > 0) src.appendChild(document.createTextNode('  |  '));
      const a = document.createElement('a');
      a.href = m.sourceUrl; a.target = '_blank'; a.rel = 'noopener';
      a.textContent = 'Official ' + m.name + ' docs';
      src.appendChild(a);
    });
    out.appendChild(src);
  }
}

function renderError(msg) {
  out.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'result err';
  div.textContent = msg;
  out.appendChild(div);
}

btn.addEventListener('click', async () => {
  const usecase = useEl.value.trim();
  const ctx = ctxEl.value.trim();
  if (!usecase) {
    renderError('Describe what you are building first.');
    return;
  }
  btn.disabled = true; btn.textContent = 'Thinking…';
  try {
    const res = await fetch('/api/advise', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usecase, ctx }),
    });
    const data = await res.json();
    if (!res.ok) { renderError(data.error || 'Something went wrong.'); return; }
    renderResult(data);
  } catch (e) {
    renderError('Network error — please try again.');
  } finally {
    btn.disabled = false; btn.textContent = 'Get recommendation';
  }
});
</script>
</body></html>`;

const ROBOTS_TXT = `User-agent: *
Allow: /

Sitemap: ${SITE_URL}/sitemap.xml
`;

const SITEMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>${SITE_URL}/</loc><changefreq>monthly</changefreq><priority>1.0</priority></url>
</urlset>
`;

async function checkAndIncrementQuota(env) {
  const day = new Date().toISOString().slice(0, 10);
  const key = `quota:${day}`;
  const current = parseInt((await env.QUOTA.get(key)) || "0", 10);
  if (current >= DAILY_AI_CALLS_CAP) return false;
  await env.QUOTA.put(key, String(current + 1), { expirationTtl: 172800 });
  return true;
}

function buildPrompt(usecase, ctx) {
  const factSheet = ASYNC_DB.map(
    ([id, name, model, uses, limits, freeTier]) =>
      `${name}:\n  Execution model: ${model}\n  Ideal for: ${uses.join(", ")}\n  Key limits: ${limits.join("; ")}\n  Plan: ${freeTier}`
  ).join("\n\n");

  return [
    {
      role: "system",
      content:
        "You are a terse, accurate Cloudflare async/background-processing advisor. You must ONLY use the official " +
        "facts about Queues, Workflows, Durable Objects, and Cron Triggers given below — do not invent limits, pricing, " +
        "or behavior that isn't listed, and do not recommend any other Cloudflare product not in this list. Recommend " +
        "ONE primary product (name it first), and optionally ONE alternative if the use case is genuinely ambiguous " +
        "between two (e.g. Queues + Workflows are often combined, not exclusive — say so if relevant). Justify the " +
        "recommendation by citing the specific facts (execution model, ordering, limits) that make it fit. If the " +
        "description is too vague to recommend confidently, say exactly what extra detail you'd need instead of " +
        "guessing. Keep the answer under 150 words, plain text, no markdown headers.",
    },
    {
      role: "user",
      content:
        `Official Cloudflare async/background-processing facts:\n${factSheet}\n\n` +
        `User's use case: ${usecase}\n` +
        `User's extra constraints (may be empty): ${ctx || "(none)"}\n\n` +
        "Recommend the best-fitting product(s) for this use case.",
    },
  ];
}

function detectMatches(usecase, ctx) {
  const text = `${usecase} ${ctx}`.toLowerCase();
  const hits = [];
  if (/\bqueue|fan-?out|offload|fire-?and-?forget|buffer/.test(text)) hits.push(ASYNC_DB[0]);
  if (/workflow|multi-?step|durable execution|sleep\(|retry chain|onboarding|pipeline/.test(text)) hits.push(ASYNC_DB[1]);
  if (/durable object|\bdo\b|real-?time|collab|chat|multiplayer|coordination|rate limit/.test(text)) hits.push(ASYNC_DB[2]);
  if (/\bcron\b|schedule|periodic|daily|weekly|nightly|maintenance/.test(text)) hits.push(ASYNC_DB[3]);
  return hits;
}

export default {
  async fetch(request, env, execCtx) {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "") {
      if (execCtx) execCtx.waitUntil(recordHit(env, request));
      return new Response(UI, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    if (url.pathname === "/stats") {
      return statsResponse(env);
    }
    if (url.pathname === "/robots.txt") {
      return new Response(ROBOTS_TXT, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    if (url.pathname === "/sitemap.xml") {
      return new Response(SITEMAP_XML, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
    }
    if (url.pathname === `/${INDEXNOW_KEY}.txt`) {
      return new Response(INDEXNOW_KEY, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }

    if (url.pathname === "/api/advise" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: "Invalid request body." }, { status: 400 });
      }
      const usecase = String(body.usecase || "").slice(0, 1500);
      const ctx = String(body.ctx || "").slice(0, 800);
      if (!usecase.trim()) {
        return Response.json({ error: "Describe what you are building first." }, { status: 200 });
      }

      const okQuota = await checkAndIncrementQuota(env);
      const matched = detectMatches(usecase, ctx).map(([id, name, , , , , sourceUrl]) => ({ name, sourceUrl }));

      if (!okQuota) {
        return Response.json(
          {
            error: "This tool's free daily AI recommendation quota is used up for today — please try again tomorrow.",
            matched,
          },
          { status: 200 }
        );
      }

      try {
        const messages = buildPrompt(usecase, ctx);
        const aiResp = await env.AI.run(AI_MODEL, { messages, max_tokens: MAX_OUTPUT_TOKENS });
        const recommendation = (aiResp && (aiResp.response || aiResp.result)) || "";
        if (!recommendation) throw new Error("empty AI response");
        return Response.json({ recommendation, matched });
      } catch (e) {
        return Response.json(
          { error: "The AI model didn't respond — please try again in a moment.", matched },
          { status: 200 }
        );
      }
    }

    return new Response("Not found", { status: 404 });
  },
};
