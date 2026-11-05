# QA journeys — 32/32 passed

Commit `9a0636e` · 2026-11-05T14:10:15.606Z

| # | Journey | Result | Time | Failure |
|---|---|---|---|---|
| 1 | Deals — create a deal via the dialog and see it on the board | pass | 3.6s |  |
| 2 | Deals — drag a deal to the next stage (keyboard drag) and it persists | pass | 5.7s |  |
| 3 | Deals — quick-edit the amount from the card, then Undo | pass | 2.5s |  |
| 4 | Deals — page filter via the / shortcut narrows the board | pass | 1.6s |  |
| 5 | Deals — delete from the record page, then Undo restores it | pass | 2.2s |  |
| 6 | Contacts — log a call from the record quick actions | pass | 1.8s |  |
| 7 | Contacts — L shortcut opens Log call on a record | pass | 1.6s |  |
| 8 | Contacts — duplicate warnings in Create contact | pass | 2.2s |  |
| 9 | Contacts — smart list tab + Export CSV downloads the rows in view | pass | 2.1s |  |
| 10 | Contacts table — j / Enter opens the focused row; Alt+→ walks to the next record | pass | 2.0s |  |
| 11 | Deal record — Propose initiative link prefills a PRC proposal | pass | 1.7s |  |
| 12 | Companies — duplicate domain blocks Create company | pass | 1.6s |  |
| 13 | Tickets — create a ticket and move it to the next stage | pass | 3.5s |  |
| 14 | ⌘K palette — search a contact and an issue, open them | pass | 2.2s |  |
| 15 | Keyboard — G-shortcuts navigate and ? opens the shortcut sheet | pass | 4.9s |  |
| 16 | Notifications — bell opens and Mark all read clears the badge | pass | 1.6s |  |
| 17 | Settings — Download backup produces a JSON workspace snapshot | pass | 1.5s |  |
| 18 | Not found — branded 404 with working links | pass | 1.6s |  |
| 19 | Mobile 390px — navigation drawer opens, navigates and closes | pass | 2.2s |  |
| 20 | Mobile 390px — no page scrolls horizontally | pass | 13.7s |  |
| 21 | Board — j/k focus and Shift+→ moves an issue to the next column | pass | 1.7s |  |
| 22 | Issue drawer — open UAV-102 and set status with the 5 key | pass | 2.4s |  |
| 23 | Backlog — create a sprint, complete the active one, start the new one | pass | 2.4s |  |
| 24 | Backlog — quick-add an issue to the backlog | pass | 1.5s |  |
| 25 | Issues — bulk-select two issues and set status Done, then Undo | pass | 2.2s |  |
| 26 | Projects register — register a project, add people, figures, payment, PRC ratification | pass | 4.0s |  |
| 27 | Initiatives — new proposal prefilled from a deal (?fromDeal=) and saved as draft | pass | 1.6s |  |
| 28 | Initiatives — propose a team amendment and record a vote | pass | 3.5s |  |
| 29 | Compensation — change monthly-cycle inputs and save provisional bonuses | pass | 3.9s |  |
| 30 | People — Add person dialog creates an HR record | pass | 2.6s |  |
| 31 | My compensation — sign the Project Participation Agreement (Annex B) | pass | 2.0s |  |
| 32 | Policy — search highlights matches and anchors jump to sections | pass | 5.9s |  |

## Details

### ✓ Deals — create a deal via the dialog and see it on the board

- ok — open /deals
- ok — open the Create deal dialog
- ok — fill name, amount and company
- ok — submit and land on the new deal record
- ok — deal card shows on the board in the first stage
- screenshots: `deals-create-a-deal-via-the-dialog-and-see-it-on-the-board.png`

### ✓ Deals — drag a deal to the next stage (keyboard drag) and it persists

- ok — open /deals
- ok — keyboard-drag the first Discovery card one column right
- ok — stage survives a reload
- ok — record page shows the new stage
- note: deal d-rct-fire: st-discovery → st-qualified
- screenshots: `deals-drag-a-deal-to-the-next-stage-keyboard-drag-and-it-persists.png`

### ✓ Deals — quick-edit the amount from the card, then Undo

- ok — open /deals
- ok — open the quick-edit popover
- ok — change the amount and save
- ok — re-opened popover shows the saved amount
- ok — Undo from a second edit's toast restores the amount
- screenshots: `deals-quick-edit-the-amount-from-the-card-then-undo.png`

### ✓ Deals — page filter via the / shortcut narrows the board

- ok — open /deals
- ok — press / and type a company prefix
- ok — only matching deals remain
- screenshots: `deals-page-filter-via-the-shortcut-narrows-the-board.png`

### ✓ Deals — delete from the record page, then Undo restores it

- ok — open the deal record
- ok — Actions → Delete deal
- ok — confirm delete → back on /deals with an Undo toast
- ok — Undo restores the deal and reopens it
- screenshots: `deals-delete-from-the-record-page-then-undo-restores-it.png`

### ✓ Contacts — log a call from the record quick actions

- ok — open contact Hendra Gunawan
- ok — click the Call quick action
- ok — fill subject, outcome and notes; submit
- ok — call appears on the timeline
- screenshots: `contacts-log-a-call-from-the-record-quick-actions.png`

### ✓ Contacts — L shortcut opens Log call on a record

- ok — open contact Rina Susanto
- ok — press L
- ok — Escape closes it
- screenshots: `contacts-l-shortcut-opens-log-call-on-a-record.png`

### ✓ Contacts — duplicate warnings in Create contact

- ok — open /contacts and the Create contact dialog
- ok — existing email blocks creation
- ok — new email + same name at same company only warns
- ok — create anyway → lands on the new contact
- screenshots: `contacts-duplicate-warnings-in-create-contact.png`

### ✓ Contacts — smart list tab + Export CSV downloads the rows in view

- ok — open /contacts
- ok — switch to the Hot leads smart list
- ok — Export CSV downloads a file with the same row count
- note: hot leads in view: 7
- note: downloaded contacts-hot-leads-2026-11-05.csv
- screenshots: `contacts-smart-list-tab-export-csv-downloads-the-rows-in-view.png`

### ✓ Contacts table — j / Enter opens the focused row; Alt+→ walks to the next record

- ok — open /contacts
- ok — press j then Enter
- ok — Alt+ArrowRight opens the next contact
- note: opened /contacts/k-budi
- screenshots: `contacts-table-j-enter-opens-the-focused-row-alt-walks-to-the-next-record.png`

### ✓ Deal record — Propose initiative link prefills a PRC proposal

- ok — open deal d-nhs-ai
- ok — click Propose initiative
- screenshots: `deal-record-propose-initiative-link-prefills-a-prc-proposal.png`

### ✓ Companies — duplicate domain blocks Create company

- ok — open /companies and press C
- ok — an existing domain is flagged and blocks saving
- screenshots: `companies-duplicate-domain-blocks-create-company.png`

### ✓ Tickets — create a ticket and move it to the next stage

- ok — open /tickets
- ok — New ticket dialog → fill subject and company
- ok — create → toast and card on the board
- ok — keyboard-drag the ticket one stage right
- note: ticket t-1010: ts-new → ts-waiting
- screenshots: `tickets-create-a-ticket-and-move-it-to-the-next-stage.png`

### ✓ ⌘K palette — search a contact and an issue, open them

- ok — open /home
- ok — Ctrl+K, type 'Rina', pick the contact
- ok — Ctrl+K, type 'UAV-102', open the issue drawer
- screenshots: `k-palette-search-a-contact-and-an-issue-open-them.png`

### ✓ Keyboard — G-shortcuts navigate and ? opens the shortcut sheet

- ok — open /home
- ok — g d → /deals
- ok — g c → /contacts
- ok — g b → /board
- ok — g i → /initiatives
- ok — g j → /projects
- ok — g k → /policy
- ok — g y → /me
- ok — ? opens Keyboard shortcuts
- screenshots: `keyboard-g-shortcuts-navigate-and-opens-the-shortcut-sheet.png`

### ✓ Notifications — bell opens and Mark all read clears the badge

- ok — open /home
- ok — open the bell
- ok — Mark all read → bell has no unread count
- note: bell label: Notifications, 8 unread
- screenshots: `notifications-bell-opens-and-mark-all-read-clears-the-badge.png`

### ✓ Settings — Download backup produces a JSON workspace snapshot

- ok — open /settings
- ok — click Download backup (.json)
- note: downloaded spectrum-crm-backup-2026-11-05.json
- note: backup keys: users, companies, contacts, pipelines, deals, tickets, products, lineItems, quotes, activities, projects, sprints…
- screenshots: `settings-download-backup-produces-a-json-workspace-snapshot.png`

### ✓ Not found — branded 404 with working links

- ok — open a missing route
- ok — Deals link goes to /deals
- screenshots: `not-found-branded-404-with-working-links.png`

### ✓ Mobile 390px — navigation drawer opens, navigates and closes

- ok — open /deals at 390×844
- ok — Open navigation shows the drawer
- ok — tap Contacts → /contacts and the drawer closes
- ok — search button opens the palette
- screenshots: `mobile-390px-navigation-drawer-opens-navigates-and-closes.png`

### ✓ Mobile 390px — no page scrolls horizontally

- ok — measure /home
- ok — measure /deals
- ok — measure /contacts
- ok — measure /tickets
- ok — measure /board
- ok — measure /initiatives
- ok — measure /projects
- ok — measure /compensation
- ok — measure /people
- ok — measure /me
- ok — measure /policy
- ok — measure /settings
- ok — no page wider than the viewport
- note: no horizontal overflow
- screenshots: `mobile-390px-no-page-scrolls-horizontally.png`

### ✓ Board — j/k focus and Shift+→ moves an issue to the next column

- ok — open /board
- ok — press j twice then Shift+ArrowRight
- ok — the issue card now sits in the announced column
- note: toast: UAV-104 → In Progress
- screenshots: `board-j-k-focus-and-shift-moves-an-issue-to-the-next-column.png`

### ✓ Issue drawer — open UAV-102 and set status with the 5 key

- ok — open /board?issue=UAV-102
- ok — drawer shows UAV-102
- ok — press 5 (Done) and close
- ok — card is in the Done column
- screenshots: `issue-drawer-open-uav-102-and-set-status-with-the-5-key.png`

### ✓ Backlog — create a sprint, complete the active one, start the new one

- ok — open /backlog
- ok — Create sprint
- ok — complete the active sprint (if any)
- ok — start the next sprint — the new one, or the one planned before it
- note: created UAV Sprint 26
- note: UAV Sprint 26 can't start yet: Start UAV Sprint 25 first — it is planned before UAV Sprint 26. Change the dates to reorder.
- screenshots: `backlog-create-a-sprint-complete-the-active-one-start-the-new-one.png`

### ✓ Backlog — quick-add an issue to the backlog

- ok — open /backlog
- ok — type a summary and press Enter
- screenshots: `backlog-quick-add-an-issue-to-the-backlog.png`

### ✓ Issues — bulk-select two issues and set status Done, then Undo

- ok — open /issues
- ok — select the first two rows
- ok — Status → Done
- ok — Undo from the toast
- note: selected IOT-208, UAV-111
- note: Status → Done — 2 of 2 issues selected
- screenshots: `issues-bulk-select-two-issues-and-set-status-done-then-undo.png`

### ✓ Projects register — register a project, add people, figures, payment, PRC ratification

- ok — open /projects → Register project
- ok — name it and register → project page
- ok — add an existing person as Project Lead
- ok — add a new person (not yet in the system)
- ok — enter the expected case and save figures
- ok — record a collected client payment
- ok — open PRC ratification
- ok — payment work period ends today (5 Nov), the default "Work period to"
- note: blocked by policy — Dimas Saputra: Leadership capacity would reach 2.50 of 2.0 (2.00 used + 0.50 for a Type B lead role) — §7.3
- note: Project Lead: Nadia Rahman
- note: ratification blocked — Fix first: Role and Weight Agreement signed by every member · Line manager agreement to the time
- note: work period shown: 5 Nov – 5 Nov INV-QA-001 milestone 1
- screenshots: `projects-register-register-a-project-add-people-figures-payment-prc-ratification.png`

### ✓ Initiatives — new proposal prefilled from a deal (?fromDeal=) and saved as draft

- ok — open /initiatives/new?fromDeal=d-nhs-ai
- ok — prefill toast and project name filled from the deal
- ok — Save draft
- note: prefilled name: Seabed Classification AI
- screenshots: `initiatives-new-proposal-prefilled-from-a-deal-fromdeal-and-saved-as-draft.png`

### ✓ Initiatives — propose a team amendment and record a vote

- ok — open the SBS initiative → Team tab
- ok — Propose amendment → add a member
- ok — circulate to the team
- ok — as a current member (Dimas Saputra), record a For vote on the open amendment
- note: joining: Ayu Kartika
- note: Amendment circulated to 6 members — vote within 5 business days
- screenshots: `initiatives-propose-a-team-amendment-and-record-a-vote.png`

### ✓ Compensation — change monthly-cycle inputs and save provisional bonuses

- ok — as the CEO (no certify role) the finance inputs are read-only
- ok — open /compensation acting as Maria Gunadi (CFO / Finance)
- ok — edit operating overheads
- ok — Save provisional
- ok — value persists after reload
- note: overheads before: 4000000000
- note: overheads after reload: 4050000000
- screenshots: `compensation-change-monthly-cycle-inputs-and-save-provisional-bonuses.png`

### ✓ People — Add person dialog creates an HR record

- ok — open /people → Add person
- ok — fill the form and save
- ok — the new person's HR sheet opens and the list has the row
- ok — a11y: the success toast is announced (not under aria-hidden while the sheet is open)
- screenshots: `people-add-person-dialog-creates-an-hr-record.png`

### ✓ My compensation — sign the Project Participation Agreement (Annex B)

- ok — open /me acting as Lia Anggraini (unsigned)
- ok — open the agreement
- ok — tick the acknowledgement, type the full name and sign
- screenshots: `my-compensation-sign-the-project-participation-agreement-annex-b.png`

### ✓ Policy — search highlights matches and anchors jump to sections

- ok — open /policy
- ok — search 'clawback' narrows the handbook
- ok — Enter jumps to the first match (URL hash)
- ok — fresh deep link /policy#s-9-1 scrolls §9.1 into view
- ok — Jump to section select navigates
- ok — changing the hash while a search filter hides the target still jumps (clears the search)
- note: highlights: 17
- note: hash: #s-1-5
- note: Jump to section select hidden at this width
- screenshots: `policy-search-highlights-matches-and-anchors-jump-to-sections.png`

