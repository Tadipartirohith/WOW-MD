# Issue register — `wow_issues` specification

Every item in the 115-page issues document, mapped to what the code does today.
Status values:

| Status | Means |
| --- | --- |
| **done** | Implemented and covered by a live assertion |
| **partial** | Implemented in part; what is missing is named |
| **deferred** | Needs something the platform does not yet have (named below) |

Live coverage referenced below comes from `scripts/verify-*.sh` — 618 assertions
against a running stack, plus 137 automated tests. See
[DOCKER-AND-TESTING.md](DOCKER-AND-TESTING.md) for how to run them.

---

## Phase 1 — Vendor registration

| # | Item | Status | Where |
| --- | --- | --- | --- |
| 1.1 | Remove Business Name from registration | done | The field is "Your name" for every account type; the business name lives on the listing. |
| 1.2 | Name required, letters and spaces only, trimmed | done | `NAME_PATTERN` in `common/util/identity-fields.ts`, applied to registration and to the profile. Checked in the form too. |
| 1.3 | Email required and valid, front and back | done | `Register.tsx` validates before the round trip; the server still decides. |
| 1.4 | Mobile exactly 10 digits | done | `MOBILE_PATTERN`; required for business accounts, optional for individuals. |
| 1.5 | Password unchanged | done | — |

## Phase 2 — Vendor "My Business"

| # | Item | Status | Where |
| --- | --- | --- | --- |
| 2.1 | Category `Other` + conditional "Specify Category" | done | `VendorCategory.OTHER` plus `otherCategory`, required only when the category is Other. |
| 2.2 | GST 15 characters, GSTIN format | done | `GSTIN_PATTERN`, both sides. |
| 2.3 | PAN 10 characters, format | done | `PAN_PATTERN`, both sides. |
| 2.4 | Pricing fields in the frontend | done | Starting price, unit and notes on the listing form. |
| 2.5 | Portfolio must not block saving | done | Optional; URLs validated only when supplied. |
| 2.6 | Business saves successfully | done | — |
| 2.7 | Saved business appears in My Business | done | — |
| 2.8 | Business details view shows everything | done | The console shows a record first; editing is a deliberate step. |
| 2.9 | Edit Business with the same validations | done | Same form, same rules. |

## Phase 3 — Business listing verification

| # | Item | Status | Where |
| --- | --- | --- | --- |
| 3.1 | Listing request reaches admin | done | — |
| 3.2 | Admin allocates rather than approves | done | `PUT /admin/vendors/:id/approve` was removed outright. |
| 3.3 | Allocation considers verifier workload | done | `GET /verification/workload`; the picker defaults to the lightest and ranks the list by open cases. |
| 3.4 | Verifier has Approve and Reject | done | — |
| 3.5 | Verifier portal shows complete business details | done | The queue expands to the record being verified, the applicant, and the history. |
| 3.6 | Approve flow updates status | done | — |
| 3.7 | Reject requires a reason | done | — |
| 3.8 | Admin sees full verification history | done | Rendered from `history` on the request. |
| 3.9 | Only verification moves the business to verified | done | Follows from 3.2. |

## Phase 4 — Vendor availability and slots

All **done**. `vendor_availability_slots` replaced the day-level table:
start/end times, capacity, per-slot status, block with a reason, and a rolling
three-month window computed per request rather than stored.

| # | Item | Where |
| --- | --- | --- |
| 4.1 | Slots carry start/end time | `VendorAvailabilitySlot` |
| 4.2 | Rolling 3-month window, enforced server-side | `assertWithinWindow` |
| 4.3 | Slot status AVAILABLE/PENDING/BOOKED/BLOCKED/CANCELLED | `SlotStatus` |
| 4.4 | `startTime < endTime`, no overlaps | `assertTimeOrder`, `assertNoOverlap` (back-to-back allowed) |
| 4.5 | Capacity separate from bookability | `booked < capacity` **and** status available |
| 4.6 | Delete only when untouched | `remove()` |
| 4.7 | Block with a reason | `block()` / `unblock()` |
| 4.8 | Availability summary counters | `summary()` |
| 4.9 | Users see only available slots | `listBookable()` — blocked and booked windows are absent, not greyed out |
| 4.10 | Atomic reservation, no double booking | `reserve()` takes a `pessimistic_write` lock inside the booking transaction |

## Phase 5 — Booking request and quotation

| # | Item | Status | Where |
| --- | --- | --- | --- |
| 5.1 | Booking carries event, date, slot, requirements | done | — |
| 5.2 | Expected budget optional | done | Deliberately optional: demanding a number from someone who does not have one produces a fictional one. |
| 5.3 | Request enabled only when mandatory fields are set | done | Slot and requirements. |
| 5.4 | One active request per user + vendor + slot | done | `DUPLICATE_BOOKING_REQUEST` |
| 5.5 | Re-request routes to the existing request | done | The refusal carries the existing booking id, and the client opens it. |
| 5.6 | New request only after cancellation | done | Follows from 5.4. |
| 5.7 | Quotation versions kept | done | — |
| 5.8 | Accept / reject / re-quote | done | — |
| 5.9 | Vendor Bookings page with sections | done | Seven sections, each a question the vendor has, in the order work moves. |
| 5.10 | Main-portal Bookings is view/manage only | done | Requests originate on the vendor page. |

## Phase 6 — Payments and escrow gating

All **done**. Money and work alternate, and the server is the judge:

| # | Item | Where |
| --- | --- | --- |
| 6.1 | Advance → escrow | `pay()` |
| 6.2 | Vendor cannot start before the advance | `startWork()` |
| 6.3 | Second payment only after start | `assertMilestoneAllowed` |
| 6.4 | Vendor cannot complete before the second payment | `completeWork()` |
| 6.5 | Final payment only after completion | — |
| 6.6 | `COMPLETED_PENDING_FINAL_PAYMENT` | `BookingStatus` |
| 6.7 | Payment restriction matrix enforced server-side | `ALLOWED` + `assertMilestoneAllowed`; the client mirrors it in `PAYABLE_AT` so buttons appear when they will work |

## Phase 7 — Disputes

| # | Item | Status | Where |
| --- | --- | --- | --- |
| 7.1 | Both user and vendor can raise | done | And **only** those two, plus admin — raising freezes escrow, so an unchecked booking id was a way to freeze a stranger's money. Now checked. |
| 7.2 | Dispute links booking, milestone, evidence | done | `milestone` and `evidence` on the case; more evidence can be added later. |
| 7.3 | Escalate to in-person investigation | done | `PUT /verification/cases/:id/escalate` sets `requiresPhysicalVerification` and records why. |
| 7.4 | Dispute statuses | done | `waiting_for_information` added — the clock being on a party rather than on the officer is a different state. |

## Phase 8 — Vendor portal shell

| # | Item | Status | Where |
| --- | --- | --- | --- |
| 8.1 | Navbar: drop Media and WOW Genie; add Availability, Notifications, Accounts | done | Vendors no longer hold `MEDIA_MANAGE_OWN` or `AI_ASSIST` — both belong to the couple planning the wedding, not the caterer they hired. |
| 8.2 | Vendor profile saves and redisplays | done | The save always worked; the cached copy was never invalidated, so the page redisplayed the pre-edit state. |
| 8.3 | Profile fields: name, gender, address, alternate mobile | done | `profiles.address` added; `contactPhone` is the alternate number. |
| 8.4 | Saved profile view + edit | done | — |
| 8.5 | My Profile under the email dropdown | done | With Security; both are about the account, not the work. |
| 8.6 | Dashboard cards match the operational modules | done | Plus live counters — unread, incoming bookings, money held. |
| 8.7 | Notifications module | done | Feed, unread count on the bell, mark-all-read. |
| 8.8 | Accounts module with escrow position | done | `GET /bookings/earnings` — held and released reported separately, with the ledger behind them. |

## Phase 9 — Agency portal

| # | Item | Status | Where |
| --- | --- | --- | --- |
| 9.1 | Agency address, contact, start date, pictures | done | — |
| 9.2 | No agency actions on a claimed profile | done | The server decides per row (`actions`) and the client renders that, rather than re-deriving the rule. |
| 9.3 | Client status filter All/Active/Deactivated | done | — |
| 9.4 | Chat opens the conversation after selecting a match | done | The picker wrote the same id into state whichever way the match ran, so half of all matches opened a conversation with yourself. Replaced by a conversation list. |
| 9.5 | Hide Vendors/Planners/Bookings/Events/Travel from agents, including by URL | done | The permissions were removed, not the menu entries — the route guard and the API both refuse. |

## Phase 10 — Client profile

**done.** `profile_details` plus siblings and assets, saved a section at a time,
with completion computed from what is stored rather than tracked as a flag.
Aadhaar verification hashes the number under a pepper and keeps only the last
four digits. Covers ENH-02 … ENH-10.

One correctness fix worth naming: `horoscopeAvailable` defaulted to `false`, so
a profile that had only had its name filled in already counted as having
answered the horoscope question. It is nullable now — false means somebody said
no.

## Phase 11 — Consolidated enhancements

| # | Item | Status | Note |
| --- | --- | --- | --- |
| ENH-01 | Dashboard: role, completion, locked-state guidance | done | With live counters per persona. |
| ENH-11 | Matches: filters, recently added, recommendations ≥ 50% | done | Eleven filters over indexed columns; recommendations are floored at 50 and return fewer rows rather than padding. |
| ENH-12 | Chat dashboard, presence, in-app calling, number blocking | done | Dashboard, unread counts, read receipts, presence and **in-app voice and video** — WebRTC signalling over the existing socket, media peer-to-peer. Number blocking is the existing redaction, applied before the write. A call that cannot traverse NAT says so; see the TURN note below. |
| ENH-13 | Honeymoon packages | done | Browse by budget and nights across destinations; picking one seeds an itinerary with a day per night. |
| ENH-14 | Marriage events management | done | Amend and remove; removal is refused while vendors are booked against the day. |
| ENH-15 | Event-specific vendor selection | done | A booking carries its event; each day lists who is booked for it. |

---

## Deferred, and why

Two items need something the platform does not have yet. Both are named rather
than quietly dropped:

- **TURN relays for the tail of calls (part of ENH-12).** Calling is built and
  works peer-to-peer, which covers most home and mobile networks. A symmetric
  NAT on either side needs a relay, and a relay costs money because it carries
  the audio. `TURN_URL` and its credentials are read from the environment and
  handed to the client on the offer, so enabling it is a deployment change.
- **Real escrow payout.** `RazorpayPaymentProvider.release` logs rather than
  transferring. Needs Razorpay Route, linked accounts, and per-vendor KYC. The
  commission split is computed and recorded correctly throughout; nothing moves
  until Route is configured.
- **Geography-aware officer allocation.** `region` is recorded on an officer and
  allocation still ranks purely by open workload. Doing it properly needs a
  service-area model that does not exist, and guessing at one would allocate
  worse than ignoring geography does.
- **Live Aadhaar verification** runs against a mock provider today. The
  interface, the OTP session, the hashing and the one-document-one-profile rule
  are all real and tested; `AADHAAR_PROVIDER=licensed` switches to a live
  provider once UIDAI credentials exist. Nothing about the stored data changes.

---

## Cross-cutting rules

From the closing section of the specification, applied throughout:

- The backend is the source of truth for permissions, completion, verification,
  privacy and ownership — the frontend only mirrors it.
- Sensitive identity, contact, income, family-asset and horoscope data never
  leaves its approved visibility scope.
- Every form validates on both sides and returns field-level errors.
- Every write persists across a refresh and shows immediately on success.
- Agent-created data keeps its attribution and consent history, and an agent can
  never overwrite a claimed profile.
- New fields arrive by additive migration so existing rows keep loading.
