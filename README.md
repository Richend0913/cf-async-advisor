# Cloudflare Async Advisor (AI-Powered)

**Live tool:** https://cf-async-advisor.burningbros.workers.dev

A free tool that answers: *"Should I use Cloudflare Queues, Workflows, Durable Objects, or Cron Triggers for this background job?"*

Describe the background/async behavior you're building, optionally add constraints (ordering needs, how long it can take, how often it runs), and an AI model recommends the best-fitting Cloudflare product — with reasoning tied to the specific facts (execution model, ordering guarantees, limits) that make it fit.

## Why this exists

Cloudflare shipped Workflows V2 in May 2026 (50,000 concurrent instances, up from 4,500), and "Queues vs Workflows vs Durable Objects vs Cron Triggers" now comes up repeatedly in architecture write-ups and community threads. As of the last check (2026-07-13), no interactive tool takes a specific use case and applies the official facts to it — only static comparison articles and separate docs pages per product. This tool is grounded (RAG-style) in a curated table of Cloudflare's own documented facts about all four products, and the model is explicitly instructed to only use those facts — not invent limits, pricing, or behavior that aren't listed, and not recommend any Cloudflare product outside this list.

## How it works

- A hardcoded table of the 4 core Cloudflare async/background-processing products, each with its execution model, ideal use cases, key limits, and a link to the source doc.
- User describes their use case in plain language (+ optional constraints).
- [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/) (`@cf/meta/llama-3.1-8b-instruct-fp8-fast`) is called with a system prompt restricting it to the documented facts, asked to recommend one primary product (and optionally one alternative if genuinely ambiguous — e.g. Queues and Workflows are often combined, not exclusive), or say what extra detail it would need instead of guessing.
- A small daily quota (tracked in Workers KV) caps total AI calls per day so the tool stays inside Cloudflare Workers AI's free Neuron allowance even under heavy or abusive traffic.

## Known limitation

The "related docs" badges shown under a result use a simple keyword regex (not the AI) to link to source docs, so phrasing like "no multi-step chain" can still surface a "Workflows" badge even though the AI's actual recommendation is correct. The recommendation text itself is the authoritative answer; the badges are a convenience, not a second opinion.

## Stack

- Single [Cloudflare Worker](https://developers.cloudflare.com/workers/) (`worker.js`), no framework, no build step.
- Bindings: Workers AI (`env.AI`) + one Workers KV namespace for the daily quota counter + one shared Workers KV namespace for the traffic counter.
- Deploy with [Wrangler](https://developers.cloudflare.com/workers/wrangler/):

```bash
npx wrangler kv namespace create ASYNC_QUOTA   # then put the returned id in wrangler.toml
npx wrangler deploy
```

## Keeping the facts current

Cloudflare occasionally changes limits, pricing, or adds new async/background-processing products. To refresh:

1. Check https://developers.cloudflare.com/queues/, /workflows/, /durable-objects/, /workers/platform/triggers/cron-triggers/ and their `platform/limits`/`reference/limits`/`reference/pricing` subpages.
2. Update the `ASYNC_DB` array in `worker.js` (keep entries sourced only from official docs).
3. Redeploy.

PRs that add more official-doc-sourced facts or fix bugs are welcome.

## Traffic

The Cloudflare GraphQL Analytics API isn't reachable from this project's deploy token (no `Account Analytics:Read` scope), so the Worker counts its own aggregate page views in KV: see `/stats` for the live numbers. It's a same-origin request counter only — no cookies, no per-visitor identifiers. Requests sending an `X-Skip-Analytics: 1` header or a common bot/test User-Agent (curl, Playwright, Googlebot, Discordbot, etc.) aren't counted.

## License

MIT — see [LICENSE](LICENSE).

## Related tools

Other free Cloudflare tools from the same project:

- [Workers AI Free Tier Neuron Calculator](https://workers-ai-cost-calculator.burningbros.workers.dev/) ([source](https://github.com/Richend0913/workers-ai-cost-calculator))
- [Cloudflare Error Code AI Explainer](https://cf-error-explainer.burningbros.workers.dev/) ([source](https://github.com/Richend0913/cf-error-explainer))
- [Cloudflare Storage Advisor (KV vs D1 vs R2 vs Durable Objects)](https://cf-storage-advisor.burningbros.workers.dev/) ([source](https://github.com/Richend0913/cf-storage-advisor))

---

Built by an AI-run micro-tool project ([BURNING AUTONOMY](https://github.com/Richend0913)). Independent, unofficial — not affiliated with or endorsed by Cloudflare, Inc. No signup, no per-visitor tracking — aggregate page-view counts only, published live at `/stats`.
