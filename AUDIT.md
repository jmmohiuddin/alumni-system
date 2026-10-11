# DIC Alumni Platform — Production Readiness Audit

**Date:** 2026-08-02
**Auditor:** Lead Engineer (Product / QA / Full-Stack / DB / Mobile UX)
**Method:** Static review of all 11,400 LOC + live browser QA at 375×812 (mobile) against the running Express server and the live Neon PostgreSQL instance.

---

## 0. What actually exists

| Layer | Reality |
|---|---|
| Frontend | Vanilla JS SPA. `index.html` (1,067 L) + `app.js` (4,927 L) + `styles.css` (3,503 L). **Not** Next.js/PWA as the PRD specifies. |
| Backend | Single Express file `server.js` (514 L), 20 endpoints. **Not** NestJS/Go microservices. |
| Database | Neon Cloud PostgreSQL — **live and reachable**. 20 tables created, seeded. |
| Client API layer | `api.js` (276 L) — 20 wrappers, all with silent `catch → return null` fallbacks. |
| Missing infra | No Redis, BullMQ, Meilisearch, pgvector, Service Worker, Dexie/IndexedDB, RLS, auth tokens. |

**Verified DB state (live query):**
```
users 9 · alumni_profiles 3 · chapters 11 · stories 3 · jobs 3 · events 3
campaigns 3 · notifications 3 · custom_fields 3 · event_proposals 1
event_budgets 6 · event_tasks 5 · event_sponsors 4 · event_committees 4
event_procurement 4 · event_volunteers 4 · event_risks 3
chapter_memberships 0 · audit_logs 0 · import_history 0
```

---

## 1. Feature status matrix

Legend: ✅ Fully functional · 🟡 Partial · 🎨 UI only (no persistence) · 🔌 DB disconnected (data exists in PG but UI reads mocks) · ❌ Broken · ⬜ Missing

### Core platform

| # | Feature | Status | Evidence / root cause |
|---|---|---|---|
| 1 | **Authentication** | ❌ | `state.currentUser` is hardcoded to `MOCK_USERS.alumni` at load (app.js:106). App boots straight into the dashboard — the login screen is bypassed entirely. `POST /api/auth/login` exists but **returns a super_admin on unknown email** (server.js:51) and never checks `password_hash`. No session, no token, no OTP (PRD REQ-02). |
| 2 | **RBAC** | 🎨 | Role switching only swaps sidebar links (`renderSidebarNav`). Zero server-side enforcement — every endpoint is anonymous and unauthenticated. RBAC matrix page is a static HTML table. |
| 3 | **Alumni Directory** | 🔌 | `renderAlumniGrid()` reads `MOCK_ALUMNI` (12 hardcoded objects). `API.getAlumni()` exists and is **never called** on this page. Confirmed live: grid renders "Fatima Khanam" (mock) while the API returns "Super Admin" (DB row 1). |
| 4 | **Alumni profile detail** | 🟡 | `viewAlumniProfile()` *does* call `API.getAlumniProfile(id)` — the one directory path wired to PG. But `GET /api/alumni/:id` **fabricates fallback data** for every null column (`'Brain Station 23'`, `'+880 1712-345678'`, hardcoded skills) so it always looks populated even when the profile is empty. |
| 5 | **Directory search / filters / sort** | 🎨 | `filterDirectory`, `toggleChip`, `sortDirectory` all filter the in-memory mock array. `sortDirectory()` ignores its argument entirely (app.js:974). Semantic/vector search (REQ-03) does not exist — the "Searching vectors…" and "🔤 Bangla detected" chips are decorative. |
| 6 | **Chapters** | 🟡 | Best-wired module. List/create/join/members all hit PG. But: create is hardcoded server-side to `status='approved'` (server.js:150) so the **moderation workflow it claims to enter is dead**; join hardcodes `userId ?? 5`; `chapter_memberships` has 0 rows despite 11 chapters. `MOCK_CHAPTERS` still used as fallback (11 refs). |
| 7 | **Stories / News feed** | 🔌 | `POST /api/stories` writes to PG correctly and notifies admins. But `renderNewsFeed()` reads `MOCK_NEWS` — **submitted stories never appear**. `API.getStories()` is defined and never called. This is exactly the "saves but never displays" class of bug. |
| 8 | **Moderation queue** | 🟡 | Wired to PG (`/api/moderation`, approve/reject). Only handles chapters + stories. Reported posts, profile approvals, and the "99.4% safety index" are static markup. Chapter approvals are unreachable (see #6). |
| 9 | **Notifications** | 🔌 | `GET /api/notifications` works and returns real rows. `renderNotifications()` reads `MOCK_NOTIFICATIONS`. Also: no `user_id`/`target_role` filtering — endpoint returns everyone's notifications. |
| 10 | **Jobs board** | 🎨 | `renderJobsEnhanced()` reads `MOCK_JOBS`. `jobs` table has 3 rows, **no endpoint exists** to read or write it. "Post a Job" modal inputs have no `id`, no submit handler — the button is `onclick="closeModal(); showToast('✅ Job posted!')"`. `applyJob()` is a one-line toast. |
| 11 | **Events & ticketing** | 🎨 | `renderEvents()` reads `MOCK_EVENTS`. `events` table has 3 rows, **no endpoint**. "Create Event" modal is theatre (no ids, no handler, toast-only). `buyTicket()` is a one-line toast — no ticket table, no QR, no registration, no attendee list, no check-in persistence (`simulateCheckin()` is a hardcoded toast). |
| 12 | **Donations / MFS** | 🎨 | `renderCampaignsEnhanced()` reads `MOCK_CAMPAIGNS`. `campaigns` table has 3 rows, **no endpoint**. `processDonation()` is a `setTimeout` fake; **no `donations` ledger table exists at all** despite being in the PRD DDL (REQ-05). No bKash/Nagad/Rocket integration, no receipt generation. `downloadReceipt()` is a toast. |
| 13 | **Mentorship** | 🎨 | `renderMentorships()` reads `MOCK_MENTORSHIPS`. **No table, no endpoint.** `acceptRequest()` and `submitMentorRequest()` are toasts. No matching algorithm (REQ-04's 6 weighted criteria absent). No 5-day expiry. |
| 14 | **Career tracker** | 🎨 | Entire module reads inline arrays. No table, no endpoint. |
| 15 | **Bulk import** | 🟡 | `POST /api/bulk-import` genuinely inserts users + profiles + import_history into PG. But the frontend wizard `executeBulkImportProcess()` **simulates** the upload — `import_history` has 0 rows, proving the UI path never reaches the working endpoint. CSV/XLSX parsing is not implemented (no parser dependency in package.json). |
| 16 | **Custom fields** | 🔌 | `custom_fields` table has 3 rows. `handleCreateCustomField` writes to a local array only. No endpoint. |
| 17 | **Audit logs** | 🎨 | `MOCK_AUDIT_LOG`. Table exists, 0 rows, no endpoint, no write path. Violates the PRD's immutable-audit requirement. |
| 18 | **Analytics dashboard** | 🎨 | All Chart.js series are hardcoded literals. `exportPDF()` / `exportExcel()` are toasts. |
| 19 | **Broadcast / omnichannel** | 🎨 | `sendBroadcast()` is a toast. No table, no endpoint, no channels. |
| 20 | **Compliance vault (NID/BRC)** | 🎨 | `decryptVaultField()` reveals a hardcoded string. **No AES-256-GCM encryption anywhere** — a stated legal requirement (REQ-14, PDPA 2026). |
| 21 | **DSAR export / delete account** | 🎨 | `exportUserData()` and `showDeleteAccount()` are toasts. Legal requirement, non-functional. |
| 22 | **Offline sync engine** | 🎨 | The sync panel is animated markup. No Service Worker file, no IndexedDB, no background sync (REQ-10). |
| 23 | **Multi-tenant** | 🎨 | `MOCK_TENANTS`, single hardcoded tenant. No `tenants` table, no subdomain routing, no RLS (REQ-01). |
| 24 | **Developer API / webhooks** | 🎨 | Fully static markup (REQ-18). |
| 25 | **Digital ID / wallet pass** | 🎨 | QR is generated client-side from a static string. No wallet pass (REQ-17). |
| 26 | **Map & geolocation** | 🎨 | `renderMapClusters()` — hardcoded clusters. |
| 27 | **Polls** | 🎨 | `votePoll()` mutates a local array. No table. |

### Event Management Planner (Phase 6 target)

| Sub-module | Status | Notes |
|---|---|---|
| Proposal | 🟡 | Create → PG ✅. Server **forces `status='approved'`** (server.js:390), so the approval workflow never runs. No edit/delete. |
| Budget | 🟡 | Create + read → PG ✅. No update, no delete. |
| Sponsors | 🟡 | Create + read → PG ✅. No update, no delete, no pipeline transitions. |
| Tasks (Kanban) | 🟡 | Create + read + status update → PG ✅. No edit, no delete, no drag-and-drop (buttons only). |
| Procurement | 🟡 | Create + read → PG ✅. No update/delete. |
| Committees | 🔌 | Read-only from PG. No create/update/delete endpoint. |
| Volunteers | 🔌 | Read-only from PG. No create/update/delete endpoint. |
| Risks / security | 🔌 | Read-only from PG. No create/update/delete endpoint. |
| Vendors | ⬜ | Missing (folded into procurement's `vendor_name` string). |
| Timeline | ⬜ | Missing. |
| Logistics | ⬜ | Missing. |
| Marketing planning | 🎨 | Static markup tab. |
| Communication / meetings | 🎨 | Static markup tab. |
| Reports | 🎨 | `downloadEventReport()` is a toast. |
| Analytics | 🎨 | Hardcoded figures. |
| Approval workflow | ⬜ | Missing — blocked by the forced `approved` status. |
| EventAI estimate | ✅ | Deterministic formula endpoint, works end to end. |

**Score: 1 of 27 core features is fully functional. 5 are partially wired. 5 are DB-disconnected. 16 are pure UI.**

---

## 2. Critical defects (ranked)

### D1 — Global horizontal overflow on every mobile screen ❗
The single worst defect; it affects all 14 pages.

`#main-app.app-layout` is `display:grid` with one column. Its grid item `.topbar` has `min-width:auto`, so the column is sized to the topbar's **min-content width of 593px**. On a 375px viewport the entire app shell — topbar, `#pages`, and the fixed bottom nav — is forced to **593px, overflowing by 218px (58%)**.

Measured live: `documentElement.scrollWidth = 593`, `clientWidth = 375`.

Topbar min-content breakdown: hamburger 42 + brand logo 156 (143px `<img>`) + `.topbar-actions` 353 (role `<select>` 110 + alert btn 76 + notif 47 + theme 35 + avatar 33 + status 24) ≈ 593.

Every page therefore renders ~569px-wide content in a 375px window. The admin page is worse — it contains a **1,027px** element (the desktop RBAC table).

### D2 — Authentication is bypassed and unenforced
App boots authenticated as alumni. Login endpoint ignores passwords and hands back **super_admin** for any unrecognised email — a privilege-escalation hole. No sessions, no tokens; all 20 endpoints are anonymous.

### D3 — "Saves but never appears" (the user's reported symptom), root-caused
Three modules write to PG and then render mocks: **stories**, **notifications**, and (partly) **chapters**. `API.getStories()` and `API.getNotifications()` are defined and never invoked anywhere in `app.js`. That is the literal cause of "I submit a story and it never shows up."

### D4 — Four modules have PG tables and zero endpoints
`events`, `jobs`, `campaigns`, `custom_fields` hold seeded rows that no code can read or write. Their "create" modals are non-functional shells (no input `id`s, no submit handler, success toast hardcoded into `onclick`).

### D5 — Approval workflows hardcoded open
`POST /api/chapters` forces `status='approved'`; `POST /api/events/proposals` forces `status='approved'`. Both moderation queues are consequently always empty for new items.

### D6 — Silent failure everywhere
All 20 `api.js` wrappers swallow errors and `return null`. Callers then fall back to mocks, so a total backend outage is indistinguishable from success. No loading states, no error states, no empty states.

### D7 — Missing legally-required capability
No AES-256-GCM field encryption, no consent log, no DSAR export/delete. The UI asserts compliance (green "compliant" pills) that does not exist.

### D8 — Data integrity
Only 3 of 9 users have an `alumni_profiles` row, so `/api/alumni` returns rows with ~15 null columns and the endpoint papers over them with fabricated constants. `chapter_memberships` is empty while `chapters.members_count` claims 18,420 — the counter is a denormalised literal, not a count.

### D9 — Schema drift from the PRD
Integer PKs vs the PRD's UUIDs; no `tenants`, `donations`, `tickets`, `mentorships`, `event_vendors`, `event_timeline`, `consent_logs` tables; dates stored as `VARCHAR` (`event_date VARCHAR(100)` = `'Aug 15, 2026'`), which makes sorting and filtering impossible.

---

## 3. Quick wins available immediately
- `min-width: 0` on the grid items + a mobile topbar rule kills D1 across all 14 pages in one edit.
- Wiring `API.getStories()` / `API.getNotifications()` into their two render functions fixes D3.
- Removing the two hardcoded `status='approved'` literals re-opens both approval workflows.

---

## 4. Recommended execution order

1. **P0 — Mobile shell** (D1): fix the grid blowout, then re-QA all 14 pages.
2. **P0 — Real auth** (D2): password check, session, server-side role enforcement.
3. **P0 — Close the write→read loop** (D3, D5): stories, notifications, chapter approval.
4. **P1 — Build the four missing API surfaces** (D4): events, jobs, campaigns, custom fields, each with full CRUD + wired modals.
5. **P1 — Ticketing & registration**: new `tickets` / `event_registrations` tables, QR, check-in, attendee list.
6. **P1 — Donations ledger**: `donations` table, campaign progress, receipts.
7. **P2 — Mentorship module**: table + matching + request lifecycle.
8. **P2 — Complete the Event Planner**: CRUD for committees/volunteers/risks, add vendors/timeline/logistics, approval workflow, real reports.
9. **P2 — Mobile redesign pass**, page by page, on the fixed shell.
10. **P3 — Compliance, performance, dead-code removal, regression pass.**

---

## 4b. Progress log

### ✅ Completed and verified

**P0-1 — Mobile shell overflow (D1)**
`min-width: 0` on the `.topbar` and `.pages-container` grid items; phone topbar reduced to hamburger · brand · notifications · avatar; role switcher, theme toggle, broadcast and DB status relocated into a new sidebar control deck (48px targets, nothing removed); added a 901–1200px compacting band for the same spill on narrow desktop.
*Verified:* overflow **218px → 0px** on all 14 pages at 320px, 375px and 1004px.

**P0-2 — Authentication and RBAC (D2)**
scrypt password hashing with transparent upgrade of the legacy plaintext rows; HMAC-signed session tokens with a 12h TTL and `/api/auth/me` restore; `requireAuth` / `requireRole` guards on 15 endpoints; identity and role now read from the token, never the request body; boot no longer calls `enterApp()` unconditionally; `logout()` clears the token; dead `enterApp()` removed.
*Verified:* wrong password → 401, unknown email → 401 (was: **super_admin session**), alumni → 403 on moderation/seed-db/bulk-import, tampered token → 401, body-supplied `createdByRole: super_admin` ignored, session survives refresh, role switch genuinely changes server permissions (200 vs 403).

**P0-3 — Write→read loop (D3, D5)**
`renderNewsFeed()` and `renderNotifications()` now call the API wrappers that existed but were never invoked; `showNotifications()` renders on open (it only toggled an empty container); notifications scoped by `user_id`/`target_role` with mark-read and mark-all-read; live bell badge replaces the hardcoded "7"; removed the two forced `status='approved'` literals; added proposal approve/reject and pending proposals to the moderation queue.
*Verified:* alumni submission → `pending_review` → invisible in public feed → appears in moderation queue → approve → appears in feed. Same for chapters and event proposals.

**Directory (D8) + bulk import**
Migrated the 12 hardcoded `MOCK_ALUMNI` records into PostgreSQL (`migrate_alumni.js`, idempotent) and purged leftover test rows; endpoint rewritten with INNER JOIN (no more null-column rows), server-side search across 7 columns, dept/batch/domain/mentor filters, 4 sort modes and real pagination; `sortDirectory()` now uses its argument; `/api/alumni/:id` stops fabricating values and honours privacy settings; bulk import wizard now posts to the working endpoint inside a transaction and writes the audit trail.
*Verified:* 13 profiles from PG, search/filter/sort/paging all correct, Load More hides at the end, empty state on no match, import created 2 users + skipped 1 bad row + wrote the first-ever `import_history` row.

**Chapters — latent crash found during regression**
`renderChapters()` assigned to `const MOCK_CHAPTERS`, throwing `TypeError: Assignment to constant variable` on **every** call. The whole API sync block aborted silently, so the page had been rendering stale hardcoded data since the integration landed. Converted to a live `chaptersCache`, membership now derived per-session-user from `chapter_memberships` (was a hardcoded `Set([1,3])`), join/leave owned by the server.
*Verified:* 10 chapters from PG, join → persists → counter increments → leave → decrements, zero JS errors.

**Code quality:** removed `MOCK_ALUMNI`, `MOCK_NEWS`, `MOCK_NOTIFICATIONS`, `MOCK_CHAPTERS`, `MOCK_IMPORT_HISTORY`, `enterApp()`, and deduplicated the two drifted copies of `renderAlumniCard`. Added shared `escapeHtml` / `formatDate` / `formatRelativeTime` helpers and skeleton, empty and error state components — all DB-rendered strings are now escaped.

### ✅ Completed — second pass (remaining scope + gap)

**Schema v2** (`schema_v2.sql`, applied by `migrate_v2.js`) — 19 new tables: `donations`, `event_registrations`, `mentorships`, `connections`, `job_applications`, `job_referrals`, `event_vendors`, `event_timeline`, `event_logistics`, `event_marketing`, `event_meetings`, `broadcasts`, `polls`, `poll_votes`, `consent_logs`, `identity_vault`, `vault_access_logs`, `deletion_requests`, `sync_mutations`. Plus 9 indexes on v1 tables that were sequential-scanning. Database went from 20 → 39 tables.

**Events & ticketing (REQ-06)** — full CRUD; registration inside a transaction with `SELECT … FOR UPDATE` so two buyers cannot take the last seat; `UNIQUE(event_id, user_id)` makes duplicate tickets impossible at the DB level; HMAC-signed QR payloads; capacity enforcement with automatic waitlisting; cancellation promotes the earliest waitlisted alumnus; attendee list; real QR check-in that rejects unknown, cancelled and already-used tickets.

**Donations (REQ-05)** — two-phase ledger: a `PENDING` row is written *before* the gateway step, then confirmed. Re-confirmation is idempotent, so a retried callback cannot double-count. Campaign totals derive from the ledger; receipts carry real receipt codes and download as files.

**Jobs (REQ-07)** — CRUD with ownership checks, applications with duplicate prevention, applicant lists visible only to the poster, referral requests.

**Mentorship (REQ-04)** — the six weighted criteria computed in SQL over real profiles (industry 25%, skill overlap 20%, geography 15%, department 15%, language 15%, availability 10%); request lifecycle with accept/decline/complete; 5-day auto-expiry.

**Event Planner (Phase 6)** — added CRUD for committees, volunteers and risks (previously read-only) and for the four modules that only had create+read; added **vendors, timeline, logistics, marketing and meetings**; real approval workflow; analytics computed from live rows; CSV report export. Twelve planner tabs, all DB-backed. The loader's ~80-line hardcoded fallback dataset was removed.

**Compliance — the gap that was flagged (REQ-14)**
- **AES-256-GCM field encryption** is real. NID/BRC/passport values are encrypted in the application layer; the database holds only ciphertext + IV + auth tag, verified by asserting the plaintext does not appear in the stored column. Without `ENCRYPTION_KEY` the endpoints *refuse* to store data rather than silently saving plaintext.
- **Decryption is privileged and audited** — admin-only, requires a written reason of ≥5 characters, and writes a `vault_access_logs` entry.
- **Consent logging** records IP, timestamp, user agent and policy version.
- **DSAR** export produces real JSON/CSV downloads across 8 data categories; account deletion has the mandatory 30-day grace window and is cancellable.
- **Immutable audit trail** — each entry is SHA-256 hash-chained to the previous one. 75 entries recorded during testing; the table had never been written to before.
- **The compliance panel now reports reality** — the pills read from actual encryption/consent/audit state and show `at_risk` when the key is missing, instead of being hardcoded green.

**Mobile UX (Phase 7)** — measured before/after at 375px across all 14 pages and 5 roles:

| Metric | Before | After |
|---|---|---|
| Horizontal overflow | 218px | **0px** |
| Tap targets < 44px | ~69 | **0** |
| Text < 11px | ~200 | **0** |
| Desktop tables on mobile | 2 | **0** (card layouts) |

Modals became bottom sheets; tab strips scroll inside themselves; form inputs use 16px to stop iOS zoom-on-focus; RBAC matrix and all planner tables render one card per row.

**Error handling (Phase 8)** — simulated a total backend outage: every page now shows a visible error panel with a Retry button and **no stale mock data**, then recovers. Previously an outage was indistinguishable from success.

**Executive Analytics — mobile redesign**
Reported by the user after the first mobile pass. `#analytics-panel-main` was still a `2fr 1fr` desktop grid at 375px, resolving to `136px 190px 0px`, so the chart rendered in a 137px column with a 106px-wide canvas stretched to 584px tall — the legend was clipped and the series unreadable. A scan for the same defect class found **eight** desktop grids with no mobile override (`analytics-grid`, `career-tracker-layout`, `server-health-grid`, `alumni-badges-grid`, `import-wizard-steps`, `branding-color-grid`, `sync-overview-grid`, `segment-builder`).

Fixed by collapsing all eight to single/two-column stacks on mobile, adding a `.chart-frame` wrapper so Chart.js (which runs `maintainAspectRatio:false`) has a bounded box instead of an unconstrained parent, reordering Key Metrics above the chart, and compacting the chart legend to one line. Canvas went from **106×584px → 325×220px**. All five analytics tabs verified clean.

`:has()` selectors were avoided in favour of explicit classes, since the PRD targets entry-level Android devices whose WebViews may not support it.

**Bugs found during this pass**
1. `renderChapters()` assigned to a `const` — threw on every call, page served stale data (found in regression).
2. **Three duplicate element IDs** (`alumni-grid`, `events-grid`, `active-poll`) meant `getElementById` always returned the dashboard copy, so the Events and Directory pages were never actually populated.
3. `/api/notifications` took `userId` from the query string — any signed-in user could read another user's notifications by changing it. Now derived from the session token (found by a failing test).
4. `.rbac-table` kept a `min-width: 600px` from an older mobile rule, pushing permission values off-screen once rows became cards.
5. Verification-queue `.approve-btn` / `.review-btn` rendered at 25px tall — mis-taps there approve or reject a real alumni profile. Replaced the class-by-class touch-target rules with a catch-all floor over `#pages button`.

**Verification:** 144 backend assertions passing (55 API + 89 planner/compliance), 8 UI workflows driven through the browser, all 14 pages × 5 roles with zero JS errors.

### ⏳ Known remaining deviations
The infrastructure gap in §5 stands: no Next.js/PWA, NestJS/Go microservices, Redis, BullMQ, Meilisearch, pgvector, multi-tenant RLS, or live MFS gateway integrations. The donation flow writes a real ledger but the gateway authorisation step is still simulated — connecting bKash/Nagad/Rocket requires merchant credentials and their sandbox. `sync_mutations` provides the idempotency backbone for REQ-10, but no Service Worker or IndexedDB layer has been added.

---

## 5. Scope note

The PRD describes a Next.js PWA on NestJS/Go microservices with Redis, BullMQ, Meilisearch, pgvector, EKS and Cloudflare. What exists is a static SPA on a single Express file. Per the "do not rewrite" instruction, this audit and the work that follows **keep the current architecture** and make it genuinely work end to end. The infrastructure gap (vector search, offline sync engine, multi-tenancy, MFS gateways) is recorded here as a known deviation rather than silently closed, because closing it *is* the rewrite the instruction forbids.
