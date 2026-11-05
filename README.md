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
- **UI state:** the app runs on a client store (`src/lib/store.ts`) seeded from the same module and
  persisted to `localStorage`, so every view is interactive immediately. Settings › Data (`/settings`)
  downloads a `.json` backup, restores one (shape-checked, with Undo) and resets to the demo seed.
- **Shared workspace (snapshot sync):** every browser keeps a full local copy and syncs *all* seed
  collections as one versioned JSON snapshot in D1 (`workspace_snapshots`, migration `0002_workspace.sql`).
  `GET /api/workspace` returns `{ version, data, updatedAt, updatedBy }` (404 when none yet — the first browser
  bootstraps it); `PUT /api/workspace { baseVersion, data }` only lands if the stored version still equals
  `baseVersion` (optimistic concurrency), otherwise 409 returns the current snapshot. The client
  (`src/lib/sync/engine.ts`, mounted by `WorkspaceSync`) pushes 1.5 s after the last edit, polls every 30 s
  while the tab is visible, and on a conflict merges your edits record by record onto the newer server copy
  (see [Conflicts](#conflicts)). On `401`/`403` it shows *locked* and stops polling; when the API is down it backs off
  exponentially (30 s → 10 min). It tracks
  the version its data is based on in `localStorage` (`sg-crm-sync`). Snapshots are tagged with the store's
  persist version, so a browser on an older build never overwrites newer-format data. Without the API
  (plain `next dev` without D1, CI) it shows *offline* and keeps working locally. Bodies over 4 MB are
  rejected; note D1 caps one row at ~2 MB (the demo workspace is ~0.2 MB), so the client refuses to push above
  1.9 MB and Settings › Inventory shows the largest collections. Status, "Sync now", "Overwrite
  server with this browser" and "Reload from server" live in the sidebar indicator and Settings.
- **Migrations 0002 (snapshot) and 0004 (audit trail + history) must be applied** before sync works fully: `npm run db:migrate:remote` (and
  `npm run db:migrate:local` for `next dev`). `/api/health` reports per-table row counts (null = table
  missing) and the snapshot version; Settings › System health shows the same.
- **Identity:** production sits behind Cloudflare Access (Google SSO); see [Security & access](#security--access).
  `GET /api/me` verifies the Access JWT and resolves the email → workspace user → HR record on the server, returning
  `{ email, authenticated, mode, access: { userId, roles, scope, admin } }`. A matching `users[].email` becomes the current
  user and every write is recorded under the verified email. A signed-in person with **no** matching user record gets
  no roles, no pay data and **cannot act as anyone** ("No workspace user — ask HR to add you"). Only without Access
  (local dev, CI, an explicit anonymous demo) is the app in *demo mode*: the sidebar "Acting as" menu (remembered in
  `sg-crm-acting-as`) switches between users and writes are labelled `demo:<email>`. Demo identities are not
  authentication.
- **Relational tables vs snapshot:** `/api/admin/seed` (also in Settings › Admin, with the `SEED_TOKEN`)
  wipes and reloads D1's relational tables only; it does not touch the shared workspace snapshot.

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
binding `DB` and the custom-domain route. The OpenNext bundle is built automatically when it's missing:
inside Workers Builds by the `postinstall` hook (`WORKERS_CI=1`), elsewhere by wrangler's custom build
(`scripts/ensure-open-next-build.mjs`). Node 22 is pinned via `.node-version`. Any of these work:

- **Workers Builds (Git-connected):** Cloudflare → Workers & Pages → `crm` → Settings → Builds → connect
  `SpectrumSandbox/crm`, branch `main`. Build command can stay empty, deploy
  command `npx wrangler deploy` (the defaults). Every push to `main` deploys.
- **GitHub Actions:** add repo secrets `CLOUDFLARE_API_TOKEN` (template "Edit Cloudflare Workers" + D1 edit)
  and `CLOUDFLARE_ACCOUNT_ID`; the `deploy` job in `.github/workflows/ci.yml` then deploys every push to
  `main` and smoke-tests the live domain.
- **Manual:** `npx wrangler login && npm run deploy`.

## Security & access

### Cloudflare Access (required for shared data in production)

1. Zero Trust → Access → Applications → **Add a self-hosted application** for `crm.spectrumgroup.id` with the
   Google identity provider and a policy that allows the company domain (e.g. *Emails ending in* `@spectrumgroup.id`).
2. Add the other hostnames the Worker answers on to the **same** application: `crm.<account>.workers.dev` and the
   preview URLs (`*-crm.<account>.workers.dev`). `wrangler.jsonc` enables `workers_dev` and `preview_urls`; a hostname
   that is not behind Access can be reached without signing in. The API still verifies the Access JWT, so such a
   request gets no data — but the safest setup is to protect them too or set `"workers_dev": false, "preview_urls": false`.
3. Copy the application's **Audience (AUD) tag** and set the Worker variables (dashboard → Workers → `crm` →
   Settings → Variables, or `wrangler.jsonc` `vars`):

| Variable | Example | Meaning |
|---|---|---|
| `CF_ACCESS_TEAM_DOMAIN` | `spectrumgroup.cloudflareaccess.com` | Team domain whose signing keys (`/cdn-cgi/access/certs`) verify the `Cf-Access-Jwt-Assertion` JWT (RS256, `aud`, `exp`, `iss` checked). |
| `CF_ACCESS_AUD` | `4714c1…` | Audience tag of the Access application. |
| `WORKSPACE_ADMINS` | `bennaya@spectrumgroup.id, maria.gunadi@spectrumgroup.id` | Break-glass admins: always full data + admin tools, even before their user record exists (needed to create the shared workspace once admins are listed). |
| `ALLOW_ANONYMOUS_WORKSPACE` | `1` | **Demo only.** Lets browsers without Access read/write the shared workspace. Never with real data. |
| `ALLOW_ANONYMOUS_PAY_DATA` | `1` | **Demo only**, with the flag above: anonymous browsers also get pay data (fictional seed). |
| `SEED_TOKEN` (secret) | `wrangler secret put SEED_TOKEN` | Enables `POST /api/admin/seed`; the caller must also be a workspace admin. |

Without `CF_ACCESS_*` in production (`APP_ENV=production`) the workspace API answers `401 access_not_configured`;
the app shows *"Shared workspace locked — working on this device only"*, keeps working on local data, stops polling
(retries every 10 minutes or on *Retry now*) and explains the fix in Settings › Identity & security. The
`Cf-Access-Authenticated-User-Email` header alone is never trusted. After enabling Access, make sure each person's
`users[].email` is their SSO address (the demo seed uses `bennaya@kusuma.group` for the CEO — change it, or list the
SSO address in `WORKSPACE_ADMINS`).

### Personal data on the server (§13.4, UU PDP)

- **Read:** `GET /api/workspace` sends individual pay and HR status data in full only to people whose HR record holds a
  pay role (Finance, HR, PRC, CEO, CFO, ExCo — `src/lib/access-control.ts` / `src/lib/sync/server-policy.ts`).
  Everyone else receives their **own** bonus lines, deferrals, probation and clawback rows, and colleagues' HR records
  without salary or disciplinary detail (a single `goodStanding` flag keeps eligibility checks working). Collections other
  modules add later are classified by name (payroll, bonus, salary, statement, PPh …). The browser replaces any older full
  copy in `localStorage` as soon as the server reports the narrower scope.
- **Write:** `PUT /api/workspace` merges on the server. Non-pay writers can't change restricted collections (the stored
  copy is kept), may only edit self-service fields of their own HR row (e.g. the Annex B signature), and can't add or
  remove HR rows. Governance roles change only for admins; login emails and user rows only for HR/CEO/CFO. `auditLog` is
  append-only for everyone (restore, overwrite or "Keep mine" can't erase it). Non-admin writes that would delete more
  than half of a collection (≥ 20 rows) or more than 200 records are rejected (`403 bulk_delete_blocked`).
- **Admin-only:** Settings › Data (backup, restore, reset), audit trail, version history and D1 seeding — CEO/CFO or
  `WORKSPACE_ADMINS`, enforced on the server for the API routes.
- **Backups** downloaded by an admin contain personal data: keep them encrypted, delete them when done.
- **Processing record (summary):** the programme module processes salary, employment status, disciplinary flags,
  bonus, deferral, probation and clawback data of employees for the purpose of the Project Initiative & Compensation
  Policy, on the basis of the employment contract and legal obligations (not consent). It is stored in Cloudflare D1
  (`spectrum-crm`, APAC location hint) and in signed-in browsers (own data only for non-pay roles). Retention: 10 years
  for financial and bonus records (§13.3); the audit trail is kept for the same period. Data-subject access: each
  person sees their own data on `/me`. Breach handling: notify the data subjects and the authority within 3×24 hours
  (UU PDP Art. 46) — revoke sessions in Zero Trust, rotate `SEED_TOKEN`, review Settings › Audit trail.

### Audit trail and version history (migration 0004)

`drizzle/migrations/0004_workspace_audit.sql` adds:

- `workspace_audit` — one row per write: server time, actor (verified email / `demo:` label), source, matched user,
  data scope, action (`create`, `update`, `rejected`, `rollback`, `admin_seed`), client-declared reason (`edit`,
  `bootstrap`, `upgrade`, `overwrite`, `restore`, `reset`, `merge`), base → new version, bytes, per-collection
  added/changed/removed counts, collections the server protected, user agent and IP. **Append-only**: triggers reject
  every `UPDATE` and `DELETE`. Read it in Settings › Audit trail (CSV export) or `GET /api/audit?limit=&before=&actor=&action=`.
- `workspace_snapshot_history` — the version each write replaces (last 20 + the last of each day for 30 days).
  Settings › Version history (or `POST /api/workspace/history { version }`) rolls back by writing the old data as a
  **new** version; the audit log entries recorded since are kept.

Until 0004 is applied, writes still work; the audit trail and history are simply off (Settings › System health warns).

### Conflicts

On a `409` the client merges record by record (rows keyed by `id` / `userId`) against the last server copy it saw:
your additions, edits and deletions are re-applied on top of the newer version; where both sides changed the same
record, the server's copy is kept (a certification or release made elsewhere is never undone silently).

### Headers and CSRF

`src/middleware.ts` sets a Content-Security-Policy (same-origin scripts, styles, fonts and API; no `eval` in production;
`frame-ancestors 'none'`; `object-src 'none'`), `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`,
`Permissions-Policy`, HSTS, `Cross-Origin-Opener-Policy`/`-Resource-Policy`, and `no-store` on every API response.
Write endpoints reject cross-site requests (`Origin` / `Sec-Fetch-Site`). `/api/health` returns liveness only to
anonymous callers; table counts and the security configuration need a signed-in user.
