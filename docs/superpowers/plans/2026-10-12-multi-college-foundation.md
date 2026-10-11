# Multi-College Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single-college DIC alumni app into a multi-college product: Shikhon ID sign-in, one database per college provisioned on first open, per-college branding, and the known security defects fixed first.

**Architecture:** Keep the Express app. Replace the global `db` pool with a facade that resolves the current college's pool from an `AsyncLocalStorage` scope set by a tenancy middleware. A new `alumni_control` database maps a Shikhon tenant to its database, encrypted credential and branding. Tenant databases are created by a provisioner and brought to the current schema by a migration runner. Hardening comes first so no college ever runs the vulnerable code.

**Tech Stack:** Node 26, Express 5, `pg`, `jose` (new; verifies Shikhon ID tokens), `node:test` (built-in test runner, no new test dependency), PostgreSQL 16.

**Spec:** `docs/superpowers/specs/2026-10-12-multi-tenant-alumni-design.md`

## Global Constraints

- Sign-in is Shikhon ID only; no alumni passwords. The college is taken only from the verified Shikhon ID token, never from a URL, header or form field.
- One database per college named `alumni_<slug>`, with its own database role. A college's role cannot see another college's data.
- `alumni_control` holds Shikhon tenant ID, database name, encrypted credential, schema version, status and branding (display name, logo, optional accent colour).
- Users inside a college database are keyed by Shikhon ID. The existing 5 roles (`alumni`, `moderator`, `dept_admin`, `univ_admin`, `super_admin`) stay.
- DIC becomes tenant #1, provisioned fresh. Demo seed data is not carried over.
- Only the Shikhon-side items in spec Section 9 are unconfirmed; they are verified in Task 1 and isolated in one file (`auth/claims.js`).
- New dependencies: `jose` only. Pin an exact version that is at least two weeks old.
- No hardcoded secrets. Required env: `SESSION_SECRET`, `ENCRYPTION_KEY`, `CONTROL_DATABASE_URL`, `PROVISIONER_DATABASE_URL`, `TENANT_KEY` (64 hex), `SHIKHON_ISSUER`, `SHIKHON_CLIENT_ID`, `SHIKHON_CLIENT_SECRET`, `SHIKHON_REDIRECT_URI`.
- Source files stay under 800 lines. New code uses no `console.log`; errors go to `console.error` with context.
- Commit format `<type>: <description>`, each ending with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Tests run with `npm test`. They need a local PostgreSQL reachable at `TEST_PG_ADMIN_URL` (default `postgres://localhost:5432/postgres`) whose user can create databases and roles.

## Review Focus

These are the inputs the spec implies but no happy-path test would catch. Each has a named test in the task that owns the code.

1. **Two simultaneous first opens by the same college admin** must provision exactly one database and one role; the loser is told "in progress" (Task 12).
2. **A Shikhon token with `email_verified: false`** whose email matches an imported profile must not link to that profile, and must not create an account that collides with it (Task 14).
3. **A hostile Shikhon tenant ID or college name** (quotes, semicolons, uppercase, unicode, 500 characters) must never reach SQL as an identifier or break the provisioning DDL (Task 12).
4. **A logo upload whose `Content-Type` says PNG but whose bytes are not an image**, or that is empty or over the size limit, must be rejected and leave the existing logo untouched (Task 15).
5. **Provisioning that fails halfway** (migration error after the database exists) must leave no database or role behind and must be retryable by the admin (Task 12).

---

## File Structure

**New files**

| Path | Responsibility |
|---|---|
| `tests/helpers/pg.js` | Create and drop throwaway databases |
| `tests/helpers/app.js` | Start the real app on a throwaway database |
| `tests/helpers/seed.js` | Insert users, events, tokens for tests |
| `tests/helpers/mock-shikhon.js` | Local stand-in for Shikhon ID (OIDC) |
| `tests/helpers/tenant-fixture.js` | Control DB + provisioned colleges + app, shared by tenant tests |
| `lib/csv.js` | Safe CSV cell encoding |
| `lib/payment-auth.js` | Who may settle a payment |
| `lib/pg-ssl.js` | SSL setting for a connection URL |
| `tenancy/migrations.js` | Apply ordered SQL migrations to any database |
| `tenancy/config.js` | Read and validate tenancy env |
| `tenancy/secret-box.js` | AES-256-GCM for stored database credentials |
| `tenancy/colleges.js` | Reads and writes of the `colleges` control table |
| `tenancy/pool-registry.js` | Per-college connection pools (bounded) |
| `tenancy/provisioner.js` | Create role + database, migrate, record |
| `tenancy/middleware.js` | Resolve the college from the session token and open the scope |
| `tenancy/bootstrap.js` | Build control pool, registry, middleware, sign-in deps |
| `auth/session.js` | Session token signing and reading (moved out of `server.js`) |
| `auth/claims.js` | The only file that knows Shikhon ID claim names |
| `auth/shikhon-oidc.js` | Login redirect, callback, token verification |
| `auth/sign-in.js` | First open, user lookup, linking, session issue |
| `branding/api.js` | Branding and logo endpoints |
| `js/brand.js` | Front-end branding loader |
| `migrations/0001_base.sql` … `0008_v8.sql` | Moved from `schema.sql`, `schema_v2.sql` … `schema_v8.sql` |
| `migrations/0009_payments.sql` | `pending_payment` status and `amount_due` |
| `migrations/0010_shikhon_user.sql` | `users.shikhon_user_id` |
| `control_migrations/0001_control.sql` | `colleges`, `college_logos` |
| `docs/shikhon-id-contract.md` | Verified Shikhon ID facts |
| `docs/runbooks/dic-cutover.md` | DIC rollout steps |

**Modified:** `server.js`, `db.js`, `routes_events.js`, `routes_v2.js`, `package.json`, `index.html`, `admin.html`, `js/*.js`, `manifest.json`, `.env.example`, `README.md`.

**Removed:** `migrate_v2.js` … `migrate_v8.js` (superseded by the runner), the DIC logo files under `assets/`, `dic.png`, `dics.png`.

---

## Task 1: Verify the Shikhon ID dependencies

The open items in spec Section 9 decide whether Tasks 13–15 can go live. Answer them from the platform source that sits next to this repo.

**Files:**
- Create: `docs/shikhon-id-contract.md`
- Create: `auth/claims.js`
- Test: `tests/claims.test.js`

**Interfaces:**
- Produces: `readIdentity(claims) -> { shikhonUserId, email, emailVerified, name, tenantId, tenantName, isCollegeAdmin }`, throws `IdentityError` when `sub` or the tenant claim is missing.

- [ ] **Step 1: Search the platform source for the answers**

```bash
cd "/Users/mohiuddin/Documents/Edtech product"
grep -rIl --include=*.ts --include=*.js --include=*.json -i "oidc\|openid\|id_token\|jwks" shikon-platform-src shikon-platform 2>/dev/null | grep -v node_modules | head -30
grep -rIn --include=*.ts --include=*.js -i "tenant_id\|tenantId\|college" shikon-platform-src 2>/dev/null | grep -v node_modules | head -30
```

Read what you find. Answer each question with a file path and line as evidence, or write "NOT PRESENT".

- [ ] **Step 2: Write `docs/shikhon-id-contract.md`**

Use this structure, filling every field from Step 1 (write `NOT PRESENT` where the platform has nothing; do not guess):

```markdown
# Shikhon ID contract for the alumni app

Checked: <date> against <path/commit of platform source>

| # | Question | Answer | Evidence |
|---|---|---|---|
| 1 | Is there an OIDC provider (discovery, authorize, token, JWKS)? | yes / NOT PRESENT | file:line |
| 2 | Can the alumni app register as a client (client id/secret, redirect URI)? | ... | ... |
| 3 | Claim carrying the college (tenant) id | name or NOT PRESENT | ... |
| 4 | Claim carrying the college display name | ... | ... |
| 5 | Claim marking a college admin | ... | ... |
| 6 | Can an alumnus self-register and be attached to a college? | ... | ... |
| 7 | Is `email_verified` issued, and truthful? | ... | ... |

## Platform changes required (if any)
One bullet per NOT PRESENT row: the exact change the Shikhon team must make.

## Go / no-go
Tasks 1–12 and 15–17 do not depend on this. Tasks 13–14 are built against the mock
provider. DIC cutover (Task 18) is blocked until rows 1–5 and 7 are confirmed.
```

- [ ] **Step 3: Write the failing test**

`tests/claims.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { readIdentity, IdentityError } = require('../auth/claims');

const base = { sub: 'u-1', email: 'A@College.edu', email_verified: true, name: 'Ayesha',
               tenant_id: 't-9', tenant_name: 'Test College', is_college_admin: true };

test('reads a complete identity and lowercases the email', () => {
  const id = readIdentity(base);
  assert.equal(id.shikhonUserId, 'u-1');
  assert.equal(id.email, 'a@college.edu');
  assert.equal(id.tenantId, 't-9');
  assert.equal(id.isCollegeAdmin, true);
  assert.equal(id.emailVerified, true);
});

test('treats email_verified as false unless it is exactly true', () => {
  assert.equal(readIdentity({ ...base, email_verified: 'true' }).emailVerified, false);
  assert.equal(readIdentity({ ...base, email_verified: undefined }).emailVerified, false);
});

test('treats a non-boolean admin claim as not an admin', () => {
  assert.equal(readIdentity({ ...base, is_college_admin: 'yes' }).isCollegeAdmin, false);
});

test('throws IdentityError without a subject or a tenant', () => {
  assert.throws(() => readIdentity({ ...base, sub: '' }), IdentityError);
  assert.throws(() => readIdentity({ ...base, tenant_id: undefined }), IdentityError);
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `node --test tests/claims.test.js`
Expected: FAIL with `Cannot find module '../auth/claims'`.

- [ ] **Step 5: Implement `auth/claims.js`**

If Step 2 found different claim names, change only the values in `CLAIMS` and the test's `base` object.

```js
/* The only file that knows Shikhon ID's claim names. Values are recorded in
   docs/shikhon-id-contract.md. */
const CLAIMS = Object.freeze({
  tenantId: 'tenant_id',
  tenantName: 'tenant_name',
  isCollegeAdmin: 'is_college_admin'
});

class IdentityError extends Error {}

const text = (v) => (typeof v === 'string' ? v.trim() : '');

function readIdentity(claims) {
  const shikhonUserId = text(claims && claims.sub);
  const tenantId = text(claims && claims[CLAIMS.tenantId]);
  if (!shikhonUserId) throw new IdentityError('token has no subject');
  if (!tenantId) throw new IdentityError('token has no college');
  return {
    shikhonUserId,
    email: text(claims.email).toLowerCase(),
    emailVerified: claims.email_verified === true,
    name: text(claims.name),
    tenantId,
    tenantName: text(claims[CLAIMS.tenantName]),
    isCollegeAdmin: claims[CLAIMS.isCollegeAdmin] === true
  };
}

module.exports = { CLAIMS, IdentityError, readIdentity };
```

- [ ] **Step 6: Run the test, then commit**

Run: `node --test tests/claims.test.js` — Expected: 4 passing.

```bash
git add docs/shikhon-id-contract.md auth/claims.js tests/claims.test.js
git commit -m "feat: record Shikhon ID contract and isolate claim names" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 2: Test harness and local SSL fix

**Files:**
- Create: `lib/pg-ssl.js`, `tests/helpers/pg.js`, `tests/helpers/app.js`, `tests/helpers/seed.js`
- Modify: `db.js` (the pool config block), `package.json`
- Test: `tests/harness.test.js`

**Interfaces:**
- Produces: `sslFor(url) -> false | { rejectUnauthorized: false }` (false for localhost URLs without `sslmode=require`).
- Produces: `createTempDb(prefix?) -> { name, url, drop() }`; `startApp({ env? }) -> { base, dbUrl, stop() }`; `insertUser(url, { email, role?, name?, password? }) -> { id, email, role }`; `mintToken({ uid, role, tv?, extra? }) -> string`; `insertEvent(url, opts) -> row`; `withClient(url, fn)`.

- [ ] **Step 1: Confirm Postgres is reachable**

```bash
pg_isready -h localhost -p 5432
```
Expected: `accepting connections`. If not, start it (`brew services start postgresql@16`) before continuing.

- [ ] **Step 2: Write `lib/pg-ssl.js`**

```js
/* Neon and other hosted Postgres need TLS; a local test database does not.
   db.js used to force SSL for every connection string, which made a local
   DATABASE_URL unusable. */
function sslFor(url) {
  let host = '';
  let mode = '';
  try {
    const u = new URL(url);
    host = u.hostname;
    mode = u.searchParams.get('sslmode') || '';
  } catch { /* not a URL: fall through to TLS-on */ }
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host);
  if (local && mode !== 'require') return false;
  // Verify the server certificate by default. db.js used to disable this for
  // every hosted database. PG_SSL_INSECURE=1 is an explicit, visible opt-out for
  // a host with a self-signed certificate.
  return { rejectUnauthorized: process.env.PG_SSL_INSECURE !== '1' };
}
module.exports = { sslFor };
```

- [ ] **Step 3: Use it in `db.js`**

Replace `ssl: { rejectUnauthorized: false },` in the `if (connectionString)` branch of `db.js` with `ssl: sslFor(connectionString),`, and add `const { sslFor } = require('./lib/pg-ssl');` after the `pg` require. Also add to the exports object an `end` method:

```js
  end: () => (pool ? pool.end() : Promise.resolve()),
```

- [ ] **Step 4: Write the helpers**

`tests/helpers/pg.js`:

```js
const crypto = require('crypto');
const { Client } = require('pg');

const ADMIN_URL = process.env.TEST_PG_ADMIN_URL || 'postgres://localhost:5432/postgres';

function urlFor(dbName) {
  const u = new URL(ADMIN_URL);
  u.pathname = '/' + dbName;
  return u.toString();
}

async function adminQuery(sql) {
  const c = new Client({ connectionString: ADMIN_URL });
  await c.connect();
  try { return await c.query(sql); } finally { await c.end(); }
}

async function createTempDb(prefix = 'alumni_test') {
  const name = `${prefix}_${crypto.randomBytes(4).toString('hex')}`;
  await adminQuery(`CREATE DATABASE "${name}"`);
  return {
    name,
    url: urlFor(name),
    drop: () => adminQuery(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
  };
}

module.exports = { ADMIN_URL, urlFor, adminQuery, createTempDb };
```

`tests/helpers/seed.js`:

```js
const crypto = require('crypto');
const { Client } = require('pg');

const hashPassword = (plain) => {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt$${salt}$${crypto.scryptSync(plain, salt, 64).toString('hex')}`;
};

async function withClient(url, fn) {
  const c = new Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

async function insertUser(url, { email, role = 'alumni', name = 'Test User', password = 'correct-horse-battery' }) {
  return withClient(url, async (c) => (await c.query(
    `INSERT INTO users (email, password_hash, full_name, initials, role, role_label, department)
     VALUES ($1,$2,$3,'TU',$4,$4,'CSE') RETURNING id, email, role`,
    [email, hashPassword(password), name, role])).rows[0]);
}

/* Same format server.js signToken() produces: base64url(JSON).HMAC-SHA256. */
function mintToken({ uid, role, tv = 1, extra = {} }) {
  const body = Buffer.from(JSON.stringify({ uid, role, tv, exp: Date.now() + 3600000, ...extra })).toString('base64url');
  const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

async function insertEvent(url, { visibility = 'alumni', approval = 'approved', isPaid = false, price = 0, capacity = 10 } = {}) {
  return withClient(url, async (c) => {
    const ev = (await c.query(
      `INSERT INTO events (title, venue, event_date, starts_on, visibility, approval_status,
                           status, is_paid, capacity, price)
       VALUES ('Test Event','Hall','2030-01-01','2030-01-01',$1,$2,'upcoming',$3,$4,$5) RETURNING *`,
      [visibility, approval, isPaid, capacity, isPaid ? 'Paid' : 'Free'])).rows[0];
    await c.query(
      `INSERT INTO event_ticket_types (event_id, name, price, quota, position) VALUES ($1,'General',$2,NULL,0)`,
      [ev.id, price]);
    return ev;
  });
}

module.exports = { hashPassword, withClient, insertUser, mintToken, insertEvent };
```

`tests/helpers/app.js`:

```js
const { createTempDb } = require('./pg');
const { applyMigrationsToUrl } = require('../../tenancy/migrations');

/* Starts the real Express app against a throwaway, fully migrated database.
   Each test file runs in its own process, so setting env before the first
   require of server.js is safe. */
async function startApp({ env = {} } = {}) {
  const dbh = await createTempDb();
  Object.assign(process.env, {
    DATABASE_URL: dbh.url,
    SESSION_SECRET: 'test-session-secret',
    ENCRYPTION_KEY: '0'.repeat(64),
    ...env
  });
  await applyMigrationsToUrl(dbh.url);
  const app = require('../../server');
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    dbUrl: dbh.url,
    async stop() {
      await new Promise((r) => server.close(r));
      await require('../../db').end();
      await dbh.drop();
    }
  };
}

module.exports = { startApp };
```

Add `# PG_SSL_INSECURE=1   # only for a host with a self-signed certificate; certificates are verified by default` to `.env.example`. If the existing DIC database fails to connect after this change, its certificate chain is the thing to fix, not the check.

- [ ] **Step 5: Add the test script**

In `package.json` add (keeping existing keys):

```json
"scripts": { "test": "node --test \"tests/**/*.test.js\"" }
```

- [ ] **Step 6: Write the failing harness test**

`tests/harness.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTempDb } = require('./helpers/pg');
const { withClient } = require('./helpers/seed');
const { sslFor } = require('../lib/pg-ssl');

test('sslFor is off for local URLs and on for hosted ones', () => {
  assert.equal(sslFor('postgres://localhost:5432/x'), false);
  assert.equal(sslFor('postgres://127.0.0.1/x'), false);
  assert.deepEqual(sslFor('postgres://u:p@ep-x.neon.tech/x?sslmode=require'), { rejectUnauthorized: true });
  assert.deepEqual(sslFor('postgres://localhost/x?sslmode=require'), { rejectUnauthorized: true });
});

test('PG_SSL_INSECURE=1 is the only way to skip certificate verification', () => {
  process.env.PG_SSL_INSECURE = '1';
  try { assert.deepEqual(sslFor('postgres://u:p@ep-x.neon.tech/x'), { rejectUnauthorized: false }); }
  finally { delete process.env.PG_SSL_INSECURE; }
});

test('createTempDb makes a connectable database and drops it', async () => {
  const dbh = await createTempDb();
  const name = await withClient(dbh.url, async (c) => (await c.query('SELECT current_database() n')).rows[0].n);
  assert.equal(name, dbh.name);
  await dbh.drop();
});
```

- [ ] **Step 7: Run the test, then commit**

Run: `node --test tests/harness.test.js`
Expected: 2 passing. (`startApp` is exercised from Task 3 on, once `tenancy/migrations` exists.)

```bash
git add lib/pg-ssl.js db.js package.json tests/helpers tests/harness.test.js
git commit -m "test: add Postgres test harness and skip SSL for local databases" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 3: Migration runner and a single migrations folder

New colleges start from an empty database, so the schema must be one ordered, replayable list. The old `migrate_vN.js` scripts each ran one `schema_vN.sql` and verified counts; the runner replaces them.

**Files:**
- Create: `tenancy/migrations.js`
- Move: `schema.sql` → `migrations/0001_base.sql`; `schema_v2.sql` … `schema_v8.sql` → `migrations/0002_v2.sql` … `migrations/0008_v8.sql`
- Remove: `migrate_v2.js` … `migrate_v8.js`
- Modify: `db.js` (`initDbSchemaAndSeed`)
- Test: `tests/migrations.test.js`

**Interfaces:**
- Produces: `applyMigrations(client, dir?) -> Promise<string[]>` (file names applied this call), `applyMigrationsToUrl(url, dir?)`, `currentVersion(client) -> string|null` (last applied file name), `listMigrations(dir?)`, `MIGRATIONS_DIR`.
- `dir` defaults to `migrations/`; the control database uses `control_migrations/`.

- [ ] **Step 1: Check the old SQL for baked-in demo data**

```bash
grep -n "INSERT INTO" schema.sql schema_v*.sql | head -30
```
Any `INSERT` of demo rows (users, events, news) belongs in `seed.sql`, not in a migration. Move such statements to `seed.sql` before moving the file. Reference data a fresh college needs (for example default chapters or lookup rows) stays in the migration.

- [ ] **Step 2: Write the failing test**

`tests/migrations.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os'), fs = require('fs'), path = require('path');
const { createTempDb } = require('./helpers/pg');
const { withClient } = require('./helpers/seed');
const { applyMigrationsToUrl, listMigrations } = require('../tenancy/migrations');

test('applies every migration to an empty database and records them', async () => {
  const dbh = await createTempDb();
  try {
    const applied = await applyMigrationsToUrl(dbh.url);
    assert.deepEqual(applied, listMigrations());
    await withClient(dbh.url, async (c) => {
      const t = await c.query(`SELECT to_regclass('public.users') u, to_regclass('public.events') e`);
      assert.ok(t.rows[0].u && t.rows[0].e);
      const v = await c.query('SELECT COUNT(*)::int n FROM schema_migrations');
      assert.equal(v.rows[0].n, listMigrations().length);
    });
  } finally { await dbh.drop(); }
});

test('a second run applies nothing', async () => {
  const dbh = await createTempDb();
  try {
    await applyMigrationsToUrl(dbh.url);
    assert.deepEqual(await applyMigrationsToUrl(dbh.url), []);
  } finally { await dbh.drop(); }
});

test('a failing migration rolls back and names the file', async () => {
  const dbh = await createTempDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
  fs.writeFileSync(path.join(dir, '0001_ok.sql'), 'CREATE TABLE a (id int);');
  fs.writeFileSync(path.join(dir, '0002_bad.sql'), 'CREATE TABLE b (id int); SELECT nope FROM nowhere;');
  try {
    await assert.rejects(applyMigrationsToUrl(dbh.url, dir), /0002_bad\.sql/);
    await withClient(dbh.url, async (c) => {
      assert.ok((await c.query(`SELECT to_regclass('public.a') r`)).rows[0].r);
      assert.equal((await c.query(`SELECT to_regclass('public.b') r`)).rows[0].r, null);
    });
  } finally { await dbh.drop(); }
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node --test tests/migrations.test.js` — Expected: FAIL, `Cannot find module '../tenancy/migrations'`.

- [ ] **Step 4: Implement `tenancy/migrations.js`**

```js
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { sslFor } = require('../lib/pg-ssl');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const FILE_PATTERN = /^\d{4}_.+\.sql$/;
const LOCK_KEY = 874100001; // arbitrary constant: serialises concurrent runners

function listMigrations(dir = MIGRATIONS_DIR) {
  return fs.readdirSync(dir).filter((f) => FILE_PATTERN.test(f)).sort();
}

async function applyMigrations(client, dir = MIGRATIONS_DIR) {
  await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const done = new Set((await client.query('SELECT version FROM schema_migrations')).rows.map((r) => r.version));
    const applied = [];
    for (const file of listMigrations(dir)) {
      if (done.has(file)) continue;
      await client.query('BEGIN');
      try {
        await client.query(fs.readFileSync(path.join(dir, file), 'utf8'));
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${file} failed: ${err.message}`);
      }
    }
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
  }
}

async function currentVersion(client) {
  const r = await client.query('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1');
  return r.rows[0] ? r.rows[0].version : null;
}

async function applyMigrationsToUrl(url, dir = MIGRATIONS_DIR) {
  const client = new Client({ connectionString: url, ssl: sslFor(url) });
  await client.connect();
  try { return await applyMigrations(client, dir); } finally { await client.end(); }
}

module.exports = { MIGRATIONS_DIR, listMigrations, applyMigrations, applyMigrationsToUrl, currentVersion };
```

- [ ] **Step 5: Move the schema files and remove the old scripts**

```bash
mkdir migrations
git mv schema.sql migrations/0001_base.sql
for n in 2 3 4 5 6 7 8; do git mv schema_v$n.sql migrations/000${n}_v$n.sql; done
git rm migrate_v2.js migrate_v3.js migrate_v4.js migrate_v5.js migrate_v6.js migrate_v7.js migrate_v8.js
```

- [ ] **Step 6: Run the test and fix any replay failure**

Run: `node --test tests/migrations.test.js`
Expected: 3 passing. If the first test fails because a migration assumed data from an earlier script (the removed `migrate_vN.js` files did backfills in JS), read the named file and make the SQL work on an empty database, most often by guarding with `IF EXISTS` or `WHERE EXISTS`. Do not edit a migration to skip real schema.

- [ ] **Step 7: Point `initDbSchemaAndSeed` at the runner**

In `db.js`, replace the `schema.sql` read-and-run block with `await applyMigrations(client)` on a client from the pool (require `./tenancy/migrations`); keep the `seed.sql` block unchanged. Run `grep -n "schema.sql\|schema_v" *.js` and update any other reader.

- [ ] **Step 8: Commit**

```bash
git add -A migrations tenancy/migrations.js tests/migrations.test.js db.js seed.sql
git commit -m "refactor: replace migrate_vN scripts with an ordered migration runner" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 4: Stop serving source and SQL files

`express.static(__dirname)` publishes the whole repository: `server.js`, `db.js`, every SQL file, `package.json`. This was found while planning and is not among the seven review findings; it is as serious as them.

**Files:**
- Modify: `server.js` (the `express.static` line near line 70; the SPA fallback near the end of the file)
- Test: `tests/static-files.test.js`

**Interfaces:**
- Produces: only these are served as files: `/index.html`, `/admin.html`, `/styles.css`, `/api.js`, `/manifest.json`, everything under `/js/` and `/assets/`.

- [ ] **Step 1: Find every root-level file the pages load**

```bash
grep -ohE "(src|href)=\"[^\"#]+\"" index.html admin.html | sort -u
grep -rhoE "url\(['\"]?[^)'\"]+" styles.css | sort -u
```
Any file at the repository root that these reference (for example `dic.png`) must go in the allowlist in Step 4, or be removed from the page.

- [ ] **Step 2: Write the failing test**

`tests/static-files.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { startApp } = require('./helpers/app');

let app;
test.before(async () => { app = await startApp(); });
test.after(async () => { await app.stop(); });

// fetch() normalises "/js/../x"; http.get does not, so use it for traversal.
const raw = (p) => new Promise((resolve, reject) => {
  const u = new URL(app.base);
  http.get({ host: u.hostname, port: u.port, path: p }, (res) => {
    let body = ''; res.on('data', (d) => body += d); res.on('end', () => resolve({ status: res.statusCode, body }));
  }).on('error', reject);
});

test('source, SQL and config files are not served', async () => {
  for (const p of ['/server.js', '/db.js', '/package.json', '/routes_v2.js',
                   '/migrations/0001_base.sql', '/seed.sql', '/tests/helpers/app.js']) {
    assert.equal((await raw(p)).status, 404, `${p} should be 404`);
  }
});

test('path traversal out of /js and /assets is refused', async () => {
  for (const p of ['/js/../server.js', '/assets/../db.js', '/js/..%2fserver.js']) {
    const r = await raw(p);
    assert.notEqual(r.status, 200, `${p} must not be served`);
    assert.ok(!r.body.includes("require('express')"), `${p} leaked source`);
  }
});

test('the pages and their assets are still served', async () => {
  for (const p of ['/index.html', '/admin.html', '/styles.css', '/api.js', '/manifest.json', '/js/core.js']) {
    assert.equal((await raw(p)).status, 200, `${p} should be 200`);
  }
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node --test tests/static-files.test.js`
Expected: FAIL: `/server.js should be 404` (it currently returns the source).

- [ ] **Step 4: Replace the static handler**

In `server.js`, replace `app.use(express.static(__dirname, { index: false }));` (keeping the comment's explanation of why a bare `/` must reach the SPA handler) with:

```js
/* Only the front end is public. express.static(__dirname) used to publish the
   whole repository: server.js, db.js, every SQL file. Each directory below is
   its own static root, so ".." cannot climb out of it. */
const PUBLIC_ROOT_FILES = ['index.html', 'admin.html', 'styles.css', 'api.js', 'manifest.json'];
for (const file of PUBLIC_ROOT_FILES) {
  app.get('/' + file, (req, res) => res.sendFile(path.join(__dirname, file)));
}
app.use('/js', express.static(path.join(__dirname, 'js'), { index: false }));
app.use('/assets', express.static(path.join(__dirname, 'assets'), { index: false }));
```

Add every extra root file found in Step 1 to `PUBLIC_ROOT_FILES`. Then change the SPA fallback near the end of the file so a request for a file that does not exist is a 404, not the HTML shell:

```js
app.use((req, res) => {
  if (path.extname(req.path)) return res.status(404).type('text/plain').send('Not found');
  res.sendFile(path.join(__dirname, wantsAdminPortal(req) ? 'admin.html' : 'index.html'));
});
```

- [ ] **Step 5: Run the test, then commit**

Run: `node --test tests/static-files.test.js` — Expected: 3 passing.

```bash
git add server.js tests/static-files.test.js
git commit -m "fix: serve only the front end, not the repository" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 5: Login rate limit must not reset on success (review finding 7)

A successful sign-in clears the per-IP counter, so an attacker holding one valid account resets their own throttle.

**Files:**
- Modify: `server.js` (`loginRecordSuccess`, near line 412)
- Test: `tests/login-throttle.test.js`

- [ ] **Step 1: Write the failing test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers/app');
const { insertUser } = require('./helpers/seed');

let app;
test.before(async () => {
  app = await startApp();
  await insertUser(app.dbUrl, { email: 'mine@x.edu', password: 'my-valid-password' });
});
test.after(async () => { await app.stop(); });

const login = (email, password) => fetch(`${app.base}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.50' },
  body: JSON.stringify({ email, password })
});

test('a successful login does not reset the per-IP failure count', async () => {
  for (let i = 1; i <= 19; i++) assert.equal((await login(`victim${i}@x.edu`, 'guess')).status, 401);
  assert.equal((await login('mine@x.edu', 'my-valid-password')).status, 200);
  // 20th failure from this IP trips the per-IP lock…
  assert.equal((await login('victim20@x.edu', 'guess')).status, 401);
  // …and the next attempt is throttled.
  assert.equal((await login('victim21@x.edu', 'guess')).status, 429);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/login-throttle.test.js`
Expected: FAIL on the last assertion (`401 !== 429`): the success cleared the counter. If an earlier line fails instead, the login route's failure status differs from 401: read the login handler in `server.js`, then correct the expected status in the test, not the handler.

- [ ] **Step 3: Fix `loginRecordSuccess`**

```js
function loginRecordSuccess(req, email) {
  // Clear only this account's counter. The per-IP counter must run out on its
  // own window: clearing it let one valid login reset an attacker's throttle.
  loginAttempts.delete(`a:${clientIp(req)}:${String(email || '').toLowerCase()}`);
}
```

- [ ] **Step 4: Run the test, then commit**

Run: `node --test tests/login-throttle.test.js` — Expected: PASS.

```bash
git add server.js tests/login-throttle.test.js
git commit -m "fix: keep the per-IP login throttle after a successful sign-in" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 6: CSV formula injection (review finding 6)

**Files:**
- Create: `lib/csv.js`
- Modify: `routes_events.js` (the attendee CSV export, near line 694)
- Test: `tests/csv.test.js`

**Interfaces:**
- Produces: `csvCell(value) -> string` (always quoted; a leading `=`, `+`, `-`, `@`, tab or CR gets a single-quote prefix).

- [ ] **Step 1: Write the failing test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { csvCell } = require('../lib/csv');

test('quotes plain values and doubles embedded quotes', () => {
  assert.equal(csvCell('Ayesha'), '"Ayesha"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
});
test('renders null and undefined as an empty cell', () => {
  assert.equal(csvCell(null), '""');
  assert.equal(csvCell(undefined), '""');
});
test('neutralises spreadsheet formulas', () => {
  for (const evil of ['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\t=1', '\r=1']) {
    assert.ok(csvCell(evil).startsWith(`"'`), `${JSON.stringify(evil)} not neutralised`);
  }
});
test('leaves ordinary text that merely contains these characters alone', () => {
  assert.equal(csvCell('a=b'), '"a=b"');
  assert.equal(csvCell('x@y.com'), '"x@y.com"');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/csv.test.js` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement `lib/csv.js`**

```js
const FORMULA_START = /^[=+\-@\t\r]/;

/* A spreadsheet runs any cell that starts with = + - @ as a formula. Prefixing
   a single quote makes it plain text when the file is opened. */
function csvCell(value) {
  let text = String(value ?? '');
  if (FORMULA_START.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

module.exports = { csvCell };
```

- [ ] **Step 4: Use it in the export**

In `routes_events.js`, add `const { csvCell } = require('./lib/csv');` at the top, delete the local `const esc = ...` line, and change `cols.map(c => esc(r[c]))` to `cols.map(c => csvCell(r[c]))`. Then:

```bash
grep -n "text/csv\|\.csv" server.js routes_*.js
```
Any other CSV writer found must use `csvCell` too.

- [ ] **Step 5: Run the test, then commit**

Run: `node --test tests/csv.test.js` — Expected: 4 passing.

```bash
git add lib/csv.js routes_events.js tests/csv.test.js
git commit -m "fix: neutralise spreadsheet formulas in CSV exports" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 7: Invite-only events must not be registrable by alumni (review finding 3)

**Files:**
- Modify: `routes_events.js` (helpers near the top of `mountEvents`; `GET /api/events/:id`; ticket-types; register)
- Test: `tests/event-visibility.test.js`

- [ ] **Step 1: Write the failing test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers/app');
const { insertUser, insertEvent, mintToken } = require('./helpers/seed');

let app, alumnus, staff, invite, open;
test.before(async () => {
  app = await startApp();
  alumnus = await insertUser(app.dbUrl, { email: 'a@x.edu', role: 'alumni' });
  staff = await insertUser(app.dbUrl, { email: 's@x.edu', role: 'univ_admin' });
  invite = await insertEvent(app.dbUrl, { visibility: 'invite' });
  open = await insertEvent(app.dbUrl, { visibility: 'alumni' });
});
test.after(async () => { await app.stop(); });

const call = (user, method, path) => fetch(`${app.base}${path}`, {
  method,
  headers: { authorization: `Bearer ${mintToken({ uid: user.id, role: user.role })}`, 'content-type': 'application/json' },
  body: method === 'POST' ? '{}' : undefined
});

test('an alumnus cannot register for an invite-only event', async () => {
  assert.equal((await call(alumnus, 'POST', `/api/events/${invite.id}/register`)).status, 403);
});
test('an alumnus cannot list ticket types of an invite-only event', async () => {
  assert.equal((await call(alumnus, 'GET', `/api/events/${invite.id}/ticket-types`)).status, 403);
});
test('an alumnus can still register for a normal event', async () => {
  assert.equal((await call(alumnus, 'POST', `/api/events/${open.id}/register`)).status, 200);
});
test('staff can still see an invite-only event\'s ticket types', async () => {
  assert.equal((await call(staff, 'GET', `/api/events/${invite.id}/ticket-types`)).status, 200);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/event-visibility.test.js` — Expected: FAIL (`200 !== 403`) on the first two tests.

- [ ] **Step 3: Add one shared visibility rule and use it in three places**

Inside `mountEvents`, next to `isStaff`, add:

```js
  const isPubliclyVisible = (e) =>
    e.approval_status === 'approved' && e.status !== 'cancelled' && e.visibility !== 'invite';
  const canViewEvent = (user, e) => isStaff(user) || isPubliclyVisible(e);
```

In `GET /api/events/:id`, replace the inline condition with `if (!canViewEvent(req.user, event))`. In the register handler, right after `const event = ev.rows[0];`:

```js
      if (!canViewEvent(req.user, event)) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'This event is not available' });
      }
```

Replace the body of `GET /api/events/:id/ticket-types`:

```js
  app.get('/api/events/:id/ticket-types', requireAuth, (req, res) => ok(res, async () => {
    const event = await loadEvent(num(req.params.id));
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (!canViewEvent(req.user, event)) return res.status(403).json({ error: 'This event is not available' });
    res.json(await ticketTypesFor(event.id));
  }));
```

- [ ] **Step 4: Run the test, then commit**

Run: `node --test tests/event-visibility.test.js` — Expected: 4 passing.

```bash
git add routes_events.js tests/event-visibility.test.js
git commit -m "fix: enforce event visibility on registration and ticket types" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 8: Event edits: status and re-approval (review finding 4)

A moderator can set `status` through `PUT /api/events/:id`, and can change an approved event materially without it going back for approval.

**Files:**
- Modify: `routes_events.js` (`PUT /api/events/:id`, near line 331)
- Test: `tests/event-edit.test.js`

- [ ] **Step 1: Write the failing test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers/app');
const { insertUser, insertEvent, mintToken, withClient } = require('./helpers/seed');

let app, mod, admin, ev;
test.before(async () => {
  app = await startApp();
  mod = await insertUser(app.dbUrl, { email: 'm@x.edu', role: 'moderator' });
  admin = await insertUser(app.dbUrl, { email: 'ad@x.edu', role: 'univ_admin' });
});
test.beforeEach(async () => { ev = await insertEvent(app.dbUrl, {}); });
test.after(async () => { await app.stop(); });

const put = (user, id, body) => fetch(`${app.base}/api/events/${id}`, {
  method: 'PUT',
  headers: { authorization: `Bearer ${mintToken({ uid: user.id, role: user.role })}`, 'content-type': 'application/json' },
  body: JSON.stringify(body)
});
const row = (id) => withClient(app.dbUrl, async (c) => (await c.query('SELECT * FROM events WHERE id=$1', [id])).rows[0]);

test('a moderator cannot change run status', async () => {
  assert.equal((await put(mod, ev.id, { status: 'past' })).status, 403);
  assert.equal((await row(ev.id)).status, 'upcoming');
});
test('a moderator\'s material edit sends an approved event back for approval', async () => {
  assert.equal((await put(mod, ev.id, { venue: 'Somewhere else' })).status, 200);
  const r = await row(ev.id);
  assert.equal(r.venue, 'Somewhere else');
  assert.equal(r.approval_status, 'pending_approval');
});
test('a moderator\'s cosmetic edit keeps the event approved', async () => {
  assert.equal((await put(mod, ev.id, { coverImageUrl: 'https://x/y.png' })).status, 200);
  assert.equal((await row(ev.id)).approval_status, 'approved');
});
test('an administrator can change status and edit without losing approval', async () => {
  assert.equal((await put(admin, ev.id, { status: 'past', venue: 'Main hall' })).status, 200);
  const r = await row(ev.id);
  assert.equal(r.status, 'past');
  assert.equal(r.approval_status, 'approved');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/event-edit.test.js` — Expected: FAIL on the first two tests.

- [ ] **Step 3: Implement**

Read the whole `PUT /api/events/:id` handler first. Define once at module level, above `mountEvents`:

```js
// Edits that change what an approver signed off on. Anything else (cover image,
// description, registration window) does not need a second look.
const MATERIAL_FIELDS = ['title', 'venue', 'startsOn', 'startTime', 'endTime', 'capacity', 'visibility', 'eventType'];
```

At the top of the handler, after `const b = req.body || {};`, add:

```js
    const isAdminUser = ADMIN_ROLES.includes(req.user.role);
    if (b.status !== undefined && !isAdminUser) {
      return res.status(403).json({ error: 'Only administrators can change an event\'s run status' });
    }
    const current = await loadEvent(id);
    if (!current) return res.status(404).json({ error: 'Event not found' });
```

After the `sets`/`vals` arrays are fully built and before the `UPDATE` runs, add:

```js
    const touchesMaterial = MATERIAL_FIELDS.some((k) => b[k] !== undefined);
    if (!isAdminUser && touchesMaterial && current.approval_status === 'approved') {
      sets.push(`approval_status = 'pending_approval'`, 'approved_by = NULL', 'approved_at = NULL');
    }
```

(The three fragments are constants, not user input.) If the handler already loads the event later, reuse `current` instead of loading twice.

- [ ] **Step 4: Run the test, then commit**

Run: `node --test tests/event-edit.test.js` — Expected: 4 passing.

```bash
git add routes_events.js tests/event-edit.test.js
git commit -m "fix: restrict event status edits and re-approve material changes" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 9: Directory search must respect privacy settings (review finding 5)

`GET /api/directory/search` (moderators and above) returns phone and WhatsApp numbers even when the alumnus marked their mobile `private`, and the phone-number search can be used to confirm a private number. `GET /api/alumni/:id` already hides private fields from moderators; the directory must agree.

**Files:**
- Modify: `routes_events.js` (`GET /api/directory/search`, near line 1306)
- Test: `tests/directory-privacy.test.js`

- [ ] **Step 1: Write the failing test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers/app');
const { insertUser, mintToken, withClient } = require('./helpers/seed');

let app, mod, dean, hidden, shared;
test.before(async () => {
  app = await startApp();
  mod = await insertUser(app.dbUrl, { email: 'm@x.edu', role: 'moderator' });
  dean = await insertUser(app.dbUrl, { email: 'd@x.edu', role: 'dept_admin' });
  hidden = await insertUser(app.dbUrl, { email: 'h@x.edu', name: 'Hidden Hana' });
  shared = await insertUser(app.dbUrl, { email: 's@x.edu', name: 'Shared Sam' });
  await withClient(app.dbUrl, async (c) => {
    const add = (uid, sid, mobile, privacy) => c.query(
      `INSERT INTO alumni_profiles (user_id, student_id, batch, passing_year, department, primary_email, mobile_number, privacy_settings)
       VALUES ($1,$2,2020,2024,'CSE',$3,$4,$5::jsonb)`, [uid, sid, `${sid}@x.edu`, mobile, JSON.stringify(privacy)]);
    await add(hidden.id, 'S-1', '01711111111', { mobile: 'private' });
    await add(shared.id, 'S-2', '01822222222', { mobile: 'public' });
  });
});
test.after(async () => { await app.stop(); });

const search = async (user, q) => (await (await fetch(`${app.base}/api/directory/search?q=${encodeURIComponent(q)}`, {
  headers: { authorization: `Bearer ${mintToken({ uid: user.id, role: user.role })}` }
})).json()).results;

test('a moderator does not see a private mobile number', async () => {
  const [r] = await search(mod, 'Hidden');
  assert.equal(r.phone, null);
  assert.equal(r.whatsapp, null);
});
test('a moderator still sees a number the alumnus shared', async () => {
  const [r] = await search(mod, 'Shared');
  assert.equal(r.phone, '01822222222');
});
test('a moderator cannot find a private number by searching for it', async () => {
  assert.deepEqual(await search(mod, '01711111111'), []);
});
test('a department admin sees every number', async () => {
  const [r] = await search(dean, 'Hidden');
  assert.equal(r.phone, '01711111111');
});
test('the response never exposes the raw privacy settings', async () => {
  const [r] = await search(dean, 'Hidden');
  assert.equal('privacy_settings' in r, false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/directory-privacy.test.js` — Expected: FAIL on the first and third tests.

- [ ] **Step 3: Implement**

At the top of the handler: `const fullAccess = ['super_admin', 'univ_admin', 'dept_admin'].includes(req.user.role);` (the same set `GET /api/alumni/:id` uses).

In the `q` clause, wrap only the phone comparison:

```js
        OR (regexp_replace(COALESCE(ap.mobile_number, ''), '[^0-9]', '', 'g') LIKE
              regexp_replace(${p}, '[^0-9%]', '', 'g')
            AND ${fullAccess ? 'TRUE' : "COALESCE(ap.privacy_settings->>'mobile', '') <> 'private'"})
```

(`fullAccess` is a server-side boolean; no user input reaches the SQL text.) Add `ap.privacy_settings` to the `SELECT`, and replace `res.json({ results: r.rows, query: q })` with:

```js
    const results = r.rows.map(({ privacy_settings, ...row }) => {
      const hidden = !fullAccess && row.id !== req.user.uid && (privacy_settings || {}).mobile === 'private';
      return hidden ? { ...row, phone: null, whatsapp: null } : row;
    });
    res.json({ results, query: q });
```

- [ ] **Step 4: Run the test, then commit**

Run: `node --test tests/directory-privacy.test.js` — Expected: 5 passing.

```bash
git add routes_events.js tests/directory-privacy.test.js
git commit -m "fix: apply alumni privacy settings in directory search" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 10: Payments are settled by the gateway, not by the payer (review findings 1 and 2)

`POST /api/donations/:id/confirm` takes `success` from the donor's own request, and a paid event registration is `confirmed` the moment it is created. Neither involves a payment provider; the code simulates one.

> **Decision for the owner (default chosen, reversible):** there is no real payment gateway in this codebase. This task makes settlement require one of: a gateway callback signed with `PAYMENT_WEBHOOK_SECRET`, an administrator, or, outside production only and only when `PAYMENT_SIMULATION=true`, the payer. Result: in production, donations and paid tickets stay *pending* until a real gateway is wired to the signed callback or staff reconcile them. Free events and free tickets are unaffected: free-event registration stays instant.

**Files:**
- Create: `lib/payment-auth.js`, `migrations/0009_payments.sql`
- Modify: `routes_v2.js` (donation confirm, near line 283), `routes_events.js` (register; new confirm route; check-in)
- Test: `tests/payment-auth.test.js`, `tests/donation-settlement.test.js`, `tests/event-payment.test.js`

**Interfaces:**
- Produces: `signSettlement(secret, message) -> hex`; `mayAuthorizeSettlement({ req, message, ownerId, adminRoles, env? }) -> { ok: boolean, via?: 'gateway'|'admin'|'simulation' }`.
- Message formats: `donation:<id>:<1|0>` and `registration:<id>:<1|0>`; header `x-gateway-signature`.
- Produces: `POST /api/events/registrations/:id/confirm-payment` body `{ success: boolean }`.

- [ ] **Step 1: Write the failing unit test**

`tests/payment-auth.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { signSettlement, mayAuthorizeSettlement } = require('../lib/payment-auth');

const ADMIN = ['super_admin', 'univ_admin'];
const req = (user, sig) => ({ user, get: (h) => (h.toLowerCase() === 'x-gateway-signature' ? sig : undefined) });
const msg = 'donation:7:1';

test('a valid gateway signature is accepted without any user', () => {
  const sig = signSettlement('s3cret', msg);
  assert.deepEqual(mayAuthorizeSettlement({ req: req(null, sig), message: msg, ownerId: 5, adminRoles: ADMIN, env: { PAYMENT_WEBHOOK_SECRET: 's3cret' } }), { ok: true, via: 'gateway' });
});
test('a signature for a different outcome is refused', () => {
  const sig = signSettlement('s3cret', 'donation:7:0');
  assert.equal(mayAuthorizeSettlement({ req: req(null, sig), message: msg, ownerId: 5, adminRoles: ADMIN, env: { PAYMENT_WEBHOOK_SECRET: 's3cret' } }).ok, false);
});
test('no secret configured means no signature is ever valid', () => {
  const sig = signSettlement('', msg);
  assert.equal(mayAuthorizeSettlement({ req: req(null, sig), message: msg, ownerId: 5, adminRoles: ADMIN, env: {} }).ok, false);
});
test('an administrator may settle', () => {
  assert.equal(mayAuthorizeSettlement({ req: req({ uid: 1, role: 'univ_admin' }), message: msg, ownerId: 5, adminRoles: ADMIN, env: {} }).via, 'admin');
});
test('the payer may not settle their own payment in production', () => {
  const env = { PAYMENT_SIMULATION: 'true', NODE_ENV: 'production' };
  assert.equal(mayAuthorizeSettlement({ req: req({ uid: 5, role: 'alumni' }), message: msg, ownerId: 5, adminRoles: ADMIN, env }).ok, false);
});
test('the payer may settle only when simulation is on outside production', () => {
  const env = { PAYMENT_SIMULATION: 'true', NODE_ENV: 'development' };
  assert.equal(mayAuthorizeSettlement({ req: req({ uid: 5, role: 'alumni' }), message: msg, ownerId: 5, adminRoles: ADMIN, env }).via, 'simulation');
  assert.equal(mayAuthorizeSettlement({ req: req({ uid: 6, role: 'alumni' }), message: msg, ownerId: 5, adminRoles: ADMIN, env }).ok, false);
  assert.equal(mayAuthorizeSettlement({ req: req({ uid: 5, role: 'alumni' }), message: msg, ownerId: 5, adminRoles: ADMIN, env: { NODE_ENV: 'development' } }).ok, false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/payment-auth.test.js` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement `lib/payment-auth.js`**

```js
const crypto = require('crypto');

const signSettlement = (secret, message) =>
  crypto.createHmac('sha256', String(secret)).update(message).digest('hex');

function validSignature(secret, message, provided) {
  if (!secret || !provided) return false;
  const a = Buffer.from(signSettlement(secret, message));
  const b = Buffer.from(String(provided));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* Who may mark a payment paid or failed. The payer is deliberately not on the
   list in production: a settlement claim from the person being charged is not
   evidence of payment. */
function mayAuthorizeSettlement({ req, message, ownerId, adminRoles, env = process.env }) {
  if (validSignature(env.PAYMENT_WEBHOOK_SECRET, message, req.get('x-gateway-signature'))) {
    return { ok: true, via: 'gateway' };
  }
  const user = req.user;
  if (user && adminRoles.includes(user.role)) return { ok: true, via: 'admin' };
  if (env.PAYMENT_SIMULATION === 'true' && env.NODE_ENV !== 'production' && user && user.uid === ownerId) {
    return { ok: true, via: 'simulation' };
  }
  return { ok: false };
}

module.exports = { signSettlement, mayAuthorizeSettlement };
```

Run `node --test tests/payment-auth.test.js` — Expected: 6 passing.

- [ ] **Step 4: Write the failing donation test**

`tests/donation-settlement.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers/app');
const { insertUser, mintToken, withClient } = require('./helpers/seed');
const { signSettlement } = require('../lib/payment-auth');

let app, donor, admin, campaignId;
test.before(async () => {
  app = await startApp({ env: { PAYMENT_WEBHOOK_SECRET: 'gw-secret', NODE_ENV: 'test' } });
  delete process.env.PAYMENT_SIMULATION;
  donor = await insertUser(app.dbUrl, { email: 'd@x.edu' });
  admin = await insertUser(app.dbUrl, { email: 'a@x.edu', role: 'univ_admin' });
  campaignId = await withClient(app.dbUrl, async (c) => (await c.query(`INSERT INTO campaigns (name) VALUES ('Fund') RETURNING id`)).rows[0].id);
});
test.after(async () => { await app.stop(); });

const auth = (u) => ({ authorization: `Bearer ${mintToken({ uid: u.id, role: u.role })}`, 'content-type': 'application/json' });
async function pendingDonation() {
  const r = await fetch(`${app.base}/api/donations`, { method: 'POST', headers: auth(donor),
    body: JSON.stringify({ campaignId, amount: 500, gateway: 'bkash' }) });
  return (await r.json()).donation.id;
}
const status = (id) => withClient(app.dbUrl, async (c) => (await c.query('SELECT status FROM donations WHERE id=$1', [id])).rows[0].status);
const confirm = (id, headers, body) => fetch(`${app.base}/api/donations/${id}/confirm`, { method: 'POST', headers, body: JSON.stringify(body) });

test('the donor cannot mark their own donation paid', async () => {
  const id = await pendingDonation();
  assert.equal((await confirm(id, auth(donor), { success: true })).status, 403);
  assert.equal(await status(id), 'PENDING');
});
test('an administrator can settle it', async () => {
  const id = await pendingDonation();
  assert.equal((await confirm(id, auth(admin), { success: true })).status, 200);
  assert.equal(await status(id), 'SUCCESS');
});
test('a correctly signed gateway callback settles it with no session', async () => {
  const id = await pendingDonation();
  const sig = signSettlement('gw-secret', `donation:${id}:1`);
  assert.equal((await confirm(id, { 'content-type': 'application/json', 'x-gateway-signature': sig }, { success: true })).status, 200);
  assert.equal(await status(id), 'SUCCESS');
});
test('a callback signed for failure cannot be replayed as success', async () => {
  const id = await pendingDonation();
  const sig = signSettlement('gw-secret', `donation:${id}:0`);
  assert.equal((await confirm(id, { 'content-type': 'application/json', 'x-gateway-signature': sig }, { success: true })).status, 401);
});
test('success must be stated explicitly', async () => {
  const id = await pendingDonation();
  assert.equal((await confirm(id, auth(admin), {})).status, 400);
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `node --test tests/donation-settlement.test.js` — Expected: FAIL (the donor's own confirm returns 200).

- [ ] **Step 6: Rewrite the confirm handler's authorization**

In `routes_v2.js`, add `const { mayAuthorizeSettlement } = require('./lib/payment-auth');`. Change the route to drop `requireAuth` (a gateway callback has no session) and authorize in the handler:

```js
  app.post('/api/donations/:id/confirm', (req, res) => ok(res, async () => {
    const id = parseInt(req.params.id);
    const { success, failureReason } = req.body || {};
    if (typeof success !== 'boolean') return res.status(400).json({ error: '"success" must be true or false' });

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const cur = await client.query('SELECT * FROM donations WHERE id=$1 FOR UPDATE', [id]);
      if (!cur.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Donation not found' }); }

      const auth = mayAuthorizeSettlement({
        req, message: `donation:${id}:${success ? 1 : 0}`,
        ownerId: cur.rows[0].donor_user_id, adminRoles: ADMIN_ROLES
      });
      if (!auth.ok) {
        await client.query('ROLLBACK');
        return res.status(req.user ? 403 : 401).json({ error: 'Payment settlement is not authorised' });
      }
      // … the existing idempotency check and update stay as they are …
```

Two further edits inside the existing body: the notification insert must go to `cur.rows[0].donor_user_id` (a gateway callback has no `req.user`), not `req.user.uid`; and the audit line should include `via: ${auth.via}`. Keep everything else.

- [ ] **Step 7: Run the donation test, then add the migration**

Run: `node --test tests/donation-settlement.test.js` — Expected: 5 passing.

Create `migrations/0009_payments.sql`:

```sql
-- Paid tickets wait for the gateway; amount_due is what they must pay.
ALTER TABLE event_registrations DROP CONSTRAINT IF EXISTS event_registrations_status_check;
ALTER TABLE event_registrations ADD CONSTRAINT event_registrations_status_check
  CHECK (status IN ('confirmed', 'waitlisted', 'cancelled', 'pending_payment'));
ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS amount_due NUMERIC(12,2) NOT NULL DEFAULT 0;
```

- [ ] **Step 8: Write the failing paid-event test**

`tests/event-payment.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers/app');
const { insertUser, insertEvent, mintToken, withClient } = require('./helpers/seed');
const { signSettlement } = require('../lib/payment-auth');

let app, alumnus, staff;
test.before(async () => {
  app = await startApp({ env: { PAYMENT_WEBHOOK_SECRET: 'gw-secret', NODE_ENV: 'test' } });
  delete process.env.PAYMENT_SIMULATION;
  alumnus = await insertUser(app.dbUrl, { email: 'a@x.edu' });
  staff = await insertUser(app.dbUrl, { email: 's@x.edu', role: 'univ_admin' });
});
test.after(async () => { await app.stop(); });

const auth = (u) => ({ authorization: `Bearer ${mintToken({ uid: u.id, role: u.role })}`, 'content-type': 'application/json' });
const register = (ev) => fetch(`${app.base}/api/events/${ev.id}/register`, { method: 'POST', headers: auth(alumnus), body: JSON.stringify({ paymentGateway: 'bkash' }) });
const reg = (eventId) => withClient(app.dbUrl, async (c) => (await c.query('SELECT * FROM event_registrations WHERE event_id=$1 AND user_id=$2', [eventId, alumnus.id])).rows[0]);
const count = (eventId) => withClient(app.dbUrl, async (c) => (await c.query('SELECT registered_count n FROM events WHERE id=$1', [eventId])).rows[0].n);
const callback = (regId, success, extra = {}) => fetch(`${app.base}/api/events/registrations/${regId}/confirm-payment`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-gateway-signature': signSettlement('gw-secret', `registration:${regId}:${success ? 1 : 0}`) },
  body: JSON.stringify({ success, ...extra })
});

test('a paid ticket is pending, owes the price, and holds no seat', async () => {
  const ev = await insertEvent(app.dbUrl, { isPaid: true, price: 800 });
  assert.equal((await register(ev)).status, 200);
  const r = await reg(ev.id);
  assert.equal(r.status, 'pending_payment');
  assert.equal(Number(r.amount_due), 800);
  assert.equal(Number(r.amount_paid), 0);
  assert.equal(await count(ev.id), 0);
});
test('a free ticket is confirmed immediately', async () => {
  const ev = await insertEvent(app.dbUrl, {});
  assert.equal((await register(ev)).status, 200);
  assert.equal((await reg(ev.id)).status, 'confirmed');
});
test('the attendee cannot confirm their own payment', async () => {
  const ev = await insertEvent(app.dbUrl, { isPaid: true, price: 800 });
  await register(ev);
  const r = await reg(ev.id);
  const res = await fetch(`${app.base}/api/events/registrations/${r.id}/confirm-payment`, { method: 'POST', headers: auth(alumnus), body: JSON.stringify({ success: true }) });
  assert.equal(res.status, 403);
  assert.equal((await reg(ev.id)).status, 'pending_payment');
});
test('a signed gateway callback confirms the ticket and records the price from the database', async () => {
  const ev = await insertEvent(app.dbUrl, { isPaid: true, price: 800 });
  await register(ev);
  const r = await reg(ev.id);
  assert.equal((await callback(r.id, true, { amount: 1 })).status, 200);
  const after = await reg(ev.id);
  assert.equal(after.status, 'confirmed');
  assert.equal(Number(after.amount_paid), 800);
  assert.equal(await count(ev.id), 1);
});
test('payment for an event that filled up in the meantime does not take a seat', async () => {
  const ev = await insertEvent(app.dbUrl, { isPaid: true, price: 800, capacity: 1 });
  await register(ev);
  const r = await reg(ev.id);
  await withClient(app.dbUrl, async (c) => {
    await c.query(`INSERT INTO event_registrations (event_id, user_id, ticket_code, qr_payload, status) VALUES ($1,$2,'T-OTHER','{}','confirmed')`, [ev.id, staff.id]);
  });
  assert.equal((await callback(r.id, true)).status, 200);
  assert.notEqual((await reg(ev.id)).status, 'confirmed');
});
test('a pending ticket cannot be checked in', async () => {
  const ev = await insertEvent(app.dbUrl, { isPaid: true, price: 800 });
  await register(ev);
  const r = await reg(ev.id);
  const res = await fetch(`${app.base}/api/events/checkin`, { method: 'POST', headers: auth(staff), body: JSON.stringify({ ticketCode: r.ticket_code }) });
  assert.ok(res.status >= 400);
  assert.equal((await reg(ev.id)).checked_in, false);
});
```

- [ ] **Step 9: Run it to verify it fails**

Run: `node --test tests/event-payment.test.js` — Expected: FAIL (`'confirmed' !== 'pending_payment'`).

- [ ] **Step 10: Change registration and add the confirm route**

In the register handler (`routes_events.js`, around the `status`/`priceValue` lines), compute the price first, then:

```js
      const requiresPayment = priceValue > 0;
      const status = requiresPayment ? 'pending_payment' : (full ? 'waitlisted' : 'confirmed');
```

Keep the existing "full and no waitlist → 409" check above it so no one is asked to pay for a full event. Change the insert to write `amount_paid = 0` and `amount_due = priceValue` (add the `amount_due` column to both lists). `registered_count` is already incremented only when `status === 'confirmed'`. Make the notification text for `pending_payment` read `Complete payment to confirm your ticket for "<title>".`.

Add the settlement route inside `mountEvents`, with `const { mayAuthorizeSettlement } = require('./lib/payment-auth');` imported at the top:

```js
  app.post('/api/events/registrations/:id/confirm-payment', (req, res) => ok(res, async () => {
    const id = num(req.params.id);
    const { success } = req.body || {};
    if (typeof success !== 'boolean') return res.status(400).json({ error: '"success" must be true or false' });

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const r = await client.query('SELECT * FROM event_registrations WHERE id=$1 FOR UPDATE', [id]);
      if (!r.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Registration not found' }); }
      const reg = r.rows[0];

      const auth = mayAuthorizeSettlement({
        req, message: `registration:${id}:${success ? 1 : 0}`, ownerId: reg.user_id, adminRoles: ADMIN_ROLES
      });
      if (!auth.ok) {
        await client.query('ROLLBACK');
        return res.status(req.user ? 403 : 401).json({ error: 'Payment settlement is not authorised' });
      }
      if (reg.status !== 'pending_payment') {
        await client.query('ROLLBACK');
        return res.json({ registration: reg, alreadySettled: true });
      }

      let next = 'cancelled';
      if (success) {
        const ev = (await client.query('SELECT * FROM events WHERE id=$1 FOR UPDATE', [reg.event_id])).rows[0];
        const taken = (await client.query(
          "SELECT COUNT(*)::int n FROM event_registrations WHERE event_id=$1 AND status='confirmed'", [reg.event_id])).rows[0].n;
        next = taken < ev.capacity ? 'confirmed' : (ev.waitlist_enabled ? 'waitlisted' : 'cancelled');
        if (next === 'confirmed') {
          await client.query('UPDATE events SET registered_count = registered_count + 1 WHERE id=$1', [reg.event_id]);
        }
      }
      const upd = await client.query(
        'UPDATE event_registrations SET status=$2, amount_paid=$3 WHERE id=$1 RETURNING *',
        [id, next, success && next !== 'cancelled' ? reg.amount_due : 0]);
      await client.query('COMMIT');
      res.json({ registration: upd.rows[0], needsRefund: success && next === 'cancelled' });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }));
```

Read the check-in handler (`routes_events.js`, around `POST /api/events/checkin`). If its ticket lookup does not already require `status = 'confirmed'`, add that condition so a `pending_payment` or `waitlisted` ticket is refused.

- [ ] **Step 11: Run all three payment tests, then commit**

Run: `node --test tests/payment-auth.test.js tests/donation-settlement.test.js tests/event-payment.test.js` — Expected: all passing.

Add to `.env.example`:

```bash
# Payment settlement. A donation or paid ticket is marked paid only by a gateway
# callback signed with this secret, or by an administrator.
# PAYMENT_WEBHOOK_SECRET="replace-with-a-random-hex-string"
# Non-production only: let the payer settle their own payment (simulated gateway).
# PAYMENT_SIMULATION=false
```

```bash
git add lib/payment-auth.js migrations/0009_payments.sql routes_v2.js routes_events.js .env.example tests/payment-auth.test.js tests/donation-settlement.test.js tests/event-payment.test.js
git commit -m "fix: settle payments by gateway or administrator, never by the payer" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 11: Control database and credential encryption

**Files:**
- Create: `control_migrations/0001_control.sql`, `tenancy/secret-box.js`, `tenancy/config.js`, `tenancy/colleges.js`
- Test: `tests/secret-box.test.js`, `tests/colleges.test.js`

**Interfaces:**
- Produces: `seal(plain, keyHex) -> string` (`v1:<iv>:<tag>:<ciphertext>`), `open(sealed, keyHex) -> string` (throws on tamper or wrong key).
- Produces: `loadTenancyConfig(env?) -> { controlUrl, provisionerUrl, tenantKey, maxTenantPools }`, throws naming the first missing variable.
- Produces (`colleges.js`, each takes a pg `queryable` as first argument): `findByTenantId(q, tenantId)`, `findById(q, id)`, `insertPending(q, { tenantId, slug, displayName })`, `claimForProvisioning(q, id)`, `markActive(q, id, { dbName, dbRole, credentialSealed, schemaVersion })`, `markFailed(q, id, reason)`, `updateBranding(q, id, { displayName, accentColor })`, `setLogo(q, id, { contentType, bytes })`, `getLogo(q, id)`.

- [ ] **Step 1: Write the failing secret-box test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { seal, open } = require('../tenancy/secret-box');

const KEY = 'ab'.repeat(32);

test('round-trips a value', () => assert.equal(open(seal('pa$$w0rd', KEY), KEY), 'pa$$w0rd'));
test('two seals of the same value differ', () => assert.notEqual(seal('x', KEY), seal('x', KEY)));
test('a wrong key fails', () => assert.throws(() => open(seal('x', KEY), 'cd'.repeat(32))));
test('a tampered value fails', () => {
  const parts = seal('hello', KEY).split(':');
  parts[3] = (parts[3][0] === '0' ? '1' : '0') + parts[3].slice(1);
  assert.throws(() => open(parts.join(':'), KEY));
});
test('a malformed key is rejected', () => assert.throws(() => seal('x', 'short'), /64 hex/));
```

- [ ] **Step 2: Run it to verify it fails, implement, rerun**

Run: `node --test tests/secret-box.test.js` — Expected: FAIL, module not found.

`tenancy/secret-box.js`:

```js
const crypto = require('crypto');

function keyBuffer(keyHex) {
  if (!/^[0-9a-fA-F]{64}$/.test(String(keyHex || ''))) throw new Error('TENANT_KEY must be 64 hex characters');
  return Buffer.from(keyHex, 'hex');
}

function seal(plain, keyHex) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer(keyHex), iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('hex'), cipher.getAuthTag().toString('hex'), ct.toString('hex')].join(':');
}

function open(sealed, keyHex) {
  const [version, iv, tag, ct] = String(sealed).split(':');
  if (version !== 'v1' || !iv || !tag || ct === undefined) throw new Error('unrecognised sealed value');
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer(keyHex), Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'hex')), decipher.final()]).toString('utf8');
}

module.exports = { seal, open };
```

Run: `node --test tests/secret-box.test.js` — Expected: 5 passing.

- [ ] **Step 3: Write the control schema**

`control_migrations/0001_control.sql`:

```sql
CREATE TABLE IF NOT EXISTS colleges (
  id                SERIAL PRIMARY KEY,
  shikhon_tenant_id TEXT NOT NULL UNIQUE,
  slug              TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z][a-z0-9_]{2,39}$'),
  display_name      TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
  accent_color      TEXT CHECK (accent_color IS NULL OR accent_color ~ '^#[0-9a-fA-F]{6}$'),
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'provisioning', 'active', 'failed', 'suspended')),
  db_name           TEXT UNIQUE,
  db_role           TEXT UNIQUE,
  db_credential_enc TEXT,
  schema_version    TEXT,
  failure_reason    TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  provisioned_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS college_logos (
  college_id   INT PRIMARY KEY REFERENCES colleges(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp')),
  bytes        BYTEA NOT NULL CHECK (octet_length(bytes) > 0),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- [ ] **Step 4: Write `tenancy/config.js`**

```js
const REQUIRED = ['CONTROL_DATABASE_URL', 'PROVISIONER_DATABASE_URL', 'TENANT_KEY'];

function loadTenancyConfig(env = process.env) {
  for (const name of REQUIRED) {
    if (!env[name]) throw new Error(`${name} is required when MULTI_TENANT=1`);
  }
  return Object.freeze({
    controlUrl: env.CONTROL_DATABASE_URL,
    provisionerUrl: env.PROVISIONER_DATABASE_URL,
    tenantKey: env.TENANT_KEY,
    maxTenantPools: Number(env.MAX_TENANT_POOLS) || 50
  });
}
module.exports = { loadTenancyConfig };
```

- [ ] **Step 5: Write the failing `colleges` test**

`tests/colleges.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { Pool } = require('pg');
const { createTempDb } = require('./helpers/pg');
const { applyMigrationsToUrl } = require('../tenancy/migrations');
const colleges = require('../tenancy/colleges');

const CONTROL_DIR = path.join(__dirname, '..', 'control_migrations');
let dbh, pool;
test.before(async () => {
  dbh = await createTempDb('alumni_control_test');
  await applyMigrationsToUrl(dbh.url, CONTROL_DIR);
  pool = new Pool({ connectionString: dbh.url });
});
test.after(async () => { await pool.end(); await dbh.drop(); });

test('insertPending then findByTenantId', async () => {
  const c = await colleges.insertPending(pool, { tenantId: 't-1', slug: 'test_college_ab12cd', displayName: 'Test College' });
  assert.equal(c.status, 'pending');
  assert.equal((await colleges.findByTenantId(pool, 't-1')).id, c.id);
});
test('insertPending is idempotent per tenant', async () => {
  const a = await colleges.insertPending(pool, { tenantId: 't-2', slug: 'second_ab12cd', displayName: 'Second' });
  const b = await colleges.insertPending(pool, { tenantId: 't-2', slug: 'second_ab12cd', displayName: 'Second' });
  assert.equal(a.id, b.id);
});
test('only one caller wins the claim for provisioning', async () => {
  const c = await colleges.insertPending(pool, { tenantId: 't-3', slug: 'third_ab12cd', displayName: 'Third' });
  const results = await Promise.all([colleges.claimForProvisioning(pool, c.id), colleges.claimForProvisioning(pool, c.id)]);
  assert.equal(results.filter(Boolean).length, 1);
});
test('a stale provisioning claim can be taken over', async () => {
  const c = await colleges.insertPending(pool, { tenantId: 't-4', slug: 'fourth_ab12cd', displayName: 'Fourth' });
  await colleges.claimForProvisioning(pool, c.id);
  await pool.query(`UPDATE colleges SET updated_at = now() - interval '11 minutes' WHERE id=$1`, [c.id]);
  assert.ok(await colleges.claimForProvisioning(pool, c.id));
});
test('branding rejects a bad accent colour and an empty name', async () => {
  const c = await colleges.insertPending(pool, { tenantId: 't-5', slug: 'fifth_ab12cd', displayName: 'Fifth' });
  await assert.rejects(colleges.updateBranding(pool, c.id, { displayName: 'Ok', accentColor: 'red' }));
  await assert.rejects(colleges.updateBranding(pool, c.id, { displayName: '', accentColor: null }));
  const ok = await colleges.updateBranding(pool, c.id, { displayName: 'New Name', accentColor: '#1a2b3c' });
  assert.equal(ok.display_name, 'New Name');
});
test('a logo can be stored and read back', async () => {
  const c = await colleges.insertPending(pool, { tenantId: 't-6', slug: 'sixth_ab12cd', displayName: 'Sixth' });
  await colleges.setLogo(pool, c.id, { contentType: 'image/png', bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]) });
  const logo = await colleges.getLogo(pool, c.id);
  assert.equal(logo.content_type, 'image/png');
  assert.equal(logo.bytes.length, 4);
});
```

- [ ] **Step 6: Run it to verify it fails, implement, rerun**

Run: `node --test tests/colleges.test.js` — Expected: FAIL, module not found.

`tenancy/colleges.js`:

```js
const STALE_PROVISIONING_MINUTES = 10;

const one = (r) => r.rows[0] || null;

async function findByTenantId(q, tenantId) {
  return one(await q.query('SELECT * FROM colleges WHERE shikhon_tenant_id = $1', [tenantId]));
}
async function findById(q, id) {
  return one(await q.query('SELECT * FROM colleges WHERE id = $1', [id]));
}

async function insertPending(q, { tenantId, slug, displayName }) {
  await q.query(
    `INSERT INTO colleges (shikhon_tenant_id, slug, display_name) VALUES ($1,$2,$3)
     ON CONFLICT (shikhon_tenant_id) DO NOTHING`, [tenantId, slug, displayName]);
  return findByTenantId(q, tenantId);
}

/* The provisioning lock: one atomic UPDATE. Exactly one concurrent caller gets
   a row back. A 'provisioning' row older than the stale window is taken over so
   a crashed provisioner does not wedge the college forever. */
async function claimForProvisioning(q, id) {
  return one(await q.query(
    `UPDATE colleges SET status = 'provisioning', failure_reason = NULL, updated_at = now()
      WHERE id = $1
        AND (status IN ('pending', 'failed')
             OR (status = 'provisioning' AND updated_at < now() - ($2 || ' minutes')::interval))
      RETURNING *`, [id, String(STALE_PROVISIONING_MINUTES)]));
}

async function markActive(q, id, { dbName, dbRole, credentialSealed, schemaVersion }) {
  return one(await q.query(
    `UPDATE colleges SET status='active', db_name=$2, db_role=$3, db_credential_enc=$4,
            schema_version=$5, provisioned_at=now(), updated_at=now(), failure_reason=NULL
      WHERE id=$1 RETURNING *`, [id, dbName, dbRole, credentialSealed, schemaVersion]));
}

async function markFailed(q, id, reason) {
  return one(await q.query(
    `UPDATE colleges SET status='failed', failure_reason=$2, updated_at=now(),
            db_name=NULL, db_role=NULL, db_credential_enc=NULL
      WHERE id=$1 RETURNING *`, [id, String(reason).slice(0, 500)]));
}

async function updateBranding(q, id, { displayName, accentColor }) {
  return one(await q.query(
    `UPDATE colleges SET display_name=$2, accent_color=$3, updated_at=now() WHERE id=$1 RETURNING *`,
    [id, displayName, accentColor]));
}

async function setLogo(q, id, { contentType, bytes }) {
  await q.query(
    `INSERT INTO college_logos (college_id, content_type, bytes) VALUES ($1,$2,$3)
     ON CONFLICT (college_id) DO UPDATE SET content_type=EXCLUDED.content_type, bytes=EXCLUDED.bytes, updated_at=now()`,
    [id, contentType, bytes]);
}
async function getLogo(q, id) {
  return one(await q.query('SELECT content_type, bytes, updated_at FROM college_logos WHERE college_id=$1', [id]));
}

module.exports = { findByTenantId, findById, insertPending, claimForProvisioning, markActive,
                   markFailed, updateBranding, setLogo, getLogo };
```

Run: `node --test tests/colleges.test.js` — Expected: 6 passing.

- [ ] **Step 7: Commit**

```bash
git add control_migrations tenancy/secret-box.js tenancy/config.js tenancy/colleges.js tests/secret-box.test.js tests/colleges.test.js
git commit -m "feat: add control database schema, college store and credential encryption" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 12: Pool registry and provisioner

**Files:**
- Create: `migrations/0010_shikhon_user.sql`, `tenancy/pool-registry.js`, `tenancy/provisioner.js`
- Test: `tests/provisioner.test.js`

**Interfaces:**
- Consumes: `colleges.*` (Task 11), `seal/open`, `applyMigrations`, `currentVersion`.
- Produces: `slugFor(tenantId, displayName) -> string` (always matches `^[a-z][a-z0-9_]{2,39}$`), `tenantUrl(adminUrl, dbName, role, password) -> string`.
- Produces: `provisionCollege({ control, adminUrl, tenantKey, tenantId, displayName, firstAdmin }) -> { state: 'active', college } | { state: 'in_progress' }` where `firstAdmin = { shikhonUserId, email, name }`.
- Produces: `createPoolRegistry({ adminUrl, tenantKey, max?, poolSize? }) -> { poolFor(college), closeAll(), size() }`.

- [ ] **Step 1: Add the tenant-DB migration for Shikhon IDs**

`migrations/0010_shikhon_user.sql`:

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS shikhon_user_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_shikhon_user_id_key ON users (shikhon_user_id) WHERE shikhon_user_id IS NOT NULL;
```

- [ ] **Step 2: Write the failing provisioner test**

`tests/provisioner.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Pool, Client } = require('pg');
const { createTempDb, ADMIN_URL, adminQuery } = require('./helpers/pg');
const { applyMigrationsToUrl, MIGRATIONS_DIR } = require('../tenancy/migrations');
const colleges = require('../tenancy/colleges');
const { provisionCollege, slugFor, tenantUrl } = require('../tenancy/provisioner');
const { open } = require('../tenancy/secret-box');

const KEY = 'ab'.repeat(32);
const admin = { shikhonUserId: 'su-1', email: 'dean@college.edu', name: 'Dean One' };
let control, pool;
test.before(async () => {
  control = await createTempDb('alumni_control_test');
  await applyMigrationsToUrl(control.url, path.join(__dirname, '..', 'control_migrations'));
  pool = new Pool({ connectionString: control.url });
});
test.after(async () => { await pool.end(); await control.drop(); });

const base = (tenantId, displayName = 'Test College') => ({
  control: pool, adminUrl: ADMIN_URL, tenantKey: KEY, tenantId, displayName, firstAdmin: admin
});
const dbExists = async (name) => (await adminQuery(`SELECT 1 FROM pg_database WHERE datname='${name}'`)).rowCount === 1;
const roleExists = async (name) => (await adminQuery(`SELECT 1 FROM pg_roles WHERE rolname='${name}'`)).rowCount === 1;
async function cleanup(college) {
  if (!college || !college.db_name) return;
  await adminQuery(`DROP DATABASE IF EXISTS "${college.db_name}" WITH (FORCE)`);
  await adminQuery(`DROP ROLE IF EXISTS "${college.db_role}"`);
}

test('slugFor always yields a safe identifier', () => {
  const hostile = ['t"; DROP DATABASE x;--', 'ÜBER Collège', 'A'.repeat(500), '123', '', "o'brien"];
  for (const t of hostile) {
    for (const name of [t, 'Some College', '']) {
      assert.match(slugFor(t, name), /^[a-z][a-z0-9_]{2,39}$/, JSON.stringify([t, name]));
    }
  }
  assert.notEqual(slugFor('tenant-a', 'Same Name'), slugFor('tenant-b', 'Same Name'));
  assert.equal(slugFor('tenant-a', 'Same Name'), slugFor('tenant-a', 'Same Name'));
});

test('provisions a database and role, migrates, makes the first admin, and stores an encrypted credential', async () => {
  const r = await provisionCollege(base('t-ok'));
  assert.equal(r.state, 'active');
  const c = r.college;
  try {
    assert.equal(c.status, 'active');
    assert.ok(await dbExists(c.db_name) && await roleExists(c.db_role));
    assert.ok(!c.db_credential_enc.includes(c.db_role));
    const password = open(c.db_credential_enc, KEY);
    const client = new Client({ connectionString: tenantUrl(ADMIN_URL, c.db_name, c.db_role, password) });
    await client.connect();
    const u = await client.query(`SELECT role, shikhon_user_id, email FROM users`);
    await client.end();
    assert.deepEqual(u.rows, [{ role: 'super_admin', shikhon_user_id: 'su-1', email: 'dean@college.edu' }]);
    assert.ok(c.schema_version.startsWith('0010'));
  } finally { await cleanup(c); }
});

test('one college\'s role cannot connect to another college\'s database', async () => {
  const a = (await provisionCollege(base('t-iso-a', 'College A'))).college;
  const b = (await provisionCollege(base('t-iso-b', 'College B'))).college;
  try {
    const pw = open(a.db_credential_enc, KEY);
    const wrong = new Client({ connectionString: tenantUrl(ADMIN_URL, b.db_name, a.db_role, pw) });
    await assert.rejects(wrong.connect(), /permission denied|not allowed|no pg_hba|authentication/i);
  } finally { await cleanup(a); await cleanup(b); }
});

test('two simultaneous first opens provision exactly once', async () => {
  const results = await Promise.all([provisionCollege(base('t-race')), provisionCollege(base('t-race'))]);
  const states = results.map((r) => r.state).sort();
  const college = results.find((r) => r.state === 'active')?.college;
  try {
    assert.deepEqual(states, ['active', 'in_progress']);
    const dbs = await adminQuery(`SELECT datname FROM pg_database WHERE datname LIKE 'alumni\\_${college.slug}%'`);
    assert.equal(dbs.rowCount, 1);
  } finally { await cleanup(college); }
});

test('hostile tenant ids and names provision without SQL injection', async () => {
  const hostile = `t"; DROP DATABASE postgres;--`;
  const r = await provisionCollege(base(hostile, `Evil "College"; DROP TABLE users;--`));
  try {
    assert.equal(r.state, 'active');
    assert.equal(r.college.shikhon_tenant_id, hostile);
    assert.match(r.college.db_name, /^alumni_[a-z][a-z0-9_]+$/);
  } finally { await cleanup(r.college); }
});

test('a failure after the database exists leaves nothing behind and can be retried', async () => {
  const bad = path.join(MIGRATIONS_DIR, '9999_break.sql');
  fs.writeFileSync(bad, 'SELECT * FROM table_that_does_not_exist;');
  try {
    await assert.rejects(provisionCollege(base('t-fail')), /9999_break\.sql/);
    const failed = await colleges.findByTenantId(pool, 't-fail');
    assert.equal(failed.status, 'failed');
    const leftovers = await adminQuery(`SELECT datname FROM pg_database WHERE datname LIKE 'alumni\\_${failed.slug}%'`);
    assert.equal(leftovers.rowCount, 0);
    assert.equal((await adminQuery(`SELECT 1 FROM pg_roles WHERE rolname LIKE 'alumni\\_${failed.slug}%'`)).rowCount, 0);
  } finally { fs.unlinkSync(bad); }
  const retry = await provisionCollege(base('t-fail'));
  try { assert.equal(retry.state, 'active'); } finally { await cleanup(retry.college); }
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node --test tests/provisioner.test.js` — Expected: FAIL, module not found.

- [ ] **Step 4: Implement `tenancy/provisioner.js`**

```js
const crypto = require('crypto');
const { Client } = require('pg');
const { sslFor } = require('../lib/pg-ssl');
const { seal } = require('./secret-box');
const { applyMigrations, currentVersion } = require('./migrations');
const colleges = require('./colleges');

const IDENT = /^[a-z][a-z0-9_]{2,39}$/;

/* A readable prefix from the college name plus six hex characters of a hash of
   the tenant id: always a valid, unique, injection-proof identifier no matter
   what the tenant id or name contain. */
function slugFor(tenantId, displayName) {
  const hash = crypto.createHash('sha256').update(String(tenantId)).digest('hex').slice(0, 6);
  const words = String(displayName || '').normalize('NFKD').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24);
  const prefix = /^[a-z]/.test(words) ? words : `c_${words}`.replace(/_+$/, '');
  const slug = `${prefix || 'college'}_${hash}`.slice(0, 40);
  if (!IDENT.test(slug)) throw new Error('could not derive a safe slug');
  return slug;
}

function tenantUrl(adminUrl, dbName, role, password) {
  const u = new URL(adminUrl);
  u.username = role;
  u.password = password;
  u.pathname = '/' + dbName;
  return u.toString();
}

function quoteIdent(name) {
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(name)) throw new Error(`unsafe identifier: ${name}`);
  return `"${name}"`;
}

async function withClient(url, fn) {
  const client = new Client({ connectionString: url, ssl: sslFor(url) });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}

async function dropQuietly(adminUrl, dbName, role) {
  await withClient(adminUrl, async (c) => {
    await c.query(`DROP DATABASE IF EXISTS ${quoteIdent(dbName)} WITH (FORCE)`);
    await c.query(`DROP ROLE IF EXISTS ${quoteIdent(role)}`);
  });
}

async function createRoleAndDatabase(adminUrl, dbName, role, password) {
  if (!/^[0-9a-f]{48}$/.test(password)) throw new Error('unexpected password shape');
  await withClient(adminUrl, async (c) => {
    // The password is generated here as hex, never user input; DDL cannot take bind parameters.
    await c.query(`CREATE ROLE ${quoteIdent(role)} LOGIN PASSWORD '${password}'`);
    await c.query(`GRANT ${quoteIdent(role)} TO CURRENT_USER`);
    await c.query(`CREATE DATABASE ${quoteIdent(dbName)} OWNER ${quoteIdent(role)}`);
    await c.query(`REVOKE ALL ON DATABASE ${quoteIdent(dbName)} FROM PUBLIC`);
  });
}

async function seedFirstAdmin(client, admin) {
  const email = admin.email || `${admin.shikhonUserId}@shikhon.invalid`;
  const name = admin.name || 'College Administrator';
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || 'CA';
  await client.query(
    `INSERT INTO users (email, full_name, initials, role, role_label, department, shikhon_user_id)
     VALUES ($1,$2,$3,'super_admin','Super Admin','Administration',$4)`,
    [email, name, initials, admin.shikhonUserId]);
}

async function provisionCollege({ control, adminUrl, tenantKey, tenantId, displayName, firstAdmin }) {
  const name = String(displayName || '').trim().slice(0, 120) || 'My College';
  const row = await colleges.insertPending(control, { tenantId, slug: slugFor(tenantId, name), displayName: name });
  const claimed = await colleges.claimForProvisioning(control, row.id);
  if (!claimed) {
    const current = await colleges.findById(control, row.id);
    return current.status === 'active' ? { state: 'active', college: current } : { state: 'in_progress' };
  }

  const dbName = `alumni_${claimed.slug}`;
  const role = dbName;
  const password = crypto.randomBytes(24).toString('hex');
  try {
    await dropQuietly(adminUrl, dbName, role); // clears a half-built attempt from a crashed run
    await createRoleAndDatabase(adminUrl, dbName, role, password);
    const version = await withClient(tenantUrl(adminUrl, dbName, role, password), async (c) => {
      await applyMigrations(c);
      await seedFirstAdmin(c, firstAdmin);
      return currentVersion(c);
    });
    const college = await colleges.markActive(control, claimed.id, {
      dbName, dbRole: role, credentialSealed: seal(password, tenantKey), schemaVersion: version
    });
    return { state: 'active', college };
  } catch (err) {
    try { await dropQuietly(adminUrl, dbName, role); } catch (cleanupErr) {
      console.error('[provisioner] cleanup failed for', dbName, cleanupErr.message);
    }
    await colleges.markFailed(control, claimed.id, err.message);
    throw err;
  }
}

module.exports = { slugFor, tenantUrl, provisionCollege };
```

- [ ] **Step 5: Implement `tenancy/pool-registry.js`**

```js
const { Pool } = require('pg');
const { sslFor } = require('../lib/pg-ssl');
const { open } = require('./secret-box');
const { tenantUrl } = require('./provisioner');

/* One pool per college, created on first use. The map is capped: when it is
   full the least recently used pool is closed, so a hundred colleges cannot
   hold a hundred idle connection sets. */
function createPoolRegistry({ adminUrl, tenantKey, max = 50, poolSize = 5 }) {
  const pools = new Map(); // college.id -> { pool, version }

  function build(college) {
    const password = open(college.db_credential_enc, tenantKey);
    const url = tenantUrl(adminUrl, college.db_name, college.db_role, password);
    const pool = new Pool({ connectionString: url, ssl: sslFor(url), max: poolSize,
                            idleTimeoutMillis: 10000, connectionTimeoutMillis: 5000 });
    pool.on('error', (err) => console.error('[pool]', college.slug, err.message));
    return pool;
  }

  function poolFor(college) {
    const version = new Date(college.updated_at).getTime();
    const hit = pools.get(college.id);
    if (hit && hit.version === version) {
      pools.delete(college.id); pools.set(college.id, hit); // refresh recency
      return hit.pool;
    }
    if (hit) { hit.pool.end().catch(() => {}); pools.delete(college.id); }
    if (pools.size >= max) {
      const [oldestId, oldest] = pools.entries().next().value;
      pools.delete(oldestId);
      oldest.pool.end().catch(() => {});
    }
    const pool = build(college);
    pools.set(college.id, { pool, version });
    return pool;
  }

  async function closeAll() {
    await Promise.all([...pools.values()].map((e) => e.pool.end().catch(() => {})));
    pools.clear();
  }

  return { poolFor, closeAll, size: () => pools.size };
}

module.exports = { createPoolRegistry };
```

- [ ] **Step 6: Run the test**

Run: `node --test tests/provisioner.test.js` — Expected: all passing. If the isolation test cannot tell "permission denied" from another connect failure on your Postgres, keep the regex but confirm in the failure output that the rejection comes from the *server*, not a refused TCP connection.

- [ ] **Step 7: Commit**

```bash
git add migrations/0010_shikhon_user.sql tenancy/provisioner.js tenancy/pool-registry.js tests/provisioner.test.js
git commit -m "feat: provision one isolated database per college on demand" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 13: Tenant-aware database facade, session module, tenancy middleware

**Files:**
- Create: `auth/session.js`, `tenancy/middleware.js`, `tenancy/bootstrap.js`
- Modify: `db.js`, `server.js` (session functions near the top; mount order before `attachUser`; health route; password routes)
- Test: `tests/tenant-scope.test.js`

**Interfaces:**
- Produces (`db.js`): `db.withTenant({ pool, college }, fn)`, `db.currentTenant() -> { pool, college } | undefined`; `db.pool` stays an object with `query` and `connect`, now resolved per call.
- Produces (`auth/session.js`): `SESSION_SECRET`, `SESSION_TTL_MS`, `signToken(payload)`, `verifyToken(token)`, `readToken(req)`, moved verbatim from `server.js`.
- Produces (`middleware.js`): `createTenancyMiddleware({ findCollege, registry }) -> express middleware` (with `.invalidate(id)`) that reads the session token, loads the college named by its `tid` claim, and runs the rest of the request inside `db.withTenant`.
- Behaviour: when `MULTI_TENANT=1` a query outside a tenant scope throws instead of falling back to a default pool.

- [ ] **Step 1: Write the failing facade test**

`tests/tenant-scope.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-session-secret';
function freshDb() {
  delete require.cache[require.resolve('../db')];
  return require('../db');
}
const fakePool = (label) => ({ query: async () => ({ rows: [{ label }] }), connect: async () => ({ label, release() {} }) });

test('queries go to the pool of the current tenant scope', async () => {
  process.env.MULTI_TENANT = '1';
  const db = freshDb();
  const a = await db.withTenant({ pool: fakePool('A') }, () => db.query('select 1'));
  const b = await db.withTenant({ pool: fakePool('B') }, () => db.query('select 1'));
  assert.equal(a.rows[0].label, 'A');
  assert.equal(b.rows[0].label, 'B');
});

test('concurrent scopes do not leak into each other', async () => {
  process.env.MULTI_TENANT = '1';
  const db = freshDb();
  const run = (label, delay) => db.withTenant({ pool: fakePool(label) }, async () => {
    await new Promise((r) => setTimeout(r, delay));
    return (await db.query('select 1')).rows[0].label;
  });
  assert.deepEqual(await Promise.all([run('A', 30), run('B', 5), run('C', 15)]), ['A', 'B', 'C']);
});

test('db.pool.connect resolves per call as well', async () => {
  process.env.MULTI_TENANT = '1';
  const db = freshDb();
  const c = await db.withTenant({ pool: fakePool('A') }, () => db.pool.connect());
  assert.equal(c.label, 'A');
});

test('multi-tenant mode refuses a query with no tenant in scope', async () => {
  process.env.MULTI_TENANT = '1';
  const db = freshDb();
  await assert.rejects(db.query('select 1'), /No tenant in scope/);
  await assert.rejects(db.pool.connect(), /No tenant in scope/);
});
```

- [ ] **Step 2: Run it to verify it fails, then rewrite the export of `db.js`**

Run: `node --test tests/tenant-scope.test.js` — Expected: FAIL (`db.withTenant is not a function`).

In `db.js`, add near the top `const { AsyncLocalStorage } = require('node:async_hooks'); const tenantStore = new AsyncLocalStorage();` and replace the final `module.exports` with:

```js
function currentPool() {
  const scope = tenantStore.getStore();
  if (scope) return scope.pool;
  if (process.env.MULTI_TENANT === '1') {
    throw new Error('No tenant in scope: refusing to use a database pool');
  }
  if (!pool) throw new Error('Database pool unavailable');
  return pool;
}

// `pool` is a facade: every call resolves the current college's pool, so the
// existing `db.query(...)` and `db.pool.connect()` call sites need no change.
const poolFacade = {
  query: (text, params) => currentPool().query(text, params),
  connect: () => currentPool().connect()
};

module.exports = {
  query: async (text, params) => currentPool().query(text, params),
  pool: poolFacade,
  withTenant: (scope, fn) => tenantStore.run(scope, fn),
  currentTenant: () => tenantStore.getStore(),
  initDbSchemaAndSeed,
  end: () => (pool ? pool.end() : Promise.resolve()),
  isCloud: !!connectionString || process.env.PGSSL === 'true'
};
```

Inside `initDbSchemaAndSeed` replace uses of the module-level `pool` with `currentPool()`.

Run: `node --test tests/tenant-scope.test.js` — Expected: 4 passing.

- [ ] **Step 3: Move the session functions out of `server.js`**

Create `auth/session.js` containing, copied verbatim from `server.js`, the definitions of `SESSION_SECRET` (with its ephemeral-secret warning), `SESSION_TTL_MS`, `signToken`, `verifyToken` and `readToken`, plus `module.exports = { SESSION_SECRET, SESSION_TTL_MS, signToken, verifyToken, readToken };`. In `server.js` delete those definitions and add `const { SESSION_SECRET, SESSION_TTL_MS, signToken, verifyToken, readToken } = require('./auth/session');`. `hashPassword`/`verifyPassword` stay in `server.js`.

Run `npm test`. Expected: every earlier test still passes (this is a pure move).

- [ ] **Step 4: Write the failing middleware test**

Append to `tests/tenant-scope.test.js`:

```js
const { createTenancyMiddleware } = require('../tenancy/middleware');
const { signToken } = require('../auth/session');

const college = (over = {}) => ({ id: 7, slug: 'c7', status: 'active', updated_at: new Date(), ...over });
function run(mw, headers = {}, method = 'GET') {
  const req = { method, headers, path: '/api/anything' };
  let status = null, body = null;
  const res = { status(c) { status = c; return this; }, json(b) { body = b; return this; } };
  return new Promise((resolve) => {
    const db = require('../db');
    mw(req, res, () => resolve({ proceeded: true, scope: db.currentTenant(), req }));
    setTimeout(() => resolve({ proceeded: false, status, body }), 50);
  });
}
const tokenFor = (extra) => signToken({ uid: 1, role: 'alumni', exp: Date.now() + 60000, ...extra });

test('a valid token opens a scope for its college', async () => {
  process.env.MULTI_TENANT = '1';
  const mw = createTenancyMiddleware({ findCollege: async (id) => (id === 7 ? college() : null), registry: { poolFor: () => fakePool('C7') } });
  const out = await run(mw, { authorization: `Bearer ${tokenFor({ tid: 7 })}` });
  assert.equal(out.proceeded, true);
  assert.equal(out.scope.college.id, 7);
});

test('a token for an unknown college is rejected with 401', async () => {
  const mw = createTenancyMiddleware({ findCollege: async () => null, registry: { poolFor: () => fakePool('x') } });
  assert.equal((await run(mw, { authorization: `Bearer ${tokenFor({ tid: 99 })}` })).status, 401);
});

test('a token with no college claim never gets a scope', async () => {
  const mw = createTenancyMiddleware({ findCollege: async () => college(), registry: { poolFor: () => fakePool('x') } });
  const out = await run(mw, { authorization: `Bearer ${tokenFor({})}` });
  assert.equal(out.proceeded, true);
  assert.equal(out.scope, undefined);
});

test('a suspended college is read-only', async () => {
  const mw = createTenancyMiddleware({ findCollege: async () => college({ status: 'suspended' }), registry: { poolFor: () => fakePool('x') } });
  const headers = { authorization: `Bearer ${tokenFor({ tid: 7 })}` };
  assert.equal((await run(mw, headers, 'GET')).proceeded, true);
  assert.equal((await run(mw, headers, 'POST')).status, 403);
});

test('an unreachable college database answers 503 for that request only', async () => {
  const mw = createTenancyMiddleware({ findCollege: async () => college(),
    registry: { poolFor: () => { throw new Error('boom'); } } });
  assert.equal((await run(mw, { authorization: `Bearer ${tokenFor({ tid: 7 })}` })).status, 503);
});
```

Run: `node --test tests/tenant-scope.test.js` — Expected: FAIL, `Cannot find module '../tenancy/middleware'`.

- [ ] **Step 5: Implement `tenancy/middleware.js`**

```js
const db = require('../db');
const { verifyToken, readToken } = require('../auth/session');

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CACHE_MS = 30 * 1000;

/* Opens the per-request database scope. The college comes ONLY from the `tid`
   claim of the signed session token: never from a URL, header or body.
   Requests without a token proceed with no scope (login, branding defaults,
   static pages); any query they attempt fails closed in db.js. */
function createTenancyMiddleware({ findCollege, registry }) {
  const cache = new Map(); // id -> { college, at }

  async function lookup(id) {
    const hit = cache.get(id);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.college;
    const college = await findCollege(id);
    if (college) cache.set(id, { college, at: Date.now() });
    return college;
  }

  const middleware = async (req, res, next) => {
    const payload = verifyToken(readToken(req));
    if (!payload || payload.tid === undefined) return next();

    let college;
    try { college = await lookup(payload.tid); } catch (err) {
      console.error('[tenancy] control lookup failed:', err.message);
      return res.status(503).json({ error: 'The alumni service is temporarily unavailable.' });
    }
    if (!college || !['active', 'suspended'].includes(college.status)) {
      return res.status(401).json({ error: 'This session has ended. Please sign in again.' });
    }
    if (college.status === 'suspended' && WRITE_METHODS.has(req.method)) {
      return res.status(403).json({ error: 'This college\'s alumni space is read-only right now.' });
    }

    let pool;
    try { pool = registry.poolFor(college); } catch (err) {
      console.error('[tenancy] pool unavailable for', college.slug, err.message);
      return res.status(503).json({ error: 'This college\'s alumni space is temporarily unavailable.' });
    }
    req.college = college;
    db.withTenant({ pool, college }, () => next());
  };
  middleware.invalidate = (id) => cache.delete(id);
  return middleware;
}

module.exports = { createTenancyMiddleware };
```

Run: `node --test tests/tenant-scope.test.js` — Expected: 9 passing.

- [ ] **Step 6: Bootstrap, mount, and retire the password routes in multi-tenant mode**

Create `tenancy/bootstrap.js`:

```js
const { Pool } = require('pg');
const { sslFor } = require('../lib/pg-ssl');
const { loadTenancyConfig } = require('./config');
const { createPoolRegistry } = require('./pool-registry');
const { createTenancyMiddleware } = require('./middleware');
const colleges = require('./colleges');

function bootstrapTenancy() {
  const config = loadTenancyConfig();
  const control = new Pool({ connectionString: config.controlUrl, ssl: sslFor(config.controlUrl), max: 5 });
  control.on('error', (err) => console.error('[control]', err.message));
  const registry = createPoolRegistry({ adminUrl: config.provisionerUrl, tenantKey: config.tenantKey, max: config.maxTenantPools });
  const middleware = createTenancyMiddleware({ findCollege: (id) => colleges.findById(control, id), registry });
  const deps = { control, adminUrl: config.provisionerUrl, tenantKey: config.tenantKey, registry };
  return { config, control, registry, middleware, deps };
}

module.exports = { bootstrapTenancy };
```

In `server.js`, immediately before `app.use(attachUser);` add:

```js
let tenancy = null;
if (process.env.MULTI_TENANT === '1') {
  tenancy = require('./tenancy/bootstrap').bootstrapTenancy();
  app.use(tenancy.middleware);
}
```

Before the existing auth routes, add:

```js
// Alumni never have passwords in multi-college mode: Shikhon ID is the only way in.
if (process.env.MULTI_TENANT === '1') {
  app.all(/^\/api\/auth\/(login|register|change-password|forgot-password|reset-password)$/, (req, res) =>
    res.status(410).json({ error: 'Sign in with Shikhon ID.' }));
}
```

Then run `grep -n "app\.\(get\|post\|put\|delete\)('/api/auth/" server.js routes_*.js` and add any other password-related route it lists to that pattern. Change `GET /api/health` to report the control database when `MULTI_TENANT=1` (it queries `users`, which has no scope there): in multi-tenant mode run `SELECT now()` against `tenancy.control` instead.

- [ ] **Step 7: Commit**

```bash
git add db.js auth/session.js tenancy/middleware.js tenancy/bootstrap.js server.js tests/tenant-scope.test.js
git commit -m "feat: resolve the database per request from the verified session's college" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 14: Shikhon ID sign-in, first open and account linking

**Files:**
- Create: `tests/helpers/mock-shikhon.js`, `tests/helpers/tenant-fixture.js`, `auth/shikhon-oidc.js`, `auth/sign-in.js`
- Modify: `package.json` (add `jose`), `server.js` (mount routes)
- Test: `tests/sign-in.test.js`, `tests/oidc-flow.test.js`

**Interfaces:**
- Consumes: `readIdentity` (Task 1), `provisionCollege`, `colleges`, `registry`, `signToken` (Tasks 11–13).
- Produces: `completeSignIn(identity, deps) -> { token } | { error: 'no_college' | 'not_activated' | 'provisioning' | 'unavailable' | 'suspended_user' }`.
- Produces: `resolveUser(q, identity) -> { id, role, status, token_version }` (find by Shikhon ID; else link an unlinked imported account by *verified* email; else create an `alumni` account).
- Routes: `GET /api/auth/oidc/login`, `GET /api/auth/oidc/callback`, `GET /api/config` → `{ multiTenant, signInUrl }`.
- The browser lands on `/#session=<token>` after success and `/?auth_error=<code>` otherwise.

- [ ] **Step 1: Add `jose`**

```bash
npm view jose time --json | tail -8
npm install --save-exact jose@<newest 5.x release that is older than two weeks>
```

Check the API against current docs (Context7: `jose` `createRemoteJWKSet`, `jwtVerify`, `SignJWT`, `generateKeyPair`, `exportJWK`) before using it.

- [ ] **Step 2: Write the mock Shikhon ID provider**

`tests/helpers/mock-shikhon.js`:

```js
const http = require('http');
const crypto = require('crypto');
const { generateKeyPair, exportJWK, SignJWT } = require('jose');

/* A local stand-in for Shikhon ID: discovery, JWKS, an authorize endpoint that
   auto-approves the identity named in login_hint, and a token endpoint that
   checks PKCE and client credentials. */
async function startMockShikhon({ clientId = 'alumni-app', clientSecret = 'alumni-secret', audience } = {}) {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const identities = new Map(); // key -> claims
  const codes = new Map();      // code -> { claims, nonce, challenge, redirectUri }
  let issuer;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, issuer);
    const send = (code, body, headers = {}) => {
      res.writeHead(code, { 'content-type': 'application/json', ...headers });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };

    if (url.pathname === '/.well-known/openid-configuration') {
      return send(200, { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` });
    }
    if (url.pathname === '/jwks') return send(200, { keys: [jwk] });

    if (url.pathname === '/authorize') {
      const claims = identities.get(url.searchParams.get('login_hint'));
      if (!claims) return send(400, { error: 'unknown identity' });
      const code = crypto.randomBytes(12).toString('hex');
      codes.set(code, { claims, nonce: url.searchParams.get('nonce'), challenge: url.searchParams.get('code_challenge'), redirectUri: url.searchParams.get('redirect_uri') });
      const back = new URL(url.searchParams.get('redirect_uri'));
      back.searchParams.set('code', code);
      back.searchParams.set('state', url.searchParams.get('state'));
      return send(302, '', { location: back.toString() });
    }

    if (url.pathname === '/token' && req.method === 'POST') {
      let raw = ''; for await (const d of req) raw += d;
      const form = new URLSearchParams(raw);
      const entry = codes.get(form.get('code'));
      const okClient = form.get('client_id') === clientId && form.get('client_secret') === clientSecret;
      const challenge = crypto.createHash('sha256').update(form.get('code_verifier') || '').digest('base64url');
      if (!entry || !okClient || challenge !== entry.challenge || form.get('redirect_uri') !== entry.redirectUri) {
        return send(400, { error: 'invalid_grant' });
      }
      codes.delete(form.get('code'));
      const idToken = await new SignJWT({ ...entry.claims, nonce: entry.nonce })
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer(issuer).setAudience(audience || clientId).setIssuedAt().setExpirationTime('5m').sign(privateKey);
      return send(200, { id_token: idToken, access_token: 'unused', token_type: 'Bearer' });
    }
    send(404, { error: 'not found' });
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  issuer = `http://127.0.0.1:${server.address().port}`;
  return {
    issuer, clientId, clientSecret,
    setIdentity: (key, claims) => identities.set(key, claims),
    stop: () => new Promise((r) => server.close(r))
  };
}

module.exports = { startMockShikhon };
```

- [ ] **Step 3: Write the failing `completeSignIn` tests**

`tests/sign-in.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { Pool } = require('pg');
const { createTempDb, ADMIN_URL, adminQuery } = require('./helpers/pg');
const { applyMigrationsToUrl } = require('../tenancy/migrations');
const colleges = require('../tenancy/colleges');
const { createPoolRegistry } = require('../tenancy/pool-registry');
const { completeSignIn } = require('../auth/sign-in');
const { verifyToken } = require('../auth/session');
const db = require('../db');

process.env.SESSION_SECRET = 'test-session-secret';
process.env.MULTI_TENANT = '1';
const KEY = 'ab'.repeat(32);
let control, pool, registry, deps;
const made = [];

test.before(async () => {
  control = await createTempDb('alumni_control_test');
  await applyMigrationsToUrl(control.url, path.join(__dirname, '..', 'control_migrations'));
  pool = new Pool({ connectionString: control.url });
  registry = createPoolRegistry({ adminUrl: ADMIN_URL, tenantKey: KEY });
  deps = { control: pool, adminUrl: ADMIN_URL, tenantKey: KEY, registry };
});
test.after(async () => {
  await registry.closeAll();
  for (const c of made) {
    await adminQuery(`DROP DATABASE IF EXISTS "${c.db_name}" WITH (FORCE)`);
    await adminQuery(`DROP ROLE IF EXISTS "${c.db_role}"`);
  }
  await pool.end();
  await control.drop();
});

const identity = (over = {}) => ({
  shikhonUserId: 'u-1', email: 'x@college.edu', emailVerified: true, name: 'X Person',
  tenantId: 't-main', tenantName: 'Main College', isCollegeAdmin: false, ...over
});
const adminIdentity = (over = {}) => identity({ shikhonUserId: 'admin-1', email: 'dean@college.edu', isCollegeAdmin: true, ...over });
const inTenant = (college, fn) => db.withTenant({ pool: registry.poolFor(college), college }, fn);

test('a non-admin opening an unactivated college is told to ask their admin', async () => {
  assert.deepEqual(await completeSignIn(identity({ tenantId: 't-none' }), deps), { error: 'not_activated' });
  assert.equal(await colleges.findByTenantId(pool, 't-none'), null);
});

test('the college admin\'s first open provisions the college and signs them in as its first admin', async () => {
  const out = await completeSignIn(adminIdentity(), deps);
  const college = await colleges.findByTenantId(pool, 't-main');
  made.push(college);
  assert.equal(college.status, 'active');
  assert.equal(college.display_name, 'Main College');
  const claims = verifyToken(out.token);
  assert.equal(claims.tid, college.id);
  assert.equal(claims.role, 'super_admin');
});

test('a later sign-in by the same person reuses the account', async () => {
  const a = verifyToken((await completeSignIn(adminIdentity(), deps)).token);
  const b = verifyToken((await completeSignIn(adminIdentity(), deps)).token);
  assert.equal(a.uid, b.uid);
});

test('an unknown Shikhon user in an active college gets an alumni account', async () => {
  const claims = verifyToken((await completeSignIn(identity({ shikhonUserId: 'new-1', email: 'new@college.edu' }), deps)).token);
  assert.equal(claims.role, 'alumni');
});

test('an imported account is linked by a verified email', async () => {
  const college = await colleges.findByTenantId(pool, 't-main');
  await inTenant(college, () => db.query(
    `INSERT INTO users (email, full_name, initials, role, role_label, department) VALUES ('imported@college.edu','Imp Orted','IO','alumni','Alumni','CSE')`));
  const claims = verifyToken((await completeSignIn(identity({ shikhonUserId: 'imp-1', email: 'imported@college.edu' }), deps)).token);
  const row = await inTenant(college, async () => (await db.query('SELECT shikhon_user_id FROM users WHERE id=$1', [claims.uid])).rows[0]);
  assert.equal(row.shikhon_user_id, 'imp-1');
});

test('an unverified email never links to, or collides with, an imported account', async () => {
  const college = await colleges.findByTenantId(pool, 't-main');
  const imported = await inTenant(college, async () => (await db.query(
    `INSERT INTO users (email, full_name, initials, role, role_label, department) VALUES ('victim@college.edu','Vic Tim','VT','alumni','Alumni','CSE') RETURNING id`)).rows[0]);
  const out = await completeSignIn(identity({ shikhonUserId: 'attacker-1', email: 'victim@college.edu', emailVerified: false }), deps);
  const claims = verifyToken(out.token);
  assert.notEqual(claims.uid, imported.id);
  const linked = await inTenant(college, async () => (await db.query('SELECT shikhon_user_id FROM users WHERE id=$1', [imported.id])).rows[0]);
  assert.equal(linked.shikhon_user_id, null);
});

test('a suspended user is refused', async () => {
  const college = await colleges.findByTenantId(pool, 't-main');
  await inTenant(college, () => db.query(`UPDATE users SET status='suspended' WHERE shikhon_user_id='new-1'`));
  assert.deepEqual(await completeSignIn(identity({ shikhonUserId: 'new-1', email: 'new@college.edu' }), deps), { error: 'suspended_user' });
});

test('a token with no college is refused', async () => {
  assert.deepEqual(await completeSignIn(identity({ tenantId: '' }), deps), { error: 'no_college' });
});
```

Run: `node --test tests/sign-in.test.js` — Expected: FAIL, module not found.

- [ ] **Step 4: Implement `auth/sign-in.js`**

```js
const db = require('../db');
const colleges = require('../tenancy/colleges');
const { provisionCollege } = require('../tenancy/provisioner');
const { signToken, SESSION_TTL_MS } = require('./session');

const USER_COLUMNS = 'id, role, status, token_version';
const initialsOf = (name) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || 'A';

/* 1. Already linked → that account.
   2. An imported account with the same email, and only when Shikhon says the
      email is verified → link it.
   3. Otherwise a new alumni account. An unverified email is never stored, so it
      cannot collide with (or claim) someone else's imported account. */
async function resolveUser(q, identity) {
  let r = await q(`SELECT ${USER_COLUMNS} FROM users WHERE shikhon_user_id = $1`, [identity.shikhonUserId]);
  if (r.rows[0]) return r.rows[0];

  if (identity.emailVerified && identity.email) {
    r = await q(
      `UPDATE users SET shikhon_user_id = $1
        WHERE id = (SELECT id FROM users WHERE LOWER(email) = $2 AND shikhon_user_id IS NULL ORDER BY id LIMIT 1)
        RETURNING ${USER_COLUMNS}`, [identity.shikhonUserId, identity.email]);
    if (r.rows[0]) return r.rows[0];
  }

  const email = identity.emailVerified && identity.email ? identity.email : `${identity.shikhonUserId}@shikhon.invalid`;
  const name = identity.name || 'Alumnus';
  r = await q(
    `INSERT INTO users (email, full_name, initials, role, role_label, department, shikhon_user_id)
     VALUES ($1,$2,$3,'alumni','Alumni','Unassigned',$4)
     ON CONFLICT (shikhon_user_id) WHERE shikhon_user_id IS NOT NULL DO UPDATE SET shikhon_user_id = EXCLUDED.shikhon_user_id
     RETURNING ${USER_COLUMNS}`, [email, name, initialsOf(name), identity.shikhonUserId]);
  return r.rows[0];
}

async function completeSignIn(identity, { control, adminUrl, tenantKey, registry }) {
  if (!identity.tenantId) return { error: 'no_college' };

  let college = await colleges.findByTenantId(control, identity.tenantId);
  const needsSetup = !college || ['pending', 'failed'].includes(college.status);
  if (needsSetup) {
    if (!identity.isCollegeAdmin) return { error: 'not_activated' };
    const r = await provisionCollege({
      control, adminUrl, tenantKey, tenantId: identity.tenantId, displayName: identity.tenantName,
      firstAdmin: { shikhonUserId: identity.shikhonUserId, email: identity.email, name: identity.name }
    });
    if (r.state === 'in_progress') return { error: 'provisioning' };
    college = r.college;
  }
  if (college.status === 'provisioning') return { error: 'provisioning' };
  if (!['active', 'suspended'].includes(college.status)) return { error: 'unavailable' };

  const pool = registry.poolFor(college);
  const user = await db.withTenant({ pool, college }, () => resolveUser((t, p) => db.query(t, p), identity));
  if (user.status === 'suspended') return { error: 'suspended_user' };

  const token = signToken({ uid: user.id, role: user.role, tv: user.token_version, tid: college.id, exp: Date.now() + SESSION_TTL_MS });
  return { token };
}

module.exports = { completeSignIn, resolveUser };
```

Run: `node --test tests/sign-in.test.js` — Expected: all passing. If `status`/`token_version` are not columns of `users` at this point, they come from migrations `0006`/`0008`; if Postgres rejects the `ON CONFLICT ... WHERE` clause, use `ON CONFLICT DO NOTHING` followed by a re-select.

- [ ] **Step 5: Write the shared fixture and the failing HTTP-flow test**

`tests/helpers/tenant-fixture.js` exports `startTenantApp({ identities })`: creates the control database (migrated with `control_migrations`), starts `startMockShikhon`, sets `MULTI_TENANT=1`, `CONTROL_DATABASE_URL`, `PROVISIONER_DATABASE_URL=ADMIN_URL`, `TENANT_KEY`, `SESSION_SECRET`, `SHIKHON_ISSUER`, `SHIKHON_CLIENT_ID`, `SHIKHON_CLIENT_SECRET`, `SHIKHON_REDIRECT_URI=<base>/api/auth/oidc/callback`, requires `server.js`, listens on port 0, and returns `{ base, mock, control, registry, signIn(identityKey) -> token, stop() }` where `signIn` runs the full browser flow (login → authorize → callback) and returns the token from the `#session=` fragment; `stop()` closes everything and drops every database the fixture created (read from the `colleges` table).

`tests/oidc-flow.test.js` then asserts, each as its own test using `fetch(..., { redirect: 'manual' })`:

1. `GET /api/auth/oidc/login` → 302 to the mock's `/authorize` with `state`, `nonce`, `code_challenge`, `code_challenge_method=S256`, `redirect_uri`; response sets an `HttpOnly` cookie named `oidc_tx`.
2. Following `/authorize` (with `login_hint` of an admin identity) and then `GET /api/auth/oidc/callback` with that cookie → 302 to `/#session=<token>`; the token verifies and carries `tid`.
3. Callback with a wrong `state` → 302 to `/?auth_error=state`.
4. Callback without the cookie → 302 to `/?auth_error=state`.
5. An id_token with the wrong audience (mock started with `audience: 'someone-else'`) → `/?auth_error=token`.
6. A non-admin of an unactivated college → `/?auth_error=not_activated`.
7. `GET /api/config` → `{ multiTenant: true, signInUrl: '/api/auth/oidc/login' }`.
8. The token from test 2 on `GET /api/auth/me` returns that user (proves the middleware, scope and attachUser agree).
9. `POST /api/auth/login` → 410 in multi-tenant mode.

Run: `node --test tests/oidc-flow.test.js` — Expected: FAIL (routes missing).

- [ ] **Step 6: Implement `auth/shikhon-oidc.js`**

```js
const crypto = require('crypto');
const { createRemoteJWKSet, jwtVerify } = require('jose');
const { signToken, verifyToken } = require('./session');
const { readIdentity, IdentityError } = require('./claims');
const { completeSignIn } = require('./sign-in');

const TX_COOKIE = 'oidc_tx';
const TX_TTL_MS = 10 * 60 * 1000;

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((p) => p.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, v.join('=')]));
}
const b64 = (buf) => buf.toString('base64url');

function mountShikhonOidc(app, { issuer, clientId, clientSecret, redirectUri, deps }) {
  let discovery = null;
  let jwks = null;
  async function discover() {
    if (!discovery) {
      const r = await fetch(`${issuer}/.well-known/openid-configuration`);
      if (!r.ok) throw new Error(`discovery failed: ${r.status}`);
      discovery = await r.json();
      jwks = createRemoteJWKSet(new URL(discovery.jwks_uri));
    }
    return discovery;
  }
  const secure = redirectUri.startsWith('https://');
  const cookie = (value, maxAgeS) =>
    `${TX_COOKIE}=${value}; Path=/api/auth/oidc; HttpOnly; SameSite=Lax; Max-Age=${maxAgeS}${secure ? '; Secure' : ''}`;
  const fail = (res, code) => { res.append('Set-Cookie', cookie('', 0)); res.redirect(302, `/?auth_error=${code}`); };

  app.get('/api/config', (req, res) =>
    res.json({ multiTenant: true, signInUrl: '/api/auth/oidc/login' }));

  app.get('/api/auth/oidc/login', async (req, res) => {
    try {
      const meta = await discover();
      const state = b64(crypto.randomBytes(16));
      const nonce = b64(crypto.randomBytes(16));
      const verifier = b64(crypto.randomBytes(32));
      const challenge = b64(crypto.createHash('sha256').update(verifier).digest());
      const tx = signToken({ state, nonce, verifier, exp: Date.now() + TX_TTL_MS });
      const url = new URL(meta.authorization_endpoint);
      for (const [k, v] of Object.entries({
        response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope: 'openid email profile',
        state, nonce, code_challenge: challenge, code_challenge_method: 'S256',
        ...(req.query.login_hint ? { login_hint: String(req.query.login_hint) } : {})
      })) url.searchParams.set(k, v);
      res.append('Set-Cookie', cookie(tx, TX_TTL_MS / 1000));
      res.redirect(302, url.toString());
    } catch (err) {
      console.error('[oidc] login failed:', err.message);
      fail(res, 'unavailable');
    }
  });

  app.get('/api/auth/oidc/callback', async (req, res) => {
    const tx = verifyToken(parseCookies(req.headers.cookie)[TX_COOKIE]);
    if (!tx || !req.query.state || req.query.state !== tx.state || !req.query.code) return fail(res, 'state');
    try {
      const meta = await discover();
      const tokenRes = await fetch(meta.token_endpoint, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code: String(req.query.code),
          redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret, code_verifier: tx.verifier })
      });
      if (!tokenRes.ok) return fail(res, 'token');
      const { id_token: idToken } = await tokenRes.json();
      const { payload } = await jwtVerify(idToken, jwks, { issuer: meta.issuer, audience: clientId });
      if (payload.nonce !== tx.nonce) return fail(res, 'token');

      const out = await completeSignIn(readIdentity(payload), deps);
      if (out.error) return fail(res, out.error);
      res.append('Set-Cookie', cookie('', 0));
      res.redirect(302, `/#session=${out.token}`);
    } catch (err) {
      console.error('[oidc] callback failed:', err.message);
      fail(res, err instanceof IdentityError ? 'no_college' : 'token');
    }
  });
}

module.exports = { mountShikhonOidc };
```

- [ ] **Step 7: Wire it in**

In `server.js`, inside the `MULTI_TENANT` block, after `app.use(tenancy.middleware)`:

```js
  require('./auth/shikhon-oidc').mountShikhonOidc(app, {
    issuer: process.env.SHIKHON_ISSUER, clientId: process.env.SHIKHON_CLIENT_ID,
    clientSecret: process.env.SHIKHON_CLIENT_SECRET, redirectUri: process.env.SHIKHON_REDIRECT_URI,
    deps: tenancy.deps
  });
```

Add a startup check that throws when any of the four `SHIKHON_*` variables is missing and `MULTI_TENANT=1`. Add all new variables to `.env.example` with one-line explanations.

- [ ] **Step 8: Run both test files, then commit**

Run: `node --test tests/sign-in.test.js tests/oidc-flow.test.js` — Expected: all passing.

```bash
git add package.json package-lock.json auth server.js .env.example tests/helpers/mock-shikhon.js tests/helpers/tenant-fixture.js tests/sign-in.test.js tests/oidc-flow.test.js
git commit -m "feat: sign in with Shikhon ID, provision on first open, link imported alumni" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 15: Per-college branding API

**Files:**
- Create: `branding/api.js`
- Modify: `server.js` (mount)
- Test: `tests/branding.test.js`

**Interfaces:**
- Produces: `GET /api/branding` → `{ name, initials, logoUrl|null, accent|null, generic: boolean }` (generic Shikhon branding when no college is in scope), `PUT /api/branding` body `{ displayName, accentColor|null }` (roles `super_admin`, `univ_admin`), `POST /api/branding/logo` raw image body (same roles), `GET /branding/logo/:slug` (public, cacheable, college-scoped).
- Limits: logo ≤ 512 KB; PNG, JPEG or WebP only, verified by magic bytes; display name 1–120 chars after trimming.

- [ ] **Step 1: Write the failing test**

`tests/branding.test.js` uses `startTenantApp` (Task 14), signs in the college admin of "Main College" and a plain alumnus, and a second college's admin, then asserts, each as its own test:

1. `GET /api/branding` with no token → `{ generic: true, name: 'Shikhon Alumni' }`.
2. `GET /api/branding` as the college admin → `{ name: 'Main College', initials: 'MC', logoUrl: null, generic: false }`.
3. `PUT /api/branding` `{ displayName: '  New Name  ', accentColor: '#112233' }` as admin → 200, trimmed name returned and persisted.
4. `PUT` with `displayName: ''` → 400; with 121 characters → 400; with `accentColor: 'red'` → 400.
5. `PUT` as a plain alumnus → 403.
6. A display name `<script>alert(1)</script>` is stored and returned verbatim as JSON data.
7. `POST /api/branding/logo` with a real 1×1 PNG and `Content-Type: image/png` → 200; `GET /branding/logo/<slug>` returns 200, `image/png`, the same bytes, `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'`; `GET /api/branding` now has a non-null `logoUrl`.
8. POST a text file labelled `image/png` → 400, and the earlier logo is unchanged (re-GET and compare bytes).
9. POST 0 bytes → 400; POST 600 KB of PNG-prefixed bytes → 413; POST `image/gif` → 415.
10. POST a JPEG labelled `image/png` → 200 and stored as `image/jpeg` (type comes from the bytes, not the header).
11. POST `/api/branding/logo` as a plain alumnus → 403.
12. `GET /branding/logo/<the other college's slug>` never returns this college's logo.
13. `GET /branding/logo/<slug>` for a college with no logo → 404.

Use these byte fixtures: PNG `89 50 4E 47 0D 0A 1A 0A` + padding; JPEG `FF D8 FF E0` + padding; WebP `RIFF` + 4 length bytes + `WEBP`. Run: `node --test tests/branding.test.js` — Expected: FAIL.

- [ ] **Step 2: Implement `branding/api.js`**

```js
const express = require('express');
const colleges = require('../tenancy/colleges');

const MAX_LOGO_BYTES = 512 * 1024;
const NAME_MAX = 120;
const ACCENT = /^#[0-9a-fA-F]{6}$/;
const GENERIC = { name: 'Shikhon Alumni', initials: 'SA', logoUrl: null, accent: null, generic: true };

function sniffImageType(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}
const initialsOf = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || 'A';

function mountBranding(app, { control, invalidate, requireRole, ADMIN_ROLES }) {
  const toPublic = (c, hasLogo) => ({
    name: c.display_name, initials: initialsOf(c.display_name),
    logoUrl: hasLogo ? `/branding/logo/${c.slug}?v=${new Date(c.updated_at).getTime()}` : null,
    accent: c.accent_color, generic: false
  });
  const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
    console.error('[branding]', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Branding is temporarily unavailable.' });
  });

  app.get('/api/branding', wrap(async (req, res) => {
    if (!req.college) return res.json(GENERIC);
    const logo = await colleges.getLogo(control, req.college.id);
    res.json(toPublic(await colleges.findById(control, req.college.id), !!logo));
  }));

  app.put('/api/branding', requireRole(...ADMIN_ROLES), wrap(async (req, res) => {
    const displayName = String(req.body?.displayName ?? '').trim();
    const accent = req.body?.accentColor ?? null;
    if (!displayName || displayName.length > NAME_MAX) return res.status(400).json({ error: `Name must be 1–${NAME_MAX} characters` });
    if (accent !== null && !ACCENT.test(String(accent))) return res.status(400).json({ error: 'Accent colour must look like #1a2b3c' });
    const updated = await colleges.updateBranding(control, req.college.id, { displayName, accentColor: accent });
    invalidate(req.college.id);
    res.json(toPublic(updated, !!(await colleges.getLogo(control, req.college.id))));
  }));

  app.post('/api/branding/logo', requireRole(...ADMIN_ROLES),
    express.raw({ type: () => true, limit: MAX_LOGO_BYTES }),
    wrap(async (req, res) => {
      const declared = String(req.headers['content-type'] || '').split(';')[0].trim();
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(declared)) return res.status(415).json({ error: 'Use a PNG, JPEG or WebP image' });
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (bytes.length === 0) return res.status(400).json({ error: 'The file is empty' });
      const contentType = sniffImageType(bytes);
      if (!contentType) return res.status(400).json({ error: 'That file is not a PNG, JPEG or WebP image' });
      await colleges.setLogo(control, req.college.id, { contentType, bytes });
      const updated = await colleges.updateBranding(control, req.college.id,
        { displayName: req.college.display_name, accentColor: req.college.accent_color });
      invalidate(req.college.id);
      res.json(toPublic(updated, true));
    }));

  // Public by design: an <img> cannot send the session header, and a logo is not secret.
  app.get('/branding/logo/:slug', wrap(async (req, res) => {
    const college = await control.query('SELECT id FROM colleges WHERE slug = $1', [req.params.slug]);
    const logo = college.rows[0] && await colleges.getLogo(control, college.rows[0].id);
    if (!logo) return res.status(404).type('text/plain').send('No logo');
    res.set({ 'Content-Type': logo.content_type, 'X-Content-Type-Options': 'nosniff',
              'Content-Security-Policy': "default-src 'none'", 'Cache-Control': 'public, max-age=300' });
    res.send(logo.bytes);
  }));
}

module.exports = { mountBranding, sniffImageType };
```

An oversize body makes `express.raw` raise a `413` error; confirm the app's error handler returns that status rather than 500, and fix it in `server.js` if not.

- [ ] **Step 3: Mount it**

In `server.js`'s multi-tenant block: `require('./branding/api').mountBranding(app, { control: tenancy.control, invalidate: tenancy.middleware.invalidate, requireRole, ADMIN_ROLES });`. In single-tenant mode `GET /api/branding` must still answer, so mount a fallback before the SPA handler:

```js
if (process.env.MULTI_TENANT !== '1') {
  app.get('/api/branding', (req, res) => res.json({ name: 'Shikhon Alumni', initials: 'SA', logoUrl: null, accent: null, generic: true }));
}
```

- [ ] **Step 4: Run the tests, then commit**

Run: `node --test tests/branding.test.js` — Expected: all passing.

```bash
git add branding server.js tests/branding.test.js
git commit -m "feat: per-college name, logo and accent colour" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 16: Front end shows the college's branding and signs in with Shikhon ID

The visual redesign is a separate spec. This task only removes DIC from the existing screens and swaps the sign-in method, so the redesign starts from a college-neutral base.

**Files:**
- Create: `js/brand.js`, `tests/no-dic-literals.test.js`
- Modify: `index.html`, `admin.html`, `manifest.json`, `js/*.js`, `api.js`, `db.js`, `server.js`, `routes_*.js`
- Remove: `assets/dic-logo.png`, `assets/daffodil-logo.svg`, `dic.png`, `dics.png` (DIC re-uploads its logo through Settings; keep `assets/nimikh-logo.*` only if Step 1 shows it is not DIC's)

**Interfaces:**
- Produces: `Brand.load()`, `Brand.apply(branding)`, `Brand.name` (the current college's display name).
- Markup contract: an element with `data-brand-name` gets the college name as `textContent`; an `<img data-brand-logo>` gets the logo, and when there is none it is replaced by an initials badge; `--brand-accent` is set as a CSS variable when an accent is chosen.
- Sign-in contract: `GET /api/config` is consulted at boot; when `multiTenant` is true the email/password forms are hidden and a **Sign in with Shikhon ID** button goes to `signInUrl`; a `#session=<token>` fragment is stored through the existing `api.js` token store and removed from the address bar; `?auth_error=<code>` shows a message.

- [ ] **Step 1: Inventory every DIC reference**

```bash
grep -rIn "Daffodil\|\bDIC\b\|dic-logo\|daffodil-logo\|dic\.png\|dics\.png\|nimikh" index.html admin.html manifest.json js/*.js api.js styles.css server.js db.js routes_*.js | sort > /tmp/dic-refs.txt
wc -l /tmp/dic-refs.txt
```

Work through the file by category:
1. **Static page text and titles** (`index.html`, `admin.html`, `manifest.json`): replace the visible name with `<span data-brand-name>Shikhon Alumni</span>`; `<title>` and the manifest `name`/`short_name` become `Shikhon Alumni` (`Brand.apply` rewrites the title at runtime).
2. **Logo images:** `<img src="assets/dic-logo.png" …>` → `<img data-brand-logo alt="">`.
3. **Strings inside `js/*.js` templates:** use `Brand.name`, passed through the existing HTML-escape helper (`grep -n "function esc\|escapeHtml" js/*.js api.js` to find it) whenever the string is placed in `innerHTML`.
4. **Server-side strings** (the `'DIC Alumni'` author fallback in `server.js`, notification and audit texts): use `req.college?.display_name || 'Alumni'`. Ticket and receipt prefixes `DIC-TKT`, `DIC-RCPT` → `TKT`, `RCPT`; the fallback ticket HMAC key `'dic-ticket'` → `'alumni-ticket'` (no tickets exist yet in a fresh college, so nothing is invalidated).
5. **Comments and file banners** that say "DIC" (`db.js`, route-file headers): change to "Shikhon Alumni"; the test below counts them.
6. `nimikh` references: open each; if it is another institution's brand baked into a page, treat it as category 1–2; otherwise leave it and add the file to the test's allowlist with a one-line reason.

- [ ] **Step 2: Write the failing lint test**

`tests/no-dic-literals.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILES = ['index.html', 'admin.html', 'manifest.json', 'styles.css', 'api.js', 'server.js', 'db.js',
  ...fs.readdirSync(path.join(ROOT, 'js')).map((f) => `js/${f}`),
  ...fs.readdirSync(ROOT).filter((f) => /^routes_.*\.js$/.test(f))];
const PATTERN = /Daffodil|\bDIC\b|dic-logo|daffodil-logo|\bdics?\.png/;
const ALLOWED = new Map([]); // file -> reason; add only with a justification

test('no served file or server module hardcodes a college', () => {
  const hits = [];
  for (const f of FILES) {
    if (ALLOWED.has(f)) continue;
    fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').forEach((line, i) => {
      if (PATTERN.test(line)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 80)}`);
    });
  }
  assert.deepEqual(hits, []);
});

test('the page loads the branding module before the app scripts', () => {
  for (const page of ['index.html', 'admin.html']) {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    const brandAt = html.indexOf('js/brand.js');
    assert.ok(brandAt > -1, `${page} does not load js/brand.js`);
    assert.ok(brandAt < html.indexOf('js/core.js'), `${page} loads brand.js after core.js`);
  }
});
```

Run: `node --test tests/no-dic-literals.test.js` — Expected: FAIL listing every remaining reference.

- [ ] **Step 3: Write `js/brand.js`**

```js
/* Per-college branding. Everything is written with textContent / attributes:
   a college name is data, never markup. */
const Brand = (() => {
  const GENERIC = { name: 'Shikhon Alumni', initials: 'SA', logoUrl: null, accent: null };
  let current = GENERIC;

  const badge = (initials) => {
    const span = document.createElement('span');
    span.className = 'brand-badge';
    span.setAttribute('data-brand-badge', '');
    span.textContent = initials;
    return span;
  };

  function apply(next) {
    current = { ...GENERIC, ...next };
    document.title = current.name;
    document.querySelectorAll('[data-brand-name]').forEach((el) => { el.textContent = current.name; });
    document.querySelectorAll('[data-brand-logo]').forEach((img) => {
      if (current.logoUrl) { img.src = current.logoUrl; img.alt = current.name; img.hidden = false; }
      else { img.hidden = true; if (!img.nextElementSibling?.hasAttribute('data-brand-badge')) img.after(badge(current.initials)); }
    });
    if (current.logoUrl) document.querySelectorAll('[data-brand-badge]').forEach((b) => b.remove());
    if (current.accent) document.documentElement.style.setProperty('--brand-accent', current.accent);
  }

  async function load() {
    try {
      const token = (typeof getStoredToken === 'function') ? getStoredToken() : null;
      const res = await fetch('/api/branding', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (res.ok) apply(await res.json());
    } catch { /* keep the generic branding */ }
  }

  return { load, apply, get name() { return current.name; }, get current() { return current; } };
})();
```

Use the token accessor `api.js` actually exports (`grep -n "TOKEN_KEY\|function .*[Tt]oken" api.js`); adjust `getStoredToken` to its real name. Add `<script src="js/brand.js">` before `js/core.js` in both pages, and call `Brand.load()` where the app boots and again after sign-in succeeds.

- [ ] **Step 4: Sign-in screen and Settings panel**

In `js/auth.js`: at boot `fetch('/api/config')`; when `multiTenant` is true, hide the email/password form and show a button whose click does `location.href = signInUrl`. On load, if `location.hash` starts with `#session=`, pass the value to the existing token store, call `history.replaceState(null, '', location.pathname + location.search)`, then run the normal "restore session" path (`/api/auth/me`). If `location.search` has `auth_error`, show this message by code and clear the parameter:

| Code | Message |
|---|---|
| `not_activated` | Your college hasn't activated Alumni yet. Ask your college admin to open it once. |
| `provisioning` | Your college's alumni space is being set up. Try again in a minute. |
| `no_college` | Your Shikhon account isn't linked to a college. |
| `suspended_user` | This account is suspended. Contact your college administrator. |
| `state`, `token`, `unavailable` | Sign-in didn't complete. Please try again. |

Apply the same to the admin portal sign-in (check whether it uses `js/auth.js` or `js/admin.js`). Add a **Settings → Branding** panel for admin roles in the admin portal: name field, accent colour input, and a logo file input that `POST`s the raw file with `Content-Type` set to the file's type to `/api/branding/logo`; `PUT /api/branding` for name and colour; on success call `Brand.apply(response)`.

- [ ] **Step 5: Remove the DIC assets, run everything**

```bash
git rm -f assets/dic-logo.png assets/daffodil-logo.svg dic.png dics.png
npm test
```
Expected: all tests pass, including `no-dic-literals`.

- [ ] **Step 6: Check it in a browser**

Add `scripts/dev-multitenant.js`: it starts `startMockShikhon`, a control DB, and the server, registers two identities (a college admin and an alumnus) with the mock, and prints the URL and the `login_hint` values. Open it with the browser tools and confirm: generic "Shikhon Alumni" before sign-in; sign in as the admin of "Main College"; the header shows the name and initials badge; upload a PNG in Settings and the header shows it; set a name containing `<b>x</b>` and confirm it renders as literal text, not bold. Take a screenshot of the header before and after the logo upload.

- [ ] **Step 7: Commit**

```bash
git add -A js index.html admin.html manifest.json api.js server.js db.js routes_*.js assets tests/no-dic-literals.test.js scripts
git commit -m "feat: replace hardcoded DIC branding and passwords with per-college branding and Shikhon ID sign-in" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 17: Cross-tenant isolation test

The proof for spec success criterion 2: nothing from college B reaches a user of college A.

**Files:**
- Test: `tests/isolation.test.js`

- [ ] **Step 1: Write the test**

Use `startTenantApp` to provision two colleges, "Alpha College" and "Beta College", each through its admin's first open. Seed Beta with rows carrying the marker `BETA-SECRET-7731` in places every list route would show: a user's name, an event title and venue, a news story, a campaign, a job post. Seed Alpha with its own marker. Then, each as its own test:

1. **Route sweep.** Enumerate every registered GET route with no path parameter from `app.router.stack` (Express 5), call each with Alpha's admin token, and assert that no response body contains `BETA-SECRET-7731` and none returns 500. Assert the number of routes swept is above a floor (30) so the test cannot pass by sweeping nothing.
2. **Parameter sweep.** For each GET route with one `:id` parameter, call it with the ids of Beta's seeded rows and assert 404 or 403, never 200 with Beta's data.
3. **Database level.** Connect with Alpha's role and credential (decrypted from the control row) to Beta's database name: the connection is rejected. Connect to Alpha's database as Alpha and confirm `SELECT count(*) FROM users` sees only Alpha's users.
4. **Token forgery.** A token signed with a different secret naming Beta's id → 401. Alpha's own token with `tid` rewritten to Beta's id (signature now invalid) → 401.
5. **No scope, no data.** An unauthenticated GET to a data route (e.g. `/api/events`) → 401, and the server's error output shows no `No tenant in scope` 500.
6. **Suspended college.** Set Beta to `suspended`: Beta's admin GET works, POST → 403, and Alpha is unaffected.
7. **Control-database outage.** End the control pool; the next request with a token not in the 30-second cache returns 503 and the process keeps running.

If the sweep finds a route that leaks or errors, that is a real defect: fix the route (most often a query that captured the module-level `db` at require time instead of calling `db.query` per request) and re-run.

- [ ] **Step 2: Run it**

Run: `node --test tests/isolation.test.js` — Expected: all passing.

- [ ] **Step 3: Commit**

```bash
git add tests/isolation.test.js
git commit -m "test: prove one college cannot read another's data" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 18: DIC rollout runbook and environment docs

**Files:**
- Create: `docs/runbooks/dic-cutover.md`
- Modify: `.env.example`, `README.md`
- Gate: do not run the runbook until `docs/shikhon-id-contract.md` shows rows 1–5 and 7 confirmed.

- [ ] **Step 1: Write the runbook**

`docs/runbooks/dic-cutover.md` with these sections, each a numbered checklist with the exact command or screen:

1. **Preconditions:** contract rows confirmed; `alumni_control` created; a Postgres role for `PROVISIONER_DATABASE_URL` with `CREATEDB CREATEROLE` and nothing else; all variables from `.env.example` set; `PAYMENT_WEBHOOK_SECRET` set, or donations understood to be staff-reconciled.
2. **Prepare the control database:** `node -e "require('./tenancy/migrations').applyMigrationsToUrl(process.env.CONTROL_DATABASE_URL, require('path').join(process.cwd(),'control_migrations')).then(console.log)"`.
3. **Deploy** the new app to `alumni.sikhon.systems` (Caddy → Node) with `MULTI_TENANT=1`; keep the old deployment untouched.
4. **First open by DIC's Shikhon admin:** expected outcome (database `alumni_<slug>` exists, they are `super_admin`).
5. **Set DIC's name and logo** in Settings → Branding.
6. **Verify:** sign in as an alumnus; the header shows DIC's name and logo; bulk-import a small test CSV; an imported alumnus signs in with Shikhon ID and is linked.
7. **Cut over:** point the old address at the new deployment; keep the old one running for the agreed period; rollback = point the address back.
8. **After:** run `tests/isolation.test.js` against staging; remove the old deployment.

- [ ] **Step 2: Update `.env.example` and `README.md`**

`.env.example` gets every variable in Global Constraints, each with one line saying what it is and how to generate it. `README.md` gets a short "Running multi-college" section pointing at the runbook, and the `npm test` instructions including the `TEST_PG_ADMIN_URL` requirement.

- [ ] **Step 3: Commit**

```bash
git add docs/runbooks .env.example README.md
git commit -m "docs: DIC cutover runbook and multi-college configuration" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage**

| Spec section | Task |
|---|---|
| 1 success criteria 1, 2, 3, 4 | 14 / 17 / 16 / 18 |
| 3 architecture, new modules | 11, 12, 13, 14, 15 |
| 4 sign-in, first open, lock, non-admin message, linking | 12 (lock, DDL), 14 |
| 5 branding | 15, 16 |
| 6 error handling (token, no college, not activated, provisioning failure, 503, suspended) | 12, 13, 14, 17 |
| 7 testing (unit, isolation, integration, mock Shikhon) | 11–17 |
| 8 DIC rollout | 18 |
| 9 open dependencies | 1 |
| 10 designs | out of scope here, as the spec says |
| Hardening (user-requested, not in the spec) | 4–10 |

**Differences from the spec that this plan introduces (to be written back into the spec):**
1. Before sign-in the college is unknown, so the login screen uses generic "Shikhon Alumni" branding; the college's branding applies after sign-in.
2. Logos are PNG, JPEG or WebP, not SVG: safe SVG sanitising needs a heavy dependency and raster formats cover the need. They are stored in the control database, not on disk.
3. The first Shikhon admin becomes `super_admin` inside their college.
4. The provisioning "lock" is an atomic status update (`pending|failed → provisioning`) with a 10-minute takeover for crashed runs, not a held advisory lock.
5. Database names are `alumni_<readable-prefix>_<6 hex>` so any tenant ID or name is safe.
6. Task 10 changes payment behaviour (donations and paid tickets stay pending in production until a gateway or staff settle them). The owner should confirm this.

**Placeholder scan:** Tasks 14 (HTTP-flow test), 15, 17 and the Task 14 fixture are given as numbered assertion lists with exact inputs and expected results rather than full code, because they reuse the fixture built in Task 14. Each item states its input and its expected outcome; the engineer writes the bodies in the style of the full tests above.

**Type consistency:** `readIdentity` fields (Task 1) match `completeSignIn`/`resolveUser` (Task 14). `colleges.*` signatures (Task 11) match their uses in Tasks 12, 14, 15. `provisionCollege` returns `{ state, college }` consistently. `createPoolRegistry().poolFor(college)` has the same shape in Tasks 12, 13, 14. `signToken` payload fields `uid, role, tv, tid, exp` match `mintToken` in the test helpers and what `attachUser` reads.
