# Accounts, roles and RBAC

This document is the contract for who may do what on WOW. If you add an
endpoint, add its capability here first, then implement it.

## 1. Account types and roles

A visitor picks an **account type** at sign-up. The server turns that into a
**role**; the role determines the **permission set**.

| Account type (UI) | Role(s) issued            | What the account is for                                   |
| ----------------- | ------------------------- | --------------------------------------------------------- |
| Individual        | `bride`, `groom`, `family`| Takes part in matchmaking; buys services                   |
| Marriage agent    | `agent`                   | Onboards and represents clients; buys on their behalf      |
| Vendor            | `vendor`                  | Sells wedding services (venue, catering, photography, …)   |
| Wedding planner   | `planner`                 | Sells planning packages; co-manages plans they are engaged on |
| *(not offered)*   | `in_person`               | Visits applicants, decides verifications, investigates cases |
| *(not offered)*   | `admin`                   | Approvals, analytics, disputes, account suspension         |

`in_person` is **not** self-registerable either. A verification officer decides
whether other people get operational access, so the account exists only because
an administrator created it:

```
POST /api/verification/officers    (admin only)
```

Credentials are emailed and are single-use: `mustResetPassword` keeps the account
locked to the password-change route until it is replaced, and replacing it
revokes every session the temporary credential opened.

Their permission row is deliberately the narrowest on the platform — the
verification queue, the case queue, and nothing else. In particular they cannot
allocate work to themselves, because an officer choosing their own visits is not
an allocation.

`admin` is **not** self-registerable. It is created out of band:

```bash
docker compose -f docker/docker-compose.yml --profile seed run --rm seed-admin
```

The seeder reads `ADMIN_EMAIL` / `ADMIN_PASSWORD` and is idempotent — re-running
promotes and reactivates an existing account instead of failing.

### Stewardship

`agent` and `family` may act for **other people**, including people who have no
account at all. That is a distinct axis from the buy/sell split, and it is
documented separately in [PROFILES-AND-INVITATIONS.md](PROFILES-AND-INVITATIONS.md).

An agent must be verified before any stewardship path opens. Submitting agency
details raises a verification request; an administrator allocates it, an officer
visits the address on it, and their approval is the only thing that sets
`agent_profiles.isApproved`. A family member is capped at a handful of relatives
instead.

### Role groupings

Defined once in `backend/src/common/enums/index.ts` and reused everywhere:

- `INDIVIDUAL_ROLES` — `bride`, `groom`, `family`. The only roles that appear in
  matchmaking, either as a searcher or as a candidate.
- `PROVIDER_ROLES` — `vendor`, `planner`. The sell side.
- `CONSUMER_ROLES` — individuals plus `agent`. **Only these may place bookings.**
- `SELF_REGISTERABLE_ROLES` — everything except `admin`.

## 2. The permission model

Controllers declare a **capability**, not a list of roles:

```ts
@RequirePermissions(Permission.BOOKING_CREATE)
@Post()
create(@CurrentUser() actor: AuthUser, @Body() dto: CreateBookingDto) { … }
```

`ROLE_PERMISSIONS` in `backend/src/common/authz/permissions.ts` maps each role to
its capabilities. Adding a persona is one new row in that matrix rather than a
sweep across every controller.

Guards run globally in this order (`app.module.ts`):

1. `ThrottlerGuard` — rate limiting
2. `JwtAuthGuard` — authentication (`@Public()` opts a route out)
3. `PasswordResetGuard` — an account still holding an emailed temporary
   password gets no further than the reset screen (`@AllowDuringPasswordReset()`
   marks the three routes that stay open)
4. `RolesGuard` — legacy coarse `@Roles()` checks
5. `PermissionsGuard` — the capability check

### Two layers, and why both exist

The guard answers **"may this *kind* of account attempt this action?"**. It
cannot answer **"is this *particular* record theirs?"** — that needs a database
read. So every service still enforces ownership:

| Layer                | Question                                    | Example                                            |
| -------------------- | ------------------------------------------- | -------------------------------------------------- |
| `PermissionsGuard`   | Can a `vendor` complete bookings at all?    | 403 for a `bride` calling `/bookings/:id/complete` |
| Service check        | Is *this* booking against *their* listing?  | 403 for vendor B completing vendor A's booking     |

Skipping the second layer is what produced the IDOR bugs listed in §6.

### Permission reference

| Permission | bride/groom/family | agent | vendor | planner | in_person | admin |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| `profile:manage:own` | ● | ● | ● | ● | ● | ● |
| `match:browse` | ● | ● | | | | ● |
| `match:send_interest` | ● | ● | | | | ● |
| `match:respond_interest` | ● | ● | | | | ● |
| `match:lifecycle` | ● | ● | | | | ● |
| `match:fix` | ● | ● | | | | ● |
| `managed_profile:manage` | family only | ● | | | | ● |
| `managed_profile:invite` | family only | ● | | | | ● |
| `act_on_behalf` | family only | ● | | | | ● |
| `profile:circulate` | family only | ● | | | | ● |
| `network_pool:browse` | | ● | | | | ● |
| `agency:manage` | | ● | | | | ● |
| `session:manage:own` | ● | ● | ● | ● | ● | ● |
| `mfa:manage:own` | ● | ● | ● | ● | ● | ● |
| `chat:match` | ● | | | | | ● |
| `chat:inquire` | ● | ● | ● | ● | ● | ● |
| `booking:create` | ● | ● | | | | ● |
| `booking:pay` | ● | ● | | | | ● |
| `booking:read:own` | ● | ● | | | | ● |
| `booking:confirm` | | | ● | ● | | ● |
| `booking:complete` | | | ● | ● | | ● |
| `booking:read:incoming` | | | ● | ● | | ● |
| `vendor_listing:manage` | | | ● | | | ● |
| `planner_listing:manage` | | | | ● | | ● |
| `review:write` | ● | ● | | | | ● |
| `client:read` / `client:create` / `client:act_on_behalf` | | ● | | | | ● |
| `plan:manage:own` | ● | ● | | | | ● |
| `plan:manage:engaged` | | | | ● | | ● |
| `event:manage:own` | ● | ● | | ● | | ● |
| `media:manage:own` | ● | ● | ● | ● | | ● |
| `travel:book` | ● | ● | | | | ● |
| `dispute:raise` | ● | ● | ● | ● | | ● |
| `case:raise` | ● | ● | ● | ● | ● | ● |
| `case:investigate` / `case:settle` | | | | | ● | ● |
| `case:allocate` | | | | | | ● |
| `verification:process` / `verification:decide` | | | | | ● | ● |
| `verification:allocate` | | | | | | ● |
| `ai:assist` | ● | ● | ● | ● | | ● |
| `admin:*` (users, agents, vendors, officers, analytics, disputes, audit) | | | | | | ● |

Two rows are worth reading twice. An officer can **decide** a verification but
not **allocate** one — choosing your own visits is not an allocation. And an
agent holds `match:respond_interest` and `match:fix` because a walk-in client
with no account has nobody else to answer for them; the ownership check in the
service still confines that to profiles on their own books.

Admin permissions are computed as `Object.values(Permission)`, so a new
capability is never accidentally withheld from support staff.

## 3. Agents and their clients

An agent cannot create an account directly. They build a **profile** for the
person (`POST /agents/profiles`), email an **invitation**, and the account only
exists once the subject accepts and chooses their own password — see
[PROFILES-AND-INVITATIONS.md](PROFILES-AND-INVITATIONS.md).

Two ownership rules, each written in exactly one place:

- **Profiles.** `MatchmakingService.resolveSubject(actor, profileId)` — the
  caller owns the profile, stewards it, or is an admin. Used by every
  matchmaking path.
- **Accounts.** `AgentsService.assertManages(agentId, clientUserId)` — used by
  every path that needs a real account:
  - `POST /bookings` with `onBehalfOfUserId`
  - `POST /planner/plan` with `onBehalfOfUserId`
  - `GET /bookings?clientId=…`

Matchmaking keys on **profiles** so an unclaimed profile can take part;
bookings key on **accounts** because escrow needs somewhere to refund to.

An agent-placed booking records both parties: `userId` is the client (escrow
refunds go there), `bookedByUserId` is the agent (audit trail).

### Independent users stay independent

A user who signs up directly has `managedByAgentId = null` and is never tied to
an agency. They can:

- send an interest to **any** individual, including agent-managed ones;
- open a chat thread with **any** agent, vendor or planner without a prior match.

An agent has no read access to anyone outside their own book.

## 4. Chat access rules

`ChatService.assertCanChat` classifies every thread and refuses anything else:

| Thread kind      | Allowed between                                     |
| ---------------- | --------------------------------------------------- |
| `MATCH`          | two individuals with an **accepted** interest        |
| `INQUIRY`        | a buyer-side account and a vendor / planner / agent  |
| `REPRESENTATION` | a managed client and the agent who represents them   |

Individual-to-individual without an accepted match is refused. The WebSocket
gateway applies the same rule and additionally validates its payload with an
explicit `ValidationPipe` (the global pipe is HTTP-only).

## 5. Booking lifecycle and who drives it

```
REQUESTED --(buyer pays)--> PENDING[escrow held]
          --(provider confirms)--> CONFIRMED
          --(provider completes)--> COMPLETED[escrow released]
   any    --(either party)--> CANCELLED[escrow refunded]
```

- Buyer side: the client, or the agent who placed it, or an admin.
- Seller side: the account owning the vendor/planner listing, or an admin.
- Cancel: either side.
- Reviews require a **completed** booking with that provider, and you cannot
  review your own listing.
- Listings start `isApproved = false` and are not bookable until an admin
  approves them.
- **Commission.** `PAYMENT_COMMISSION_PERCENT` is applied at payment time and
  stored on the payment row, so what the provider is owed is fixed then and
  cannot drift if the rate changes. Completion releases the payout only;
  cancellation refunds the buyer in full and earns nothing.
- **Idempotency.** `PUT /bookings/:id/pay` accepts an `idempotencyKey`, so a
  retried request returns the original payment rather than opening a second
  escrow hold.
- **Webhooks.** `POST /payments/webhook` verifies an HMAC over the raw body and
  drops replays, but never drives the state machine — that stays under the rules
  above, where authorization is enforced.
- Escrow held, released and refunded are all written to the audit trail.

## 6. Bugs this replaced

Found in the original code and fixed here:

| # | Problem | Impact |
| - | ------- | ------ |
| 1 | `RegisterDto.role` was `@IsEnum(UserRole)` and passed straight through | **Anyone could register as `admin`** and take over the platform |
| 2 | `bookings/:id/complete` and `/cancel` had no role or ownership check | Any authenticated user could **release or refund escrow** on any booking by guessing a UUID |
| 3 | `bookings/:id/confirm` checked role but not ownership | Any vendor could confirm any other vendor's booking |
| 4 | `events/:id/invite`, `/guest-list`, `/rsvp` had no ownership check | Any user could read any event's guest list and rewrite RSVPs |
| 5 | `POST /admin/disputes` did not check the booking belonged to the caller | Disputes could be opened against strangers' bookings |
| 6 | `POST /vendors/:id/reviews` had no purchase gate | Rating manipulation by anyone with an account |
| 7 | `POST /auth/refresh` sat behind the **access-token** guard | Refresh was unusable once the access token expired |
| 8 | `JwtStrategy` trusted the token body for `role` | Role changes and suspensions did not take effect until token expiry |
| 9 | 10 of 13 controllers had no authorization at all | Vendors could browse matches; brides could reach the admin console |
| 10 | Login leaked account existence via timing | User enumeration |
| 11 | DTOs lacked bounds (`MaxLength`, `Min`/`Max`, `IsUrl`, `ArrayMaxSize`) | Oversized payload / storage abuse; `presign` accepted `../` path traversal |
| 12 | WebSocket messages bypassed the global `ValidationPipe` | Unvalidated input on the realtime path |
| 13 | Frontend showed every nav item, including Admin, to every user | Confusing UX and needless 403s |

Found and fixed in the second round:

| # | Problem | Impact |
| - | ------- | ------ |
| 14 | Anyone could self-register as an agent and immediately create accounts for other people | The highest-leverage account type was unvetted |
| 15 | The agent chose their client's password | An agent could sign in as their own client, outside the audit trail |
| 16 | One refresh-token hash per user | Signing in anywhere silently signed you out everywhere else; no way to spot a stolen token |
| 17 | Tokens persisted to `localStorage` | Any XSS bug walked off with a 30-day credential |
| 18 | `PAYMENT_COMMISSION_PERCENT` was read into config and never applied | Providers were paid the gross amount; the platform earned nothing |
| 19 | No webhook endpoint or signature check | Gateway state changes never reached us; a retried payment could double-charge |
| 20 | A host could hand any planner write access with no booking | Planner access existed outside the commercial model |
| 21 | Match suggestions returned the whole profile entity | Exact dates of birth and full photo sets exposed before any match |
| 22 | No brute-force lockout, and rate limits were per process | Distributed password guessing; effective limit multiplied by replica count |
| 23 | No audit trail and no admin MFA | Escrow release and account suspension were untraceable and password-only |
| 24 | `AgentsService.listClients` 500'd | A raw join alias with `orderBy` + `skip/take` made TypeORM order by columns it had no metadata for |
| 25 | Two logins in the same second produced identical JWTs | Session-hash collision, and a refresh token that was not unpredictable |
| 26 | Healthchecks probed `localhost` against IPv4-only listeners | The frontend reported unhealthy while serving traffic correctly |

## 7. Verifying

```bash
docker compose -f docker/docker-compose.yml up -d --build
docker compose -f docker/docker-compose.yml --profile seed run --rm seed-admin

docker run --rm --network docker_default -v "$PWD/scripts:/scripts" alpine:3.20 \
  sh -c "apk add --no-cache curl jq openssl redis >/dev/null && sh /scripts/verify-rbac.sh"

docker run --rm --network docker_default -v "$PWD/scripts:/scripts" alpine:3.20 \
  sh -c "apk add --no-cache curl jq openssl redis >/dev/null && sh /scripts/verify-invites.sh"

docker run --rm --network docker_default -v "$PWD/scripts:/scripts" alpine:3.20 \
  sh -c "apk add --no-cache curl jq openssl redis >/dev/null && sh /scripts/verify-phase1.sh"
```

- `verify-rbac.sh` — **140 checks**: privilege escalation, per-persona
  permissions, agency vetting, profile-level scoping, booking IDOR, escrow
  transitions, the Match Fixed gate on services, review gating, event ownership,
  schema validation, cookie-borne refresh and token handling.
- `verify-invites.sh` — **73 checks**: agency approval, profiles built for
  people with no account, invitation and claim, the profile-completion gate,
  multi-device sessions, brute-force lockout, signed payment webhooks, the audit
  trail, two-factor and pagination bounds.
- `verify-phase1.sh` — **120 checks**: officer accounts and the forced password
  reset, the three separations in the verification queue, identity documents and
  the duplicate they refuse, agency fees, Match Fixed and provisioning, vendor
  compliance and the calendar, quotations, escrow milestones, a case freezing the
  money, chat redaction and the profile lifecycle.

All exit non-zero on any failure, so any of them can gate a deploy. Each clears
its own rate-limit counters first: those live in Redis now and deliberately
survive restarts, so a repeated run would otherwise trip limits unrelated to the
checks.

Unit tests (`npm test`) additionally cover the permission matrix itself, the
guards, the commission split, the auth service (registration, lockout,
two-factor, recovery and refresh rotation), contact redaction, and government-ID
validation and hashing.

## 8. Related documents

- [ARCHITECTURE.md](ARCHITECTURE.md) — the combined HLD/SLD/LLD
  reference for the whole repository.

- [PROFILES-AND-INVITATIONS.md](PROFILES-AND-INVITATIONS.md) — profiles without
  accounts, stewardship, and the invitation/claim flow.
- [CIRCULATION.md](CIRCULATION.md) — phone-first intake, the two consent scopes,
  and the five ways an agent circulates a biodata.
- [SELF-REVIEW.md](SELF-REVIEW.md) — what is still missing.
