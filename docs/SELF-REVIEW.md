# Self-review: what is done, and what is still missing

Written after the RBAC / multi-persona work. Ordered by risk, not by effort.
Nothing here is hypothetical hand-waving — each item names the file it lives in.

---

## A. Shipped and verified

- Seven roles across four self-registerable account types, chosen in the UI.
- A permission matrix (`common/authz/permissions.ts`) plus a global
  `PermissionsGuard`, applied to **all 15** controllers.
- Ownership checks in every service that mutates a record it did not create.
- Agent → client linkage (`users.managedByAgentId`) with a single choke point
  (`AgentsService.assertManages`) used by every act-on-behalf path.
- Wedding planner as a first-class bookable provider, plus plan co-management.
- Bookings generalised from vendor-only to any provider, with the acting user
  recorded separately from the client.
- Hardened DTOs across every module (bounds, URL checks, array caps, enum
  narrowing, path-traversal guard on presign).
- 52 unit tests + 108 live API checks (`scripts/verify-rbac.sh`), all passing
  against the running containers.

---

## B. Security gaps that remain

### B1. Agent accounts are not vetted — **highest residual risk**

Anyone can self-register as `agent` and immediately onboard client accounts,
which creates real user records with real credentials. Vendors and planners are
gated behind admin approval before their listing is visible; agents are not
gated at all.

*Fix:* add `isApproved` to agent accounts (or an `AgentProfile` mirroring
`PlannerProfile`), and gate `Permission.CLIENT_CREATE` on it. `AdminService`
already has the approval plumbing to copy.

### B2. Agent-created clients get a password the agent chose

`POST /agents/clients` takes a password the agent types and shares out-of-band.
The agent therefore knows the client's credentials and can impersonate them
fully — outside the audit trail that `bookedByUserId` provides.

*Fix:* generate a random password server-side, never return it, and email the
client an activation link. Depends on B3.

### B3. No email verification, and no password reset

`users.isVerified` exists and is never set. There is no mail transport wired at
all, so there is no "forgot password" flow, no email confirmation, and no way
for an agent-created client to claim their own account.

*Fix:* add a transactional mail provider behind an interface (the codebase
already uses this pattern for payments, media and AI), plus a signed
single-use-token table for verify/reset.

### B4. One refresh token per user

`users.refreshTokenHash` is a single column, so signing in on a second device
silently invalidates the first. There is also no refresh-token **reuse
detection**, which is the standard way to spot a stolen token.

*Fix:* a `refresh_tokens` table keyed by device/session with issued/revoked
timestamps and a reuse-detection rule that revokes the whole family.

### B5. Tokens live in `localStorage`

`frontend/src/store/auth.ts` persists tokens via zustand. Any XSS becomes full
account takeover.

*Fix:* move the refresh token to an `httpOnly; Secure; SameSite=Strict` cookie
and keep only the short-lived access token in memory. Needs a CSRF token on
state-changing routes once cookies are in play.

### B6. Rate limiting is per-instance

`ThrottlerModule` uses in-memory storage. The k8s manifests run multiple
replicas, so the effective limit is `configured × replicas`, and it resets on
every pod restart.

*Fix:* `@nest-lab/throttler-storage-redis` against the Redis that is already a
dependency. There is also no per-account limit — only per-IP — so a single
account can spread abuse across addresses.

### B7. No admin MFA and no audit log

Nothing records who released escrow, who suspended an account, or who approved a
listing. `AdminService.setUserStatus` and `BookingsService.complete` are
unlogged. Admin accounts have no second factor.

*Fix:* an append-only `audit_events` table written in the same transaction as
the privileged action, plus TOTP for `admin`.

### B8. No brute-force lockout

Login is rate-limited by IP (10/min) but an account is never locked after
repeated failures, and there is no CAPTCHA. Login timing was equalised, so
enumeration is closed, but sustained distributed guessing is not.

---

## C. Correctness and business-logic gaps

### C1. Marketplace commission is configured but never applied

`PAYMENT_COMMISSION_PERCENT` is read into config and used nowhere.
`BookingsService.complete` releases the **full** escrow amount to the provider,
so the platform earns nothing.

*Fix:* split the release into provider payout and platform fee, and record both
on the `Payment` row.

### C2. Payment provider is a mock, with no webhooks

`payment.provider.ts` has a Razorpay class, but there is no webhook endpoint, no
signature verification, and no idempotency key. Escrow state is whatever the API
call returned; a provider-side change never reaches us, and a retried request
can double-charge.

### C3. Planner engagement is not tied to payment

`PUT /planner/plan/:id/planner` lets a host engage any approved planner and hand
them write access to the plan, with no booking or payment involved. A planner
also cannot decline. This is a deliberate simplification, but it is a hole in
the commercial model.

### C4. Guest-facing RSVP was removed, not replaced

I locked `PUT /events/invites/:id/rsvp` to the event host, which closes the IDOR
(previously anyone could rewrite any RSVP from an invite id). But guests are not
platform users, so there is now **no way for a guest to RSVP themselves**.

*Fix:* a signed, single-use RSVP link (`GET /events/rsvp/:token`) — the same
pattern `media.getShared` already uses for album sharing.

### C5. Match suggestions leak full profiles

`MatchmakingService.suggestions` returns the whole `Profile` entity, including
`dateOfBirth` and every photo, for every candidate — before any interest is
accepted. `ProfileVisibility.MATCHES_ONLY` is only used to exclude `PRIVATE`
profiles from the pool; it does not actually restrict *fields*.

*Fix:* a `PublicProfileDto` that returns an age band rather than a date of
birth, and withholds photos until the match is accepted.

### C6. The `family` role is a duplicate

`family` currently has exactly the same permissions as `bride`/`groom`. The
whole point of the persona — a parent or sibling searching *on behalf of*
someone — is not modelled: there is no link between a family account and the
person they represent.

*Fix:* reuse the agent pattern (`managedByAgentId` generalised to a
`representedBy` relationship) so a family member manages a linked profile.

### C7. `PAGINATION_MAX_LIMIT` is ignored

`PaginationDto` hardcodes `@Max(100)` while config exposes a tunable limit. The
config value has no effect.

---

## D. Operational gaps

- **No audit of the optional integrations.** Neo4j and Kafka are wired and
  default-off. Nothing exercises the `--profile full` path; it is unverified.
- **No image scanning.** The CI `docker-build` job builds but does not scan
  (Trivy is mentioned in a comment only) and does not push.
- **No structured backup/restore runbook** for Postgres, and no PITR config.
- **No GDPR/DPDP surface.** No data export, no account deletion, no soft-delete
  and no retention policy. `users` rows are never removed.
- **No observability.** Pino logs to stdout; there is no tracing, no metrics
  endpoint, and no alerting on escrow failures — the highest-value thing to
  alert on.
- **Frontend has no test suite at all.** The permission mirror in
  `frontend/src/lib/permissions.ts` can drift from the backend matrix and
  nothing would catch it.
  *Cheap fix:* generate the client constants from the backend enum at build
  time, or add a test that fetches `/auth/me/permissions` and diffs.

---

## E. Things I deliberately did not change

- **Kept the modulith.** The brief was to fix authorization, not to split
  services. Module boundaries are already clean enough to extract later.
- **Kept `@Roles`/`RolesGuard` alongside the new permission guard.** Removing it
  would have touched files unrelated to this work; it is now unused by
  application code but still tested and harmless.
- **Kept the mock payment/AI/media providers.** Swapping them needs real
  credentials and is an environment decision.
- **Did not renumber the existing migrations.** `Phase3RbacSchema` is additive
  and reversible, so existing environments migrate forward cleanly.

---

## F. What I would do next, in order

1. **B1** — gate agent accounts behind approval. Cheapest fix for the largest
   remaining hole, and the plumbing already exists.
2. **B3** — email transport, which unblocks B2 and C4.
3. **C1** — apply the commission; the platform currently earns zero revenue.
4. **B4 + B5** — session table and cookie-based refresh.
5. **B7** — audit log, before the first real money moves.
6. **C5** — profile field-level privacy.
