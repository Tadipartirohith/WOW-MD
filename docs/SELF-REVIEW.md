# Self-review

Three rounds of work are recorded here. Round 1 introduced the personas and
RBAC; round 2 closed every gap round 1 listed and added agent-built profiles
with email invitations; round 3 reworked intake and built circulation after the
domain correction below. The last two sections are what is *still* missing,
and what was left undone on purpose.

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

## C. Round 3 — how an agency actually works

A domain correction: in the Indian matrimony market the family hands their
details to the agent **directly**, and the agent then **circulates** the
biodata. Two things in round 2 were wrong as a result.

### What was wrong

1. **Email was mandatory on an agency-built profile.** I had treated the
   invitation as the point of the flow. A walk-in family gives a phone number
   far more often than an email address, and many clients never want a login at
   all — the agent is their whole interface. Phone is now the required
   identifier and the practical identity key (with duplicate detection on it);
   email is optional, and only needed to send an invitation. Claiming is a
   feature, not the destination.
2. **Circulation did not exist.** `assertManages` walled every agent off from
   every other one, which is right for access control but left the agent's
   actual job with nowhere to happen.

### What was built

- **Consent in two scopes.** Intake (the agency may hold the details) is
  separate from circulation (they may leave the agency); the second expires and
  must be re-confirmed; records are append-only. Method, who gave it and their
  relationship to the subject, callback number, date, capturing agent and notes
  are all captured — a parent very often speaks for the person here.
- **Five circulation paths**, all consent-gated, all revocable, all read-only:
  to another agency, to a platform user, as a signed biodata link, into a
  vetted-agent pool, and as a printable sheet.
- **Cross-agent proposal threads** hanging off the existing interest record,
  because a pairing is negotiated agent-to-agent before the families meet.
- **Withdrawal that actually withdraws**: revoking consent pulls the profile out
  of the pool immediately and kills links already in circulation, because
  consent is re-checked when a link is opened, not only when it is created.

### Bug found while verifying

`@ValidateNested()` does not reject a **missing** nested object, so a request
with no consent block passed validation and then crashed the service. Fixed with
`@IsDefined()` — worth remembering wherever a required nested DTO appears.

---

## Verification

- **84 unit tests** — permission matrix, guards, booking authorization and the
  commission split, auth (registration, lockout, MFA, recovery, refresh), and
  the consent state machine.
- **118 live checks** (`scripts/verify-rbac.sh`) — the RBAC matrix end to end.
- **76 live checks** (`scripts/verify-invites.sh`) — stewardship, invitations,
  claiming, sessions, lockout, webhooks, audit, 2FA, pagination.
- **73 live checks** (`scripts/verify-circulation.sh`) — phone-first intake,
  duplicate detection, both consent scopes, all five circulation paths,
  read-only enforcement, withdrawal, and cross-agent threads.

267 live assertions in total, all passing against the running containers from an
empty database.

---

## What is still missing

Honest list, in the order I would tackle it.

### D1. SMS is not wired — now the biggest gap

Mobile numbers are collected, validated, and treated as the identity key, but
never actually used. Since intake went phone-first this is worse than it was: an
agent can build a profile with no email at all, and then has **no** way to reach
that family through the platform. Invitations still go by email only.

*Fix:* an `SmsProvider` alongside `MailProvider` (the pattern is already there),
invitations over both channels, and phone-number verification — which matters
more than email verification in this market.

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

### D8. Data-subject rights are half-built

Consent is now recorded properly — who gave it, how, when, and in which scope —
and it can be withdrawn, which was the biggest part of the gap round 2 flagged.
Still missing: no data export, no deletion endpoint, no retention policy, no
automatic purge of unclaimed profiles that are never invited or never accepted,
and no unsubscribe link on an invitation.

*Fix:* an export and erasure path, plus a scheduled purge keyed on consent age.

### D9. Audit trail is write-only in practice

Events are recorded and readable by admins, but nothing alerts on them. Escrow
release and account suspension are the two worth paging on.

### D10. Session cleanup is manual

`SessionsService.pruneExpired` exists and nothing calls it, so
`refresh_sessions` grows without bound.

*Fix:* a scheduled job, or a `ttlSecondsAfterFinished`-style cleanup task.

### D11. Circulation has no reach analytics

An agency can see who holds a profile and whether a link was opened, but not
which shares led anywhere. There is no "3 of your 12 shares produced a proposal"
view, which is exactly what an agent would want.

### D12. The pool has no quality control

Any approved agency can put any consented profile into the network pool; nothing
rate-limits it or flags stale listings, so one agency could flood it.

*Fix:* a per-agency pool quota, and automatic de-listing as consent nears expiry.

### D13. `RolesGuard` is now dead code

The permission guard replaced it everywhere. It is still registered, still
tested, and still harmless — but it is a second authorization mechanism nobody
uses, which is a trap for the next person.

---

## Deliberate non-goals

- **Kept the modulith.** Module boundaries are clean enough to extract later.
- **Kept the mock payment/AI/media providers.** Swapping them needs real
  credentials and is an environment decision.
- **Did not renumber migrations.** Phase 3 and Phase 4 are additive and
  reversible, so existing environments migrate forward cleanly.
- **`interests` migration drops unresolvable rows.** Moving from user ids to
  profile ids, any interest whose profile could not be resolved is deleted
  rather than guessed at. On a real deployment, check the row count first.
