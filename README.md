# Homestead Matrix

Chat-built home rating matrix for family. **v1 grades a Redfin Favorites CSV** (the Valrico-area export is bundled). Users paste free-text gates in chat; the bot can only toggle a knowledge-base catalog.

## Local run

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) → **Continue in demo mode**.

1. **Matrix** — paste Mom’s gates (townhouse, garage, ≤3 stories, 2+ bed/bath, in-unit laundry, walkable, not high flood, long term) → **commit**.
2. **Search** — grades the bundled Redfin favorites; or upload a new Redfin CSV (Favorites → Download).

Redfin does not include garage, laundry, end unit, flood, or walkability. Mark those on a property page and regrade. Listing links use the CSV’s real Redfin URL.

## Alpha chat (free-tier AI)

No key required: a built-in keyword coach still applies catalog tools.

For a real LLM on the free/cheap path (OpenAI-compatible, drop-in):

| Provider | Env vars | Notes |
| --- | --- | --- |
| **OpenRouter Auto** (recommended) | `OPENROUTER_API_KEY`, optional `OPENROUTER_MODEL=openrouter/auto` | One key; Auto routes models. New accounts get credits. Free models: `meta-llama/llama-3.3-70b-instruct:free`, `google/gemini-2.0-flash-exp:free`. |
| **Groq** | `GROQ_API_KEY` | Fast Llama 3.3 70B free tier. |
| OpenAI | `OPENAI_API_KEY` | Paid; used if OpenRouter/Groq unset. |

Get an OpenRouter key at [openrouter.ai/keys](https://openrouter.ai/keys). Put it in `.env.local` and Vercel.

Priority: OpenRouter → Groq → OpenAI → built-in coach.

Other env vars: `NEXT_PUBLIC_SUPABASE_*` (family logins), `RENTCAST_API_KEY` (optional live search, not the v1 path).

## GitHub + Vercel

Create a GitHub repo, `git push`, Import in Vercel, paste env vars.

Supabase SQL: [`supabase/migrations/001_init.sql`](supabase/migrations/001_init.sql). Redirect URL: `https://<app>.vercel.app/auth/callback`.
