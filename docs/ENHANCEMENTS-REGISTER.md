# Enhancements register — `WOW_enh`

The 91-page enhancements document, surveyed against the code before anything is
built — so the size and shape of the work are visible up front, and so the
places where it **reverses** a decision already implemented are named rather
than quietly applied.

The two earlier registers are [ISSUE-REGISTER.md](ISSUE-REGISTER.md) (115 pages)
and [NEW-ISSUE-REGISTER.md](NEW-ISSUE-REGISTER.md) (74 pages).

| Status | Means |
| --- | --- |
| **done** | Already built, and covered by a live assertion |
| **partly done** | The mechanism exists; what is missing is named |
| **new** | Not built |
| **decision** | Needs a call before it can be built |

This document is roughly three documents in one: a list of application defects
that largely repeats the previous specification, a full re-specification of the
vendor and admin portals, and the minutes of a meeting adding nine items nobody
had raised before. They are separated below because their sizes are very
different.

---

## Found while surveying: a confirmed bug

**A vendor account with two businesses gets one verification request, and the
first business loses it.**

`VerificationService.raise` is idempotent per *applicant*, not per *business*.
When a second business is submitted while the first is still open, the existing
request is not left alone — its `subjectId` is **repointed** to the new
business:

```ts
if (open) {
  if (subjectId && open.subjectId !== subjectId) {
    open.subjectId = subjectId;   // the first business's request, reassigned
    await this.requests.save(open);
  }
  return open;
}
```

Reproduced against the running stack: one vendor account, two businesses, and
afterwards exactly one verification request pointing at the second. The first
business has no request at all — it cannot be verified, it is not in anybody's
queue, and nothing anywhere says so. If the first had already been allocated to
an officer, that officer's visit silently becomes a visit to a different
business.

This was defensible while a vendor account meant one business. Section 1 of this
document makes multiple businesses the model, which turns it into a
data-integrity bug. It needs fixing regardless of how much else gets built.

---

## Reversals — decided

### V1 — Services before a match is fixed — **applied**

> ">> INDIVIDUAL USER SHOULD ABLE TO BOOK THE SERVICES EVEN MATCH IS NOT FIXED <<"
> — page 2

The platform locked the wedding marketplace until a match was fixed, and
`verify-rbac.sh` asserted a booking attempt returned 403 before then.

**Decision: open it.** The reasoning is commercial and it is decisive: the
platform's revenue is vendor bookings, not matchmaking. A match fixed at home —
which is how most of them are fixed — is still a couple with a wedding to buy,
and holding the shop closed against them protects a funnel they were never in
while turning away the customer who pays.

`SERVICES_REQUIRE_MATCH_FIXED` now defaults to `false`. The gate itself is kept,
not deleted, so an operator who does want matchmaking to be the front door still
has it — and when it is on it behaves exactly as before, checked against the
client the booking is for rather than the person clicking.

Two things had to move with the default, and one of them was a bug waiting to
happen: `/matches/status` reported `servicesUnlocked` from the fixed match alone,
so with the gate off the dashboard would have told a buyer they were locked out
of a marketplace that would have taken their booking. It now reports what the
marketplace will actually accept. The onboarding copy follows the same value
rather than asserting the old rule.

*(This entry previously recorded the opposite decision. It was reversed on the
business reasoning above, which is the correct call — a divergence taken to
protect a funnel is not worth the bookings it costs.)*

### V2 — Vendors lose the Chat module — **applied**

> "remove the separate Chat module. Chat belongs inside the individual booking."
> — section 32

Vendor-scoped and consistent: a vendor's conversations are always about a
booking, and one thread per vendor gets confusing the moment the same vendor has
three jobs for three families. It does **not** conflict with the Chat work
delivered last round, which was about agents and couples.

It adds two rules that do not exist today: chat unlocks only once the advance is
paid, and locks to read-only once the booking completes.

### P8 — Surname and Last Name — **collapse to one**

The previous specification asked for the two to be distinguished, and that is
what was built. This one asks for a single field.

**Decision: collapse.** `surname` is dropped from the form; `lastName` is the
one name field. Existing surname values migrate into `lastName` where it is
empty, so nobody loses a name they had entered — and where both were filled in,
the last name is kept because that is the one on the documents.

---

## How the rest was decided

- **Sequencing:** straight through, in the document's own order, committed in
  phases.
- **Third-party integrations** (AI-image detection, push, WhatsApp): built the
  way Aadhaar and payments were — a real provider behind an interface, a mock
  that mirrors the real rule as the default, activating on configuration.

---

## Part 1 — Application issues (pages 1–19)

Most of this repeats the previous specification and is already built. What is
genuinely new is separated out.

### Already delivered

| Item | Status |
| --- | --- |
| 1. Biodata photos not maintained | done |
| 2. Mobile number validation, OTP, verified status | done |
| 3. Surname / Last Name showing the same value | done |
| 4. Saved details not displayed | done |
| 5. Planner / Wedding Planner duplication | done |
| 6. Wedding planner zero/invalid dates | done |
| 7. Events RSVP tracking dashboard | done |
| 8. Events RSVP guest details, and the route to vendors | done |

### New in this document

| # | Item | Status | Note |
| --- | --- | --- | --- |
| P1 | **AI-generated photos must be rejected** | new | Platform-wide: user, agent and vendor profile photos, biodata, galleries. Backend-enforced, not a disabled button. Needs a detection provider — the same shape as the Aadhaar and payment providers |
| P2 | Upload 3 photographs before Personal Details can continue | new | A gate on section order |
| P3 | Biodata saves into a **card** — Edit, View Complete Profile, Upload Photos, Delete Profile | new | The read-back view exists; the card and its four actions do not |
| P4 | Marital status "Divorced" reveals a descriptive reason field | new | Optional, and privacy-handled |
| P5 | Native Place moves from Personal Details to **Family Details** | new | Place of Birth removed from Personal Details entirely |
| P6 | **Mobile Number** on every relevant biodata section, not just the alternate | partly done | The contact block returns both; the sections do not all show it |
| P7 | Section-by-section navigation with Next/Continue, redirecting rather than scrolling | new | The accordion is one long page today |
| P8 | Surname **or** Last Name — only one should exist | decided | Collapse to `lastName`, migrating existing surnames where the last name is empty. See above |
| P9 | Family assets: estimated value of the property | done | `estimatedValue` already exists and is shown |
| P10 | Planner must reject past wedding dates | new | It accepts `05-11-2025` today |
| P11 | Planner tasks must not fall due before the wedding date | new | |
| P12 | Wedding dashboard: countdown, budget tracker by category, guest management, journey timeline, upcoming events | **done** | One read model rather than four fetches joined in the client. Budgeted comes from the events, committed from the bookings grouped by what the vendor does, and the gap between them is the only figure anybody wants |
| P13 | Events: type, category, start/end time, expected guests, status, budget, description, image | partly done | An event has name, date and venue. The rest is new |
| P14 | Event cards with filters, search, grid/list, and **Select Vendors** per event | partly done | Per-event vendors exist; the presentation does not |
| P15 | Chat three-dot menu: view profile, search, mute, clear, **block**, **report**, delete conversation | new | Block and report are the substantial ones |
| P16 | **Partner preferences never reach the matchmaking engine** | new | Confirmed: `savePreferences` writes `profile_details.partnerPreferences`; `compatibility.engine` reads `profiles.preferences`. Two stores, never synchronised. The document's root-cause analysis is correct |
| P17 | "Recently added" in suggested matches not working | new | |
| P18 | Interest Accepted notification does not say **who** accepted | new | |
| P19 | Match card shows only name/city/age; profile is not clickable | new | |
| P20 | Matches page: filters left, recently uploaded centre, AI recommendations right with match % | partly done | Eleven filters and a ≥50% floor exist; the three-column layout does not |
| P21 | Honeymoon: "Create Plan" does not create a plan | **done** | Reproduced. The itinerary DTO required at least one day, so the button — which posts a title and an empty list, because the point is to start a plan and fill it in — was refused every single time |
| P22 | Media: album cards, direct upload rather than URL, gallery, counts, progress, empty states | **done** | Albums are cards with a cover and a count, photographs are chosen from the device, and what you see is the picture. Deleting a photograph or an album is new — a gallery you cannot remove anything from is not one |
| P23 | Support: photo attachment not working | **done** | Reproduced, and it was worse than reported — see below. Also gains a document route, because a support attachment is as often an invoice as a photograph |

---

## Part 2 — Vendor and Admin portals (sections 1–64)

The largest part of the document, and the most architectural. Broadly: the data
model is closer than the document assumes, and the *lifecycle* is what is
missing.

### One vendor account, many businesses

| # | Item | Status | Note |
| --- | --- | --- | --- |
| B1 | One login, several businesses, each with its own `business_id` | **done** | A `vendors` row already *is* a business. Catalog, availability, bookings and verification all key on it |
| B2 | Independent verification per business | **done** | `raise()` now keys on the business. Fixed with the confirmed bug above |
| B3 | Business switcher changing the context of My Business, Catalog, Availability, Bookings, Transactions | **done** | In the header, not per page — the per-page selector on Availability disagreed with everything else |
| B4 | Every business-specific API validates `business_id` ownership | done | `assertOwner` / `ownedService` / `ownedProviderIds` throughout |
| B5 | Vendor profile ≠ business listing; saved data displays after save | done | Delivered last round |

### The business lifecycle — the substantial new work

| # | Item | Status |
| --- | --- | --- |
| B6 | States: DRAFT → READY_FOR_REVIEW → FIRST_REVIEW → PENDING_VERIFICATION → VERIFICATION_IN_PROGRESS → APPROVED → VERIFIED → LIVE | new |
| B7 | REVERIFICATION_REQUIRED as a distinct branch from REJECTED | new |
| B8 | REJECTED → LOCKED → archive, and create a new business instead | new |
| B9 | Completion check across Business Details / Catalog / Documents / Portfolio, gating Submit Verification in **both** frontend and backend | new |
| B10 | First Review screen, with Go Back & Edit / Submit Verification | new |
| B11 | Business + catalog **locked** on submission, enforced by the update API | new |
| B12 | Locked again after approval; legal changes go through re-verification | new |
| B13 | Vendor sees the exact reason for re-verification or rejection | **done** — shown on My Business, read from the owner-only route |
| B14 | Catalog stays manageable after the business is verified | done |
| B15 | Major catalog changes optionally go through admin review | new |

### Availability, bookings, payments

| # | Item | Status |
| --- | --- | --- |
| B16 | Availability a separate module with add/edit/delete/block/publish/view | done |
| B17 | Multiple slots per day, capacity, overlapping bookings within capacity | done |
| B18 | A request or quotation must not consume the slot | done |
| B19 | Slot spent on **vendor confirms** | done |
| B20 | Availability window 3 months → **6 months**, backend included | **done** |
| B21 | Duplicate booking-request prevention per user + vendor | done |
| B22 | Booking request carries service, package, event, date, slot, requirements, guest count, budget | done |
| B23 | Quotation validity date and terms | **done** — and the booking records which quotation it was struck on |
| B24 | Accepted / Rejected quotation sections | partly done |
| B25 | Bookings module sections: New Requests, Quotations, Accepted, Active, Completed, Cancelled, Disputes | done |
| B26 | Payment ladder enforced backend-side | done |
| B27 | Booking chat, unlocked at advance, read-only after completion | **done** |
| B28 | Disputes raisable by both sides with evidence | done |
| B29 | Accounts: payment details, escrow, earnings, payouts, settlements, transaction history | partly done — payouts and settlements arrived last round |
| B30 | Notifications with deep links carrying `booking_id`, `business_id`, `quotation_id`, … | **done** — `targetModule`/`targetAction`/`targetId`, from a total map keyed on the type |
| B31 | Vendor dashboard as a summary, every card linking onward | **done** — a per-business row following the header switcher |
| B32 | Final vendor navbar; remove Chat, Media, WOW Genie | **done** — Chat is now inside the booking |

### Admin portal

| # | Item | Status |
| --- | --- | --- |
| B33 | Admin navbar: Dashboard, Users, Agents, Vendors, Bookings, Honeymoon, Verification, In-Person Accounts, Accounts, Notifications, Support, Reports | **done** — sections, split by the question being asked rather than by the table the answer comes from |
| B34 | Admin dashboard: 15 counters plus a recent-activity feed | **done** — the feed is the ordinary life of the platform, distinct from the audit trail |
| B35 | Admin Users, Agents, Vendors sections with the listed detail views | **done** — searchable directory, and one account opening with everything hanging off it |
| B36 | Admin Bookings: global view across 13 stages | **done** |
| B37 | Admin Verification across 8 states, both applicant types | done |
| B38 | In-person officer accounts with assigned area | done — service areas landed last round |
| B39 | Separate in-person portal, with what an officer cannot do | **done** — officers work from Verification; their accounts are listed apart from administrators, and only theirs carry a workload |
| B40 | Workload allocation table, inactive officers excluded | **done** — checked: both the case and the verification allocator filter on `isActive`. The staff list reports visits and cases as two numbers, because six of each is not the same amount of work |
| B41 | Allocation as a real transaction: validate, save, update workload, notify, commit | done |
| B42 | Officer submits a result; admin decides | done |
| B43 | Support statuses: OPEN → TRIAGED → ASSIGNED → IN_PROGRESS → WAITING_FOR_INFORMATION → RESOLUTION_SUBMITTED → ADMIN_REVIEW → RESOLVED → CLOSED | **done** — and the officer now *proposes* a settlement rather than making it. An officer who both finds the facts and releases the escrow is one person deciding a payment dispute alone |
| B44 | **Resolved ≠ Closed** | **done** — resolved is the platform's decision, closed is the complainant accepting it, and they have separate timestamps |
| B45 | Support audit trail | done |
| B46 | Admin Accounts kept separate from In-Person Accounts | **done** |
| B47 | Reports across users, agents, vendors, bookings, financial, verification | **done** — one route, six kinds, one window handled once |
| B48 | `vendor_id` for the account, `business_id` for everything business-specific | done |
| B49 | Backend verifies the authenticated vendor owns the `business_id` | done |

---

## Part 3 — Minutes of meeting (12 decisions)

Nine of these are new, and three restate Part 2.

| # | Decision | Status | Note |
| --- | --- | --- | --- |
| M1 | Availability 3 → 6 months | **done** | Same item as B20 |
| M2 | Agent profile-sharing limit reviewed so users get enough relevant profiles | decision | There is a network-pool quota today. Changing it is a product call, and the document says "review", not a number |
| M3 | **Settle My Payment** — a settlement request routed through admin, then an officer | **done** | Raised as a support case rather than as a pipeline of its own — it needs exactly the routing the desk already has. Not a dispute: nothing freezes, because freezing a provider's escrow would punish them for asking |
| M4 | Admin allocates a verification officer to an issue | done | |
| M5 | Officer investigates, records findings, closes | done | |
| M6 | **72-hour verification SLA**, backend-controlled | new | Needs `verification_submitted_at`, `officer_allocated_at`, `verification_started_at`, `verification_completed_at`, `sla_deadline` |
| M7 | SLA breach → rejected/expired, vendor notified, may create a new listing | new | The document asks explicitly that the final status name be standardised |
| M8 | New business listing under the same account after rejection | partly done | See B1 and the confirmed bug |
| M9 | **Push notifications** for all four personas | **done** | Provider behind an interface, `log` by default, FCM on configuration. Registering a device is the consent; a token claimed by another account moves, because it belongs to an installation rather than to a person |
| M10 | **WhatsApp notifications**, opt-in only | **done** | Opt-in never inferred from having a phone number, and template-only: five approved templates covering money and jobs. A type with no template does not go out that way rather than being sent as free text the API would refuse |
| M11 | AI-generated images restricted platform-wide | new | Same item as P1 |
| M12 | All critical rules enforced backend-side | done | This has been the standing rule throughout |

---

## What this adds up to

Counting only what is genuinely new or partly done:

| Area | Items | Weight |
| --- | --: | --- |
| Application defects and UI (Part 1) | 20 | Medium — P12 and P16 are the substantial ones |
| Business lifecycle (B6–B15) | 10 | **Large.** A state machine, locking, first review, re-verification |
| Vendor portal remainder | 8 | Medium |
| Admin portal (B33–B47) | 12 | **Large.** Most of an admin console |
| MoM items | 9 | Medium, plus two external providers |

Three items need a third party the platform does not have: AI-image detection,
push notifications, and WhatsApp. Each can be built the way Aadhaar and payments
were — a real provider behind an interface, activating on configuration.

Both decisions are taken: V1 **is** applied — the marketplace no longer waits
for a fixed match, because the bookings are the revenue and most matches are
fixed elsewhere — and P8 collapses the two name fields into one.

---

## Found while building

Things the document did not report, surfaced by working through it. Each is
recorded because "we were told about it" is not the only reason a defect
matters.

| Found | What it was |
| --- | --- |
| Multi-business verification | `raise()` repointed one request at whichever business was newest, so a vendor's first listing could never be verified. Two more instances of the same mistake turned up in `activateApplicant` and `decide` |
| Partner preferences | Written to `profile_details`, read from `profiles`. The document diagnosed this one correctly; fixing it introduced a stale-cache bug that the suite caught |
| Public vendor rows | `GET /vendors/:id` and `/vendors/search` are unauthenticated and returned the whole row: PAN, GST, registered address, compliance document links, payout account — and, after the lifecycle work, the officer's refusal reasoning |
| Quotation supersede order | A re-quote refused for a past validity date had already superseded the live offer, leaving the buyer nothing to accept |
| Event times | An end before a start surfaced a database constraint as a 500 |
| `PENDING_PAYOUT` | Money in that state was in no earnings bucket, so it vanished from every total |
| Silent assertions | `verify-rbac.sh` had its own idiom; an assertion copied in from another suite called an undefined helper, and the run still reported green |
| Frontend tests in CI | The `frontend` job ran typecheck and build and never the tests — including the one that fails when the client's permission mirror drifts from the server enum |
| A case parked on a complainant did not read as open | `hasOpenCaseFor` listed the states that counted and WAITING_FOR_INFORMATION was not among them, so a booking frozen by a case awaiting a receipt could be completed or cancelled out from under it — unfreezing money an officer was still deciding about. The list is now derived as the complement of "finished" |
| Findings could mark a case decided | `RecordFindingsDto.status` accepted any `CaseStatus`, so an officer writing up their visit could set RESOLVED on the way past and skip the administrator entirely |
| `"false"` meant yes | The application validates with implicit conversion, which turns any non-empty string into `true` for a boolean field. Harmless on a page filter; on `isActive` it meant an administrator posting `"false"` reinstated the account they meant to suspend, and on `allowsCirculation` it meant consent to circulate somebody's biodata could be manufactured from the word "no". The three fields where a person is on the other end now use `StrictBoolean` |
| Suites could not run back to back | The throttle-clearing preamble was guarded on `redis-cli` being present, and the runner image never installed it — so the guard silently did nothing and a second run in the same minute failed with 429s that read like real defects. The runner now installs it |
| **Every URL field refused the platform's own uploads** | `@IsUrl({ require_protocol: true })` also requires a top-level domain. The presign hands back `http://localhost:3000/…` in development and `http://minio:9000/…` self-hosted, so every field that stored an uploaded file — photographs, portfolios, event images, chat media, dispute and case evidence — refused the URL the platform had just issued for it. It survived because the suites post literal `https://cdn.example.com/…` strings, which do have a TLD: nothing ever fed a real presigned URL back in the way a browser does. This is what "attaching a photo to a support case does not work" actually was |
| Disputes asked for invoices and offered a URL box | The evidence field said "photographs, invoices, message screenshots" and then gave a box for a link, so proof had to be uploaded somewhere else first. Almost nobody does that, and disputes arrived as prose that an officer then decided on |
