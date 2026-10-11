# Shikhon Alumni: Multi-College Foundation Design

Date: 2026-10-12
Status: Draft for review

## 1. Goal

The alumni system was built for one college, Daffodil International College (DIC). This design makes it a product that any college can use:

- Each college gets its own fresh alumni space with its own database.
- Colleges reach it through the Shikhon edtech ecosystem and sign in with Shikhon ID.
- Each college shows its own name and logo in the dashboard instead of DIC's.

**Success criteria**

1. A college admin opens Alumni from Shikhon and gets a working, empty alumni system for that college with no manual setup.
2. No user of college A can read or write college B's data, even if the app has a bug.
3. Every visible reference to DIC (name, logo, titles, emails) comes from the current college's branding.
4. DIC runs as tenant #1 on the new system.

**Out of scope for this spec:** the visual redesign (see Section 10), migration of the demo data, and moving the code into the Shikhon monorepo (kept possible by clean module seams).

## 2. Decisions already made

| Question | Decision |
|---|---|
| When is a college's database created? | Automatically on first open |
| How do alumni sign in? | Shikhon ID only, no separate passwords |
| How is the college identified? | One address (`alumni.sikhon.systems`); the college comes from the verified Shikhon ID token |
| What happens to DIC data? | DIC becomes tenant #1, fresh; demo data discarded |
| Approach | Evolve the existing Express app, with seams that allow a later move into the monorepo |

## 3. Architecture

```
Browser -> alumni.sikhon.systems (Caddy) -> alumni-system (Express, one process)
             Shikhon ID (OIDC)  <- 1. sign-in; token names the college
             alumni_control DB  <- 2. college -> its database + branding
             alumni_<slug> DBs  <- 3. all alumni data, one database per college
```

- **Shikhon ID** is the only login. The alumni app registers as a new OIDC client. This is a change on the Shikhon platform side and is tracked as a dependency (Section 9).
- **`alumni_control` database** holds one row per college: Shikhon tenant ID, database name, encrypted database credential, schema version, status. It also holds branding: display name, logo reference, optional accent colour.
- **One database per college**, `alumni_<slug>`, with its own database role. A college's role cannot see another college's data.
- **Minimal route churn.** Existing routes call a global `db.query(...)`. This becomes a per-request lookup of the current college's connection pool, so most of the ~90 KB of route code stays unchanged.
- **New modules**, each with one purpose:
  - `auth/shikhon-oidc`: sign-in, token verification, session.
  - `tenancy/resolver`: token claim to college record to pool.
  - `tenancy/provisioner`: creates role and database, applies schema, records version.
  - `tenancy/migrations`: runs pending schema migrations per college.
  - `branding/api`: reads and updates name, logo, colour.

## 4. Sign-in and provisioning

1. A visitor opens `alumni.sikhon.systems` and is redirected to Shikhon ID, then returns with a signed token naming their college.
2. The college is taken **only** from the verified token, never from a URL, header or form field.
3. **First open.** If the college has no database and the user is that college's Shikhon admin, the app:
   - creates the database role and database,
   - applies the schema,
   - records the schema version,
   - names the college from its Shikhon record,
   - makes that admin the first alumni admin.
   A lock prevents two simultaneous opens from provisioning twice: provisioning is claimed with one atomic status update (`pending` or `failed` to `provisioning`), and exactly one caller wins. A claim older than 10 minutes can be taken over, so a crashed run cannot block a college forever. The first Shikhon admin becomes `super_admin` inside their college. Database and role names are `alumni_<readable-prefix>_<6 hex of a hash of the tenant id>`, so any tenant ID or college name yields a safe identifier.
4. If a non-admin opens an unprovisioned college, they see "Ask your college admin to activate Alumni". Only admins can trigger provisioning.
5. Later opens look the college up in `alumni_control` and use its pool.
6. Pending migrations are applied at deploy time, with a check on first access as a backstop.
7. Inside each college database, users are keyed by Shikhon ID. There are no passwords. The existing 5-level roles remain and the college admin assigns them.
8. **Imported alumni.** Bulk import creates unlinked alumni profiles. The first time an alumnus signs in with a Shikhon ID whose verified email matches a profile, the two are linked.

## 5. Branding

- Name, logo and optional accent colour live in `alumni_control`.
- **Defaults.** On first open the name comes from the Shikhon record. The logo is blank until the admin uploads one, and the header shows the name with initials until then.
- **Editing.** A Settings page, admin only: change name, upload logo, pick accent colour.
- **Logo upload.** PNG, JPEG or WebP up to 512 KB, with the type checked from the file's bytes, not its declared type. SVG is not supported in this version: safe sanitising needs a heavy dependency and raster formats cover the need. Logos are stored in the control database and served from a college-scoped path with `nosniff` and a locked-down content security policy.
- **Rendering.** The header, page titles and in-app screens read branding from the current college. Before sign-in the college is not yet known, so the login screen shows generic "Shikhon Alumni" branding. All hardcoded DIC text and images are removed.
- **Caching.** Branding is cached per college for a short time and invalidated when the admin saves.

## 6. Error handling

| Situation | Behaviour |
|---|---|
| Not signed in, or token invalid or expired | Redirect to Shikhon ID |
| Token has no college | "Your account isn't linked to a college" page |
| Non-admin opens an unprovisioned college | "Ask your college admin to activate Alumni" |
| Provisioning fails partway | College marked `failed`, partial database cleaned up, admin can retry; the lock prevents concurrent retries |
| College database unreachable | 503 page for that college only; others unaffected |
| College suspended | Read-only notice |

## 7. Testing

- Unit tests: tenant resolver, provisioner, migration runner.
- **Cross-tenant isolation test.** Sign in as college A, attempt to read college B's data through every route, and expect every attempt to fail.
- Integration tests: provisioning end to end; linking imported alumni by verified email.
- A mocked Shikhon ID for local development and CI.
- Target 80% coverage on the new modules.

## 8. DIC rollout

1. DIC is provisioned fresh as college #1. Demo seed data is discarded, nothing is migrated.
2. DIC admins sign in with Shikhon IDs; DIC's name and logo are set through the Settings page.
3. The existing deployment keeps running until DIC is verified on the new system, then traffic is cut over.

## 9. Open dependencies (Shikhon platform)

These are not yet confirmed and will be checked at the start of the implementation plan. Either may need a change on the Shikhon side:

1. Registering the alumni app as an OIDC client of Shikhon ID.
2. Whether an alumnus can self-register in Shikhon ID and be attached to a college.
3. Whether the token can carry a "college admin" claim, and the claim name and format.

## 10. Open input: new designs

The owner intends to supply new designs for a full redesign of the dashboard. They have not been provided yet. This spec covers the multi-college foundation only. The visual redesign will get its own spec once the designs arrive, and it must use the branding data defined in Section 5.

## 11. Hardening done first

A security review of the baseline found defects that must not reach any college. The implementation plan fixes them before the multi-college work: payment settlement by the payer, paid tickets confirmed without payment, invite-only events open to registration, event status and approval edits by moderators, private phone numbers in directory search, CSV formula injection, and the login throttle reset. Planning also found that the server published its own source and SQL files, and that database connections skipped certificate verification; both are fixed. Payment settlement now requires a signed gateway callback or an administrator, so until a real gateway is connected, donations and paid tickets stay pending in production. The owner should confirm that behaviour.

## 12. Repository

This work lives in `shikhon-alumni`, a separate repo seeded with a baseline snapshot (commit `5c52725`) of the DIC code. The original DICAlumniNetwork clone is not modified. No GitHub remote exists yet.
