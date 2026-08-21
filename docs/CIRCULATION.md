# Circulation and consent

How an agency actually works: a family walks in and hands over their details,
and the agent circulates the biodata looking for a match. This document covers
both halves — intake, and getting the profile in front of people.

Read it with [PROFILES-AND-INVITATIONS.md](PROFILES-AND-INVITATIONS.md), which
covers the profile/account split, and [RBAC-AND-ROLES.md](RBAC-AND-ROLES.md) for
the permission contract. [SLD §4](SLD.md#4-consent-and-circulation) puts both
in the context of the whole system.

## 1. Intake is phone-first

A walk-in family gives a mobile number far more often than an email address, and
plenty of clients never want a login at all — the agent is their whole
interface. So on an agency-built profile:

| Field | Required? | Why |
| --- | --- | --- |
| `contactPhone` | **yes** | How the agency reaches them, and the practical identity key |
| `contactEmail` | no | Only needed to invite them to claim the profile later |
| `consent` | **yes** | See §2 |

**Duplicate detection is by phone.** The same family shopping two agencies is
common, and the same biodata circulating from two agents is an embarrassment.
`ManagedProfilesService.assertNotDuplicate` refuses a second profile on a number
already in use — and phrases it neutrally when the clash is in another agency's
book, so the check does not leak who holds whom.

## 2. Consent, in two scopes

Agreeing that the agency may hold your details is **not** agreeing that they may
pass them around. Those are recorded separately:

| Scope | Covers | Expires? |
| --- | --- | --- |
| `INTAKE` | The agency holding and using the details internally | No |
| `CIRCULATION` | Sharing the profile outside the agency | Yes — `CIRCULATION_CONSENT_VALIDITY_DAYS`, default 365 |

Each record captures the method (in person, phone, written, digital), **who**
gave it and their relationship to the subject (in this market a parent very
often speaks for the person), their callback number, the date, the agent who
captured it, and free-text notes.

Records are **append-only**: a re-confirmation writes a new row, so there is a
history of what was agreed and when. Revoking sets `revokedAt`; it never
deletes.

```
POST /circulation/profiles/:id/consent      record or re-confirm
GET  /circulation/profiles/:id/consent      current state
GET  /circulation/profiles/:id/consent/history
DELETE /circulation/consent/:id             withdraw
GET  /circulation/consent/expiring          lapsing within 14 days
```

`ConsentService.assertMayCirculate` is the single gate. Every circulation path
calls it, and it is re-checked when a shared link is *opened*, not only when it
is created — so a withdrawal takes effect on links already in the wild.

A profile its own owner controls (`SELF` or `CLAIMED`) never needs an agency
consent record: they are sharing their own details.

## 3. Five ways to circulate

All five check consent, all five produce a **revocable record**, and none of
them grants more than read access.

| # | Route | For |
| - | --- | --- |
| 1 | `POST /circulation/share/agent` | Another approved agency, who can propose from their own book |
| 2 | `POST /circulation/share/user` | A family that already has an account and is looking themselves |
| 3 | `POST /circulation/share/link` | A family with no account — the WhatsApp biodata |
| 4 | `PUT /circulation/profiles/:id/pool` | The vetted-agent network, searchable by every approved agency |
| 5 | `GET /biodata/:token` (client route) | The same link rendered as a printable biodata sheet |

### What a share does and does not grant

| | Read the biodata | Edit it | Act as it (browse, send interests, book) |
| --- | :-: | :-: | :-: |
| Owner | ● | ● | ● |
| Steward (agent / family), while unclaimed | ● | ● | ● |
| Share recipient | ● | | |
| Approved agent, profile in the pool | ● | | |
| Anyone holding a live link | ● | | |

That separation is enforced in two different places on purpose:
`ProfileAccessService`-style read checks live in `SharingService`, while acting
as a profile stays with `MatchmakingService.resolveSubject` (own / steward /
admin only).

### Taking it back

```
DELETE /circulation/shares/:id              withdraw one
DELETE /circulation/profiles/:id/shares     withdraw everything at once
```

Withdrawing circulation consent additionally pulls the profile out of the
network pool immediately — leaving it listed would be exactly the thing the
family just asked us to stop.

`GET /circulation/profiles/:id/shares` answers "who has seen my client's
details?", including whether each link was ever opened and how often.

## 4. Cross-agent proposals

When two agencies each hold one side, the negotiation happens **between the
agents**, long before the families meet. That conversation hangs off the
existing interest record rather than introducing a parallel "proposal" object —
an interest already *is* the pairing.

```
GET  /circulation/proposals                 every pairing you are handling
GET  /circulation/proposals/:interestId     the thread, with both sides
POST /circulation/proposals/:interestId/notes
```

Access is "you control one of the two profiles" — its owner, or its steward.
An agent holding both sides has to say which side they are writing for, so the
transcript stays readable.

## 5. What each persona can do

| | Build profiles | Circulate | Browse the pool | Client accounts |
| --- | :-: | :-: | :-: | :-: |
| `agent` (approved) | ● | ● | ● | ● |
| `agent` (unapproved) | | | | |
| `family` | ● (capped) | ● | | |
| everyone else | | | | |

A family member looking after a relative can pass their biodata to an agent or
send it as a link, but has no business trawling other agencies' books — so
`NETWORK_POOL_BROWSE` is agent-only.

## 6. Privacy of the biodata itself

Two projections, deliberately different:

- **`PublicProfileView`** — what a stranger sees in match suggestions. Age band,
  no date of birth, photos only after a match.
- **`BiodataView`** — what a *deliberate share* delivers. Full photo set, exact
  age, community, education. The gate is the sharing decision plus consent, not
  the projection: circulating a profile that shows almost nothing achieves
  nothing.

Contact details are withheld in both. Brokering the introduction is the agent's
job, and the platform does not cut them out of it.

## 7. Verifying

```bash
docker run --rm --network docker_default -v "$PWD/scripts:/scripts" alpine:3.20 \
  sh -c "apk add --no-cache curl jq redis >/dev/null && sh /scripts/verify-circulation.sh"
```

73 live checks: phone-first intake, duplicate detection, consent gating in both
scopes, all five circulation paths, read-only enforcement on shares, withdrawal
pulling everything back, cross-agent threads, and the audit trail.

## 8. Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `CIRCULATION_CONSENT_VALIDITY_DAYS` | 365 | How long circulation consent stands before re-confirmation |
| `SHARE_LINK_TTL_DAYS` | 30 | Default lifetime of a biodata link |
| `MAX_MANAGED_PROFILES` | 200 | Per agent |
| `MAX_MANAGED_PROFILES_FAMILY` | 5 | Per family account |
| `REQUIRE_AGENT_APPROVAL` | true | Vet agencies before they can act for anyone |
