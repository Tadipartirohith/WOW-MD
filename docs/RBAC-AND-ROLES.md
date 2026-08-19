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
| *(not offered)*   | `admin`                   | Approvals, analytics, disputes, account suspension         |

`admin` is **not** self-registerable. It is created out of band:

```bash
docker compose -f docker/docker-compose.yml --profile seed run --rm seed-admin
```

The seeder reads `ADMIN_EMAIL` / `ADMIN_PASSWORD` and is idempotent — re-running
promotes and reactivates an existing account instead of failing.

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
3. `RolesGuard` — legacy coarse `@Roles()` checks
4. `PermissionsGuard` — the capability check

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

| Permission | bride/groom/family | agent | vendor | planner | admin |
| --- | :-: | :-: | :-: | :-: | :-: |
| `profile:manage:own` | ● | ● | ● | ● | ● |
| `match:browse` | ● | ● | | | ● |
| `match:send_interest` | ● | ● | | | ● |
| `match:respond_interest` | ● | | | | ● |
| `chat:match` | ● | | | | ● |
| `chat:inquire` | ● | ● | ● | ● | ● |
| `booking:create` | ● | ● | | | ● |
| `booking:pay` | ● | ● | | | ● |
| `booking:read:own` | ● | ● | | | ● |
| `booking:confirm` | | | ● | ● | ● |
| `booking:complete` | | | ● | ● | ● |
| `booking:read:incoming` | | | ● | ● | ● |
| `vendor_listing:manage` | | | ● | | ● |
| `planner_listing:manage` | | | | ● | ● |
| `review:write` | ● | ● | | | ● |
| `client:create` / `client:read` / `client:act_on_behalf` | | ● | | | ● |
| `plan:manage:own` | ● | ● | | | ● |
| `plan:manage:engaged` | | | | ● | ● |
| `event:manage:own` | ● | ● | | ● | ● |
| `media:manage:own` | ● | ● | ● | ● | ● |
| `travel:book` | ● | ● | | | ● |
| `dispute:raise` | ● | ● | ● | ● | ● |
| `ai:assist` | ● | ● | ● | ● | ● |
| `admin:*` | | | | | ● |

Admin permissions are computed as `Object.values(Permission)`, so a new
capability is never accidentally withheld from support staff.

## 3. Agents and their clients

An agent creates a client account through `POST /agents/clients`. The server
stamps `users.managedByAgentId` with the calling agent's id. That single column
scopes everything downstream.

`AgentsService.assertManages(agentId, clientUserId)` is the **only** place the
ownership rule is written. Every act-on-behalf path calls it:

- `POST /bookings` with `onBehalfOfUserId`
- `GET /matches/suggestions?onBehalfOfUserId=…`
- `POST /matches/interest` with `onBehalfOfUserId`
- `POST /planner/plan` with `onBehalfOfUserId`
- `GET /bookings?clientId=…`

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

## 7. Verifying

```bash
docker compose -f docker/docker-compose.yml up -d --build
docker compose -f docker/docker-compose.yml --profile seed run --rm seed-admin
docker run --rm --network docker_default -v "$PWD/scripts:/scripts" alpine:3.20 \
  sh -c "apk add --no-cache curl jq >/dev/null && sh /scripts/verify-rbac.sh"
```

108 checks covering privilege escalation, per-persona permissions, agent
scoping, booking IDOR, escrow transitions, review gating, event ownership,
schema validation and token handling. The script exits non-zero on any failure.

Unit tests (`npm test`) additionally cover the permission matrix itself, the
guard, and the booking authorization paths.

## 8. Known gaps

See `docs/SELF-REVIEW.md`.
