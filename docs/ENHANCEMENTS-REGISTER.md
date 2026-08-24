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

## Reversals — these need a decision

### V1 — Services before a match is fixed

> ">> INDIVIDUAL USER SHOULD ABLE TO BOOK THE SERVICES EVEN MATCH IS NOT FIXED <<"
> — page 2

The platform locks the wedding marketplace until a match is fixed. That was the
earlier specification's rule, it is enforced in `assertServicesUnlocked`, and
`verify-rbac.sh` asserts a booking attempt returns 403 before the match is
fixed.

The good news: it is already behind `SERVICES_REQUIRE_MATCH_FIXED`, which exists
precisely because "an operator running the services side as a standalone
marketplace turns it off". So this is a **default change plus a test change**,
not surgery — but it is a change to what the product is, so it is your call
rather than mine.

### V2 — Vendors lose the Chat module

> "remove the separate Chat module. Chat belongs inside the individual booking."
> — section 32

This is vendor-scoped and consistent: a vendor's conversations are always about
a booking, and one thread per vendor gets confusing the moment the same vendor
has three jobs for three families. It does **not** conflict with the Chat work
just delivered, which was about agents and couples.

It does add rules that do not exist today: chat unlocks only once the advance is
paid, and locks to read-only once the booking completes.

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
| P8 | Surname **or** Last Name — only one should exist | decision | The previous specification said distinguish them, and that is what was built. This says remove one. Reversal of an item delivered last round |
| P9 | Family assets: estimated value of the property | done | `estimatedValue` already exists and is shown |
| P10 | Planner must reject past wedding dates | new | It accepts `05-11-2025` today |
| P11 | Planner tasks must not fall due before the wedding date | new | |
| P12 | Wedding dashboard: countdown, budget tracker by category, guest management, journey timeline, upcoming events | new | Large. The plan and tasks exist; none of this presentation does |
| P13 | Events: type, category, start/end time, expected guests, status, budget, description, image | partly done | An event has name, date and venue. The rest is new |
| P14 | Event cards with filters, search, grid/list, and **Select Vendors** per event | partly done | Per-event vendors exist; the presentation does not |
| P15 | Chat three-dot menu: view profile, search, mute, clear, **block**, **report**, delete conversation | new | Block and report are the substantial ones |
| P16 | **Partner preferences never reach the matchmaking engine** | new | Confirmed: `savePreferences` writes `profile_details.partnerPreferences`; `compatibility.engine` reads `profiles.preferences`. Two stores, never synchronised. The document's root-cause analysis is correct |
| P17 | "Recently added" in suggested matches not working | new | |
| P18 | Interest Accepted notification does not say **who** accepted | new | |
| P19 | Match card shows only name/city/age; profile is not clickable | new | |
| P20 | Matches page: filters left, recently uploaded centre, AI recommendations right with match % | partly done | Eleven filters and a ≥50% floor exist; the three-column layout does not |
| P21 | Honeymoon: "Create Plan" does not create a plan | new | Needs reproducing |
| P22 | Media: album cards, direct upload rather than URL, gallery, counts, progress, empty states | partly done | Presigned upload exists; the album UI is URL-driven |
| P23 | Support: photo attachment not working | partly done | The Support page built last round attaches through the same presigned upload; worth verifying against the reported case |

---

## Part 2 — Vendor and Admin portals (sections 1–64)

The largest part of the document, and the most architectural. Broadly: the data
model is closer than the document assumes, and the *lifecycle* is what is
missing.

### One vendor account, many businesses

| # | Item | Status | Note |
| --- | --- | --- | --- |
| B1 | One login, several businesses, each with its own `business_id` | **done** | A `vendors` row already *is* a business. Catalog, availability, bookings and verification all key on it |
| B2 | Independent verification per business | partly done | The model supports it; `raise()` does not — see the confirmed bug above |
| B3 | Business switcher changing the context of My Business, Catalog, Availability, Bookings, Transactions | new | |
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
| B13 | Vendor sees the exact reason for re-verification or rejection | partly done — findings and remarks are stored; the vendor cannot see them |
| B14 | Catalog stays manageable after the business is verified | done |
| B15 | Major catalog changes optionally go through admin review | new |

### Availability, bookings, payments

| # | Item | Status |
| --- | --- | --- |
| B16 | Availability a separate module with add/edit/delete/block/publish/view | done |
| B17 | Multiple slots per day, capacity, overlapping bookings within capacity | done |
| B18 | A request or quotation must not consume the slot | done |
| B19 | Slot spent on **vendor confirms** | done |
| B20 | Availability window 3 months → **6 months**, backend included | new — one constant, plus its assertions |
| B21 | Duplicate booking-request prevention per user + vendor | done |
| B22 | Booking request carries service, package, event, date, slot, requirements, guest count, budget | done |
| B23 | Quotation validity date and terms | new — amount, notes and line items exist |
| B24 | Accepted / Rejected quotation sections | partly done |
| B25 | Bookings module sections: New Requests, Quotations, Accepted, Active, Completed, Cancelled, Disputes | done |
| B26 | Payment ladder enforced backend-side | done |
| B27 | Booking chat, unlocked at advance, read-only after completion | new |
| B28 | Disputes raisable by both sides with evidence | done |
| B29 | Accounts: payment details, escrow, earnings, payouts, settlements, transaction history | partly done — payouts and settlements arrived last round |
| B30 | Notifications with deep links carrying `booking_id`, `business_id`, `quotation_id`, … | partly done — the payload carries ids; `target_module` / `target_action` are new |
| B31 | Vendor dashboard as a summary, every card linking onward | partly done |
| B32 | Final vendor navbar; remove Chat, Media, WOW Genie | partly done — Media and Genie are already gone for vendors; Chat is not |

### Admin portal

| # | Item | Status |
| --- | --- | --- |
| B33 | Admin navbar: Dashboard, Users, Agents, Vendors, Bookings, Honeymoon, Verification, In-Person Accounts, Accounts, Notifications, Support, Reports | partly done — one Admin page today |
| B34 | Admin dashboard: 15 counters plus a recent-activity feed | partly done — analytics exist, the feed does not |
| B35 | Admin Users, Agents, Vendors sections with the listed detail views | new |
| B36 | Admin Bookings: global view across 13 stages | new |
| B37 | Admin Verification across 8 states, both applicant types | done |
| B38 | In-person officer accounts with assigned area | done — service areas landed last round |
| B39 | Separate in-person portal, with what an officer cannot do | partly done — the permissions are right; the portal is a section of one page |
| B40 | Workload allocation table, inactive officers excluded | partly done — inactive exclusion needs checking |
| B41 | Allocation as a real transaction: validate, save, update workload, notify, commit | done |
| B42 | Officer submits a result; admin decides | done |
| B43 | Support statuses: OPEN → TRIAGED → ASSIGNED → IN_PROGRESS → WAITING_FOR_INFORMATION → RESOLUTION_SUBMITTED → ADMIN_REVIEW → RESOLVED → CLOSED | partly done — several exist; TRIAGED, RESOLUTION_SUBMITTED, ADMIN_REVIEW, REASSIGNED do not |
| B44 | **Resolved ≠ Closed** | new |
| B45 | Support audit trail | done |
| B46 | Admin Accounts kept separate from In-Person Accounts | new |
| B47 | Reports across users, agents, vendors, bookings, financial, verification | new |
| B48 | `vendor_id` for the account, `business_id` for everything business-specific | done |
| B49 | Backend verifies the authenticated vendor owns the `business_id` | done |

---

## Part 3 — Minutes of meeting (12 decisions)

Nine of these are new, and three restate Part 2.

| # | Decision | Status | Note |
| --- | --- | --- | --- |
| M1 | Availability 3 → 6 months | new | Small |
| M2 | Agent profile-sharing limit reviewed so users get enough relevant profiles | decision | There is a network-pool quota today. Changing it is a product call, and the document says "review", not a number |
| M3 | **Settle My Payment** — a settlement request routed through admin, then an officer | new | Distinct from the settlement that already resolves a dispute |
| M4 | Admin allocates a verification officer to an issue | done | |
| M5 | Officer investigates, records findings, closes | done | |
| M6 | **72-hour verification SLA**, backend-controlled | new | Needs `verification_submitted_at`, `officer_allocated_at`, `verification_started_at`, `verification_completed_at`, `sla_deadline` |
| M7 | SLA breach → rejected/expired, vendor notified, may create a new listing | new | The document asks explicitly that the final status name be standardised |
| M8 | New business listing under the same account after rejection | partly done | See B1 and the confirmed bug |
| M9 | **Push notifications** for all four personas | new | Needs a push provider |
| M10 | **WhatsApp notifications**, opt-in only | new | Needs a WhatsApp Business provider and DLT-registered templates |
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

Two need a decision before they are built: V1 (services before a match is fixed)
and P8 (surname *or* last name, reversing what was delivered last round).
