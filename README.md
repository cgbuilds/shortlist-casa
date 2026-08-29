# Homestead Matrix

Chat-built home rating matrix for family and friends. Users configure categories from a **fixed knowledge-base catalog** (not a blank spreadsheet). Search uses **RentCast** when an API key is present, otherwise Hillsborough **seed listings**. Results link out to Zillow, Redfin, Realtor.com, and the county appraiser. No scraping.

## Local run

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and click **Continue in demo mode**. Demo works with no keys.

Optional keys in `.env.local` / Vercel:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Auth + persistence for family accounts |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser/server Supabase client |
| `SUPABASE_SERVICE_ROLE` | Unused in v1 (reserved) |
| `OPENAI_API_KEY` | Matrix chatbot (without it, a keyword demo coach still mutates the catalog) |
| `OPENAI_MODEL` | Defaults to `gpt-4o-mini` |
| `RENTCAST_API_KEY` | Live sale listings / address lookup |
| `NEXT_PUBLIC_SITE_URL` | Canonical origin (logout/redirects) |

## GitHub

1. Create an empty repository on GitHub (private is fine).
2. From this folder:

```bash
git remote add origin git@github.com:<you>/<repo>.git
git branch -M main
git push -u origin main
```

## Vercel

1. [Import the GitHub repo](https://vercel.com/new) (framework: Next.js).
2. Paste the env vars above.
3. Deploy. First production URL is assigned automatically; add a custom domain later under Project → Settings → Domains.

## Supabase (family logins)

1. Create a project.
2. Authentication → enable Google and Email magic link. Add `https://<your-vercel-app>.vercel.app/auth/callback` to redirect URLs.
3. SQL editor: run [`supabase/migrations/001_init.sql`](supabase/migrations/001_init.sql).
4. Copy project URL and anon key into Vercel env.

v1 is **one matrix per login**. Share by using the same Google account, or each person builds their own.

## How it grades

Catalog lives in [`kb/catalog.ts`](kb/catalog.ts). The chatbot may only call tools (`list_catalog`, `set_dimension`, `set_budget`, `add_manual_rubric`, `preview_matrix`, `commit_matrix`). Scoring is [`lib/grade.ts`](lib/grade.ts). Unknown enrichable fields (roof, block vs frame) can be filled on the property page.

Paste a listing URL: we regex an address and look it up. We do not fetch Zillow HTML.
