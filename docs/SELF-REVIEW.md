# Self-review

Two rounds of work are recorded here. Round 1 introduced the personas and RBAC;
round 2 closed every gap round 1 listed and added agent-built profiles with
email invitations. Section D is what is *still* missing.

---

## A. Round 1 — personas and authorization

- Seven roles across four self-registerable account types, chosen in the UI.
- A permission matrix (`common/authz/permissions.ts`) plus a global
  `PermissionsGuard`, applied to every controller.
- Ownership checks in every service that mutates a record it did not create.
- Wedding planner as a first-class bookable provider.
- Bookings generalised from vendor-only to any provider.
- Hardened DTOs across every module.

Bugs fixed: self-registration as `admin`; escrow release/refund by any
authenticated user; cross-vendor booking confirmation; event guest-list and RSVP
IDOR; disputes on strangers' bookings; ungated reviews; refresh sitting behind
the access-token guard; `JwtStrategy` trusting the token body for `role`; login
timing enumeration.

---

## B. Round 2 — profiles without accounts, and the gap list

### B1. Agent-built profiles (new requirement)

`profiles.userId` is now nullable. An agent or family member builds a complete,
matchable profile — photos, preferences, contact details — for somebody who has
never signed up. Interests moved from user ids to **profile ids**, which is what
makes an unclaimed profile a first-class matchmaking citizen.

See [PROFILES-AND-INVITATIONS.md](PROFILES-AND-INVITATIONS.md).

### B2. Email invitations (new requirement)

A steward supplies an email **and a mobile number** — both mandatory — and sends
an invitation. The subject follows the link, sets **their own** password, and
takes ownership; the steward's write access ends at that moment. There is no
"create client account" endpoint any more, which is what closes the old hole
where an agent knew their client's credentials.

### B3. Solo users are unaffected

Self-registration remains fully open. A person who signs up directly has
`managedByAgentId = null`, signs in with their own password, browses and books
without any agent involvement, and may approach any user or agent. Covered by
its own section in `scripts/verify-invites.sh`.

### B4. Every gap round 1 listed

| Was | Now |
| --- | --- |
| Agents unvetted | `agent_profiles.isApproved`; admin approves before any stewardship |
| Agent chose the client's password | Invitation flow; the subject sets it |
| No email at all | `MailService` + `log`/`smtp` providers; verification, reset, invites, RSVP |
| One refresh token per user | `refresh_sessions`: per-device, rotated, with reuse detection |
| Tokens in `localStorage` | Refresh token in an httpOnly cookie; access token in memory only |
| Commission never applied | `splitAmount`; escrow releases the payout, platform keeps the fee |
| No payment webhooks | Signed webhook endpoint, HMAC over the raw body, replay-protected |
| Planner engagement free | Requires a confirmed or completed booking |
| No guest RSVP | Signed single-purpose RSVP links |
| Full profiles leaked in search | `toPublicProfile`: age band, photos gated on a match |
| `family` a duplicate of `bride` | Family members steward relatives, capped separately |
| `PAGINATION_MAX_LIMIT` ignored | Bounds read from config |
| No audit log | Append-only `audit_events` on every privileged/money-moving action |
| No admin MFA | TOTP, mandatory for admins by config |
| No brute-force lockout | Per-account lockout after `MAX_FAILED_LOGINS` |
| Rate limits per process | Redis-backed, keyed per account when signed in |

### B5. Bugs found during round 2

Three real defects, all caught by the live suites rather than by review:

1. **`AgentsService.listClients` returned 500.** A raw join alias combined with
   `orderBy` + `skip/take` made TypeORM build an ORDER BY over columns it had no
   metadata for. Rewritten as a scoped query plus a second profile lookup.
2. **Two logins in the same second produced byte-identical JWTs** (same claims,
   same `iat`), colliding on the session table's unique token hash. Refresh and
   access tokens now carry a random `jti` — which also means a refresh token is
   genuinely unpredictable.
3. **Container healthchecks probed the wrong loopback family.** nginx listens on
   IPv4 only, `localhost` resolves to `::1` inside the container, so the
   frontend reported unhealthy while serving traffic correctly.

---

## C. Verification

- **90 unit tests** — permission matrix, guard, booking authorization and the
  commission split, auth (registration, lockout, MFA, recovery, refresh).
- **118 live checks** (`scripts/verify-rbac.sh`) — the RBAC matrix end to end.
- **76 live checks** (`scripts/verify-invites.sh`) — stewardship, invitations,
  claiming, sessions, lockout, webhooks, audit, 2FA, pagination.

All passing against the running containers, from an empty database.

---

## D. What is STILL missing

Honest list, in the order I would tackle it.

### D1. SMS is not wired

Mobile numbers are collected and validated but never used. The invitation goes
by email only, so a client with a stale email address is unreachable even though
we hold their phone number.

*Fix:* an `SmsProvider` alongside `MailProvider` (the pattern is already there),
and send the invite by both channels. Also enables phone-number verification,
which matters more than email in this market.

### D2. No re-linking when the subject self-registers first

If an agent builds a profile for someone who then signs up on their own, the
invitation is refused (`ConflictException`) and there is no way to connect the
two. The agent's work is stranded.

*Fix:* a claim-request flow — the agent asks, the existing account approves, and
the profile transfers.

### D3. Escrow release is still a log line for real money

`RazorpayPaymentProvider.release` logs rather than transferring. Real
hold-and-release needs Razorpay Route with linked accounts and a KYC flow for
every vendor and planner. The commission split is computed and recorded
correctly, but nothing moves until Route is configured.

### D4. Webhooks record but never reconcile

The webhook endpoint verifies the signature, drops replays and stores the
provider's status — deliberately without touching the booking state machine. But
nothing reconciles a divergence: if the gateway says refunded and we say held,
no alert fires.

*Fix:* a scheduled reconciliation job over payments where `providerStatus`
disagrees with `status`.

### D5. MFA has no recovery codes

If an admin loses their authenticator they are locked out, and admins cannot
disable 2FA on themselves by design. The only way back is a database edit.

*Fix:* single-use recovery codes issued at setup.

### D6. Photos are URLs, not uploads

The managed-profile editor takes a URL. There is a media module with S3 presign,
but the two are not connected, so an agent must upload elsewhere first.

*Fix:* wire `POST /media/albums/:id/presign` into the profile photo editor.

### D7. Still no frontend tests

`frontend/src/lib/permissions.ts` mirrors the backend matrix by hand and can
drift silently. There is no component or e2e test of any kind.

*Fix (cheap):* a test that fetches `/auth/me/permissions` per persona and diffs
against the mirror. Generating the client constants from the backend enum at
build time would be better.

### D8. No data-subject rights

No export, no deletion, no retention policy. Worse now than before: an unclaimed
profile holds a real person's name, photo and phone number without them ever
having agreed to anything.

*Fix:* a documented lawful basis for steward-created profiles, an unsubscribe
link on the invitation, and automatic purge of unclaimed profiles that are never
invited or never accepted.

### D9. Audit trail is write-only in practice

Events are recorded and readable by admins, but nothing alerts on them. Escrow
release and account suspension are the two worth paging on.

### D10. Session cleanup is manual

`SessionsService.pruneExpired` exists and nothing calls it, so
`refresh_sessions` grows without bound.

*Fix:* a scheduled job, or a `ttlSecondsAfterFinished`-style cleanup task.

### D11. `RolesGuard` is now dead code

The permission guard replaced it everywhere. It is still registered, still
tested, and still harmless — but it is a second authorization mechanism nobody
uses, which is a trap for the next person.

---

## E. Deliberate non-goals

- **Kept the modulith.** Module boundaries are clean enough to extract later.
- **Kept the mock payment/AI/media providers.** Swapping them needs real
  credentials and is an environment decision.
- **Did not renumber migrations.** Phase 3 and Phase 4 are additive and
  reversible, so existing environments migrate forward cleanly.
- **`interests` migration drops unresolvable rows.** Moving from user ids to
  profile ids, any interest whose profile could not be resolved is deleted
  rather than guessed at. On a real deployment, check the row count first.
