# Spectrum CRM & Agile Platform

`crm.spectrumgroup.id` — HubSpot-style CRM (contacts, companies, deals, tickets, quotes, activity
timelines) and Jira-style delivery (projects, sprints, epics, issues) in one keyboard-first workspace,
with first-class links between the two ("deal blocked by UAV-102", "ticket escalated to IOT-201").

Built with Next.js 15 (App Router) on Cloudflare Workers via OpenNext, Tailwind (Spectrum Group
tokens — see [docs/BRAND.md](docs/BRAND.md)), Zustand, @hello-pangea/dnd and Cloudflare D1 + Drizzle.

## What's in Phase 1

| Area | Route | Highlights |
|---|---|---|
| Deal pipeline | `/deals` | Drag-and-drop stages, per-stage totals and weighted value, forecast strip, Jira blocker flags, table view |
| Contacts | `/contacts` | Smart lists (hot leads, MQL→SQL, going cold, ≥ Rp 2B pipeline…), filters, inline lifecycle edit, bulk actions, j/k navigation |
| Companies | `/companies` | Org hierarchy, tiers, open pipeline, domain enrichment, bulk enrich |
| Record view | `/contacts/[id]`, `/companies/[id]`, `/deals/[id]`, `/tickets/[id]` | 3 panes: editable properties · unified timeline (notes, emails, calls, meetings, tasks, Jira updates) · associations incl. linked Jira work, line items, quotes |
| Agile board | `/board` | Columns by status, sprint **or linked deal stage**; swimlanes by epic, assignee or customer account; sprint capacity bars; quick filters |
| Issue drawer | any page | Slide-over with status (1–5 keys), fields, sub-tasks, comments, linked CRM records |
| Command palette | `⌘K` | Global search across contacts, companies, deals, tickets and issues; quick actions (log call, create issue/deal/contact/company, generate quote) |

Press `?` in the app for every shortcut.

Phases 2–4 (backlog & sprint planner, JQL bar, ticket pipeline, sequences, CPQ, workflow engine,
analytics, production deploy) build on the same store and schema.

## Data

- **Schema:** `src/db/schema.ts` (Drizzle) ↔ `drizzle/migrations/0000_init.sql`. Covers users, companies
  (with parent hierarchy), contacts, pipelines/stages, deals, deal_contacts, tickets, products, line items,
  quotes, activities + polymorphic activity_links, projects, sprints, epics, issues, comments,
  **cross_links** (the HubSpot⇄Jira bridge), email templates, sequences, enrollments and workflows.
- **D1:** database `spectrum-crm` (`3e0b5192-7ade-44d3-b9d6-2ae0b9a383df`, APAC) — migration `0000_init.sql`
  is already applied.
- **Seed:** `src/lib/seed.ts` is the single source of demo data (all organisations fictional).
  `npm run db:seed-sql` regenerates `drizzle/seed.sql`; CI fails if it drifts.
- **UI state:** Phase 1 runs on a client store (`src/lib/store.ts`) seeded from the same module and
  persisted to `localStorage`, so every view is interactive immediately. "Reset demo data" in the sidebar
  restores the seed.

## Develop

```bash
npm install
npm run dev            # http://localhost:3000
npm run typecheck
npm run preview        # build + run on the Workers runtime locally
```

## Database

```bash
npm run db:migrate:remote                     # apply migrations to D1
npm run db:seed-sql && npm run db:seed:remote # load demo data into D1
# or, once deployed:  wrangler secret put SEED_TOKEN
#                     curl -X POST https://crm.spectrumgroup.id/api/admin/seed -H "Authorization: Bearer <token>"
curl https://crm.spectrumgroup.id/api/health  # D1 connectivity + row counts
```

## Deploy (Cloudflare)

`wrangler.jsonc` targets the Worker **`crm`** — the one that owns `crm.spectrumgroup.id` — with the D1
binding `DB` and the custom-domain route. `npx wrangler deploy` builds the OpenNext bundle automatically
if it is missing (`scripts/ensure-open-next-build.mjs`), so any of these work:

- **Workers Builds (Git-connected):** Cloudflare → Workers & Pages → `crm` → Settings → Builds → connect
  `SpectrumSandbox/crm`, branch `main`. Build command `npx opennextjs-cloudflare build`
  (or leave empty), deploy command `npx wrangler deploy`. Every push to `main` deploys.
- **GitHub Actions:** add repo secrets `CLOUDFLARE_API_TOKEN` (template "Edit Cloudflare Workers" + D1 edit)
  and `CLOUDFLARE_ACCOUNT_ID`; the `deploy` job in `.github/workflows/ci.yml` then deploys every push to
  `main` and smoke-tests the live domain.
- **Manual:** `npx wrangler login && npm run deploy`.
