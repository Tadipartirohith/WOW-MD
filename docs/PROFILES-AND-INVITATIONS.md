# Profiles, stewardship and invitations

This is the model behind "an agent can build a full profile for someone who has
no account". Read it with [RBAC-AND-ROLES.md](RBAC-AND-ROLES.md), which covers
who may do what, and [ARCHITECTURE.md](ARCHITECTURE.md) for where it sits in the
whole system.

## 1. A profile is not an account

The two are separate records, and either can exist without the other:

| | `users` | `profiles` |
| --- | --- | --- |
| What it is | Credentials and a persona | A marriage profile |
| Can exist alone? | Yes (a vendor has no marriage profile) | **Yes** — this is the new part |
| Key columns | `email`, `role`, `managedByAgentId` | `userId` (nullable), `managedByUserId`, `claimStatus` |

`profiles.userId` is **nullable**. When an agent builds a profile for somebody
who has never signed up, that column stays null until the subject claims it.

Because of that, **matchmaking keys on profile ids, not user ids**.
`interests.fromProfileId` / `toProfileId` is what lets an unclaimed profile send
and receive interests on day one.

## 2. The lifecycle

```
   steward fills in the form
            │
            ▼
     ┌─────────────┐   invite emailed    ┌──────────┐   subject sets their    ┌─────────┐
     │  UNCLAIMED  │ ──────────────────► │ INVITED  │ ─── own password ─────► │ CLAIMED │
     └─────────────┘                     └──────────┘                         └─────────┘
     userId = null                       userId = null                    userId = the new account
     matchable ✓                         matchable ✓                      matchable ✓
     steward edits ✓                     steward edits ✓                  steward edits ✗ (read-only)
```

A profile created by its own owner starts at `SELF` and never enters this cycle.

Key property: **the steward never chooses the subject's password.** They supply
a mobile number (and optionally an email); the subject sets their own
credentials on the invitation page. That is what stops an agent being able to
sign in as their own client, and it is why there is no "create client account"
endpoint any more.

Note that **claiming is optional**, not the destination. The steady state for a
great many profiles is agent-managed forever: the family gave their details at
the desk and has no interest in a login. A profile is fully matchable and fully
circulatable while unclaimed — see [CIRCULATION.md](CIRCULATION.md). An email
address is only needed if and when an invitation is actually sent.

## 3. Who may steward

| Role | Build profiles | Send invites | Client accounts | Limit |
| --- | :-: | :-: | :-: | --- |
| `agent` | ● (after approval) | ● | ● | `MAX_MANAGED_PROFILES` (200) |
| `family` | ● | ● | ✗ | `MAX_MANAGED_PROFILES_FAMILY` (5) |
| everyone else | ✗ | ✗ | ✗ | — |

A family member looking after a relative is doing the same thing mechanically as
an agent, so it reuses the same paths — minus the agency surface. This is what
finally makes `family` a distinct persona rather than a copy of `bride`.

### Agents are vetted first

An agent can sign in and browse immediately, but `agent_profiles.isApproved`
gates every stewardship path. Without that gate anyone could self-register as an
agent and start creating real accounts for other people.

```
register (agent) → PUT /agents/agency → admin approves → can build profiles
```

Set `REQUIRE_AGENT_APPROVAL=false` to disable the gate in a trusted environment.

## 4. The API

| Route | Who | What |
| --- | --- | --- |
| `PUT /agents/agency` | agent | Register or update agency details |
| `GET /agents/agency/status` | agent | Approval banner state |
| `POST /agents/profiles` | steward | Build a profile (mobile + consent required; email optional) |
| `PUT /agents/profiles/:id` | steward | Edit, while unclaimed |
| `POST /agents/profiles/:id/photos` | steward | Add a photo (max 20) |
| `DELETE /agents/profiles/:id/photos` | steward | Remove a photo |
| `POST /agents/profiles/:id/invite` | steward | Email the claim link |
| `GET /agents/profiles/actable` | steward | Profiles they may act as |
| `GET /auth/invitations/:token` | public | Landing-page preview |
| `POST /auth/invitations/accept` | public | Claim: create account, sign in |
| `GET /agents/clients` | agent | Accounts that resulted from invitations |

Circulation has its own surface under `/circulation` — see
[CIRCULATION.md](CIRCULATION.md).

Acting under a profile is a query/body parameter, not a separate endpoint:

```
GET  /matches/suggestions?profileId=<managed profile>
POST /matches/interest      { toProfileId, profileId }
POST /bookings              { providerId, amount, onBehalfOfUserId }
```

`MatchmakingService.resolveSubject` is the single place that decides whether the
caller may act as a given profile: they own it, they steward it, or they are an
admin. Nothing else.

Bookings still key on **accounts** (`onBehalfOfUserId`), because escrow needs a
real account to refund to — so an agent can only book for a client who has
actually claimed their profile.

## 5. Token safety

Invitations, email verification, password reset and guest RSVP all use the same
shape: 32 bytes of CSPRNG output, returned once in the email, with only the
SHA-256 stored (`common/util/tokens.ts`). A database leak therefore yields no
working links.

SHA-256 rather than bcrypt is deliberate: these are high-entropy random values,
not user-chosen secrets, so there is nothing to brute-force and lookup stays one
indexed query.

**Development note.** With `MAIL_PROVIDER=log` nothing is actually delivered, so
`POST /agents/profiles/:id/invite` also returns `devToken` / `devUrl`. This is
gated strictly on that provider — the token is enough to claim the account, so a
real deployment must never hand it to the steward.

## 6. Privacy

A profile is not returned whole to other users. `toPublicProfile` projects it:

- an **age band** (`26-30`), never a date of birth;
- **photos only after a match** — a `PUBLIC` profile shows one lead photo,
  `MATCHES_ONLY` shows none until both sides accept;
- the free-text bio only after a match;
- search preferences (preferred age, preferred locations) are never exposed —
  they describe what the owner wants, not who they are.

A **deliberately shared** profile is a different matter: `toBiodata` returns the
full sheet, because circulating something that shows almost nothing achieves
nothing. The gate there is the sharing decision plus consent, not the
projection.

## 7. What guests get

Wedding guests are not platform users. `POST /events/:id/invite` mints a signed
RSVP token and emails it; `GET/PUT /events/rsvp/:token` is public and addresses
exactly one invite. It grants no access to the event, the guest list, or anyone
else's reply.
