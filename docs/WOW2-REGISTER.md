# wow2.pdf — the stale-read defect, and the workflow desyncs behind it

## The one that has been reported since the beginning

**Values written to the database did not appear in the UI. The cause was a
Redis copy of the profile row with thirteen writers and one invalidation.**

`UsersService.getByUserId` cached the profile for five minutes. Exactly one
place in the codebase knew to clear that cache: `upsert`, four lines below it.
Thirteen other files write to the `profiles` table — identity submission,
Aadhaar verification, the match lifecycle, agency stewardship, invitations,
claim requests, consent, sharing, officer allocation, the scheduled jobs, and
the session-start timestamp added last round. Every one of them left a stale
copy behind.

What that looked like from the outside: verify your identity, watch the identity
endpoint report it confirmed, reload the page, and be told you are unverified.
For five minutes. With nothing to explain it and nothing to do about it but
wait.

Reproduced before it was fixed, on a live stack:

```
the identity endpoint, read straight from the row:
  {"verifiedAt":"2026-08-30T14:34:51.501Z","last4":"3619"}
the same fact, read through /users/me:
  idVerifiedAt = null
>>> STALE. The database says verified. /users/me says it is not.
```

**The cache is gone, not patched.** It saved one indexed lookup on page load and
cost correctness across thirteen writers, and any fix that leaves it in place is
one new writer away from the same bug. If profile reads ever become a real
bottleneck, the version to write is one that cannot be forgotten — a TypeORM
entity subscriber on `Profile` — not a fourteenth `del` at a fourteenth call
site. Two hand-rolled invalidations that existed to compensate for it were
removed with it.

A second, smaller instance of the same shape was fixed alongside: editing your
biodata did not drop the match suggestions computed from it, so a family could
correct their religion and be shown scores calculated from what they had just
changed.

---

## The scoring engine was reading a table nobody writes

The document is right, and the consequence is larger than it looks.

`profiles.preferences` is written by `PUT /users/me/profile`. The biodata form
does not call it. So for every profile built the way the product actually asks
people to build one — through the sectioned biodata — religion, education,
lifestyle and the preferred age range were all absent, scored zero, and dragged
the total down. Age and location were the only dimensions that could ever score,
which caps a perfect match at about a third of the available weight. Two
families who agreed on every count could land in the thirties.

Three changes, all in `compatibility.engine.ts`:

**It reads `profile_details` first**, falling back to the old blob so
agency-built profiles with no biodata still score on what they have.

**Caste and mother tongue are scored**, which they never were. Both are asked
before anything else in this market.

**Only what can be judged is counted.** The old version divided by the full
weight of every dimension whether or not there was anything to compare — so a
pair who had simply not recorded a mother tongue were marked down for it,
exactly as if they had recorded different ones. Absence of evidence is not
evidence of incompatibility.

A fourth thing fell out of it: preferences are now checked **both ways**.
Scoring only whether the other side fits *your* stated window meant the same
pair scored differently depending on which of them was browsing.

---

## Everything else, item by item

| # | Item | Status |
| --- | --- | --- |
| W1 | Vendor verification deadlocked on "A draft listing cannot be approved" | **done** — `POST /vendors` raised a verification request the moment the row was written, while the business was still DRAFT. The officer visited, wrote up findings, recommended approval, and the administrator was refused — two systems each correct on their own and disagreeing about what stage the vendor was at. The request now belongs to submission, where the lifecycle raises it *and* moves the business in one step. **The validation stays**; it was telling the truth |
| W2 | My Clients showed only claimed profiles | **done** — it listed *accounts*, so a profile built at the counter and not yet invited could not appear at all. It lists profiles now and attaches the account where there is one. Claim status decides what an agent may *do* with a client, not whether the client is on their own list |
| W3 | No Ignore on Shared With Me | **done** — kept apart from the sharer's revoke: two different people making two different decisions. The original profile is untouched and the sharing agency is never told |
| W4 | Network Pool offered profiles with a fixed match | **done** — checked against the interest rather than a flag, so unfixing a match returns the profile to the pool with nothing to remember to reset. Inactive profiles are excluded too |
| W5 | Vendor listing refused when Per and Pricing notes were filled in | **done** — the form has always offered both and the DTO accepted neither, and unknown properties are rejected outright, so the whole listing failed to save. Anyone who typed into the box lost the listing; anyone who left it empty did not |
| W6 | Planner verification never reached the admin queue | **done** — the applicant-type column has carried `planner` since the verification schema was written and the TypeScript enum never listed it, so no code could produce one. A planner saved their listing, was told it was awaiting review, and appeared in nobody's queue. Saving now raises a request, idempotently, and a decision on it approves or refuses the listing |
| W7 | Managing Profile For / Relationship with User on the profile page | **done** — two fields, not one "User type", on the steward's own profile. The relationship is a closed list with free text after "Other", because free text alone produced forty spellings of "father" and a list alone loses "maternal uncle" |
| W8 | Family-shared profiles should appear in Match Recommendations, labelled | **done** — shown first and labelled "Shared by family member". A relative who knows both sides is a different kind of recommendation from a percentage, and a share was previously reaching Shared With Me, a screen an individual does not have |
| W9 | Events: vendors redirect, and RSVP tracking | **done** — the counts are on every day now, not only the one selected, and the vendors link is on each day's row. Answering "how many are coming to the sangeet" took a click per day |
| W10 | Compatibility engine uses the wrong data source | **done** — see above |
| W11 | Call is not visible in chat | **done** — the buttons were hidden whenever the other side was offline, which for most people most of the time meant the chat had no calling in it at all. Shown always, disabled with the reason |
| W12 | View Profile should show who manages the profile | **done** — at the foot, where it reads as provenance. An agency listing and a father running his daughter's profile looked identical before |
| W13 | WOW Genie's answer is wrong | **done** — it echoed the question back with a note about an environment variable. Somebody asked how to plan for thirty guests and was told about `AI_PROVIDER`. It answers properly now, from a knowledge file that shares the budget table with the panel beside it, so the two cannot disagree. Where it does not know, it says what it can help with rather than inventing |

---

## What changed in the suites, and why

Three assertions were rewritten rather than made to pass, and it is worth being
explicit about which:

- **`verify-phase1` / `verify-phase4`** asserted that creating a vendor listing
  queued a visit. That was the bug. They now assert the opposite — a draft is
  not in anybody's queue — and submit before expecting a request.
- **`verify-phase4`** asserted that `minScore=99` returned an empty list. With
  a dimension neither side stated no longer counting against them, a pair can
  legitimately reach 99, so "nobody scores this high" is no longer a safe proxy
  for "the filter ran". It now asserts every returned row meets the floor.
- **`verify-phase4`** tested request idempotency by editing a business. A
  submitted business is locked, which is the point of submitting, so it tests
  re-submission instead — which is the operation that used to duplicate.

## Verification

`scripts/verify-wow2.sh` — 43 live assertions across eight sections, the first
of which reproduces the stale-read defect end to end and proves it gone.

Whole platform, from the running stack: **nine suites, 1470 live assertions,
zero failures**, plus 191 backend unit tests, 28 e2e, 7 frontend.
