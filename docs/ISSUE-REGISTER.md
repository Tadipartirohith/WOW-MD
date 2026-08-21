# Issue register — `wow_issues` specification

Every item in the 115-page issues document, mapped to what the code does today
and what has to change. Status values:

| Status | Means |
| --- | --- |
| **new** | Nothing in the codebase covers this |
| **partial** | Exists, but does not match the specified rule |
| **done** | Already behaves as specified |

Phases are ordered so each one leaves the app in a working, verifiable state.

---

## Phase 1 — Vendor registration (spec §Vendor Portal – Registration Issues)

| # | Item | Status | Note |
| --- | --- | --- | --- |
| 1.1 | Remove Business Name from registration | partial | The form sends `displayName` labelled "Business name" for vendors. Label becomes "Name"; the business name moves to My Business. |
| 1.2 | Name required + letters/spaces only, trimmed, no digits or symbols | new | `displayName` is optional and unvalidated beyond length. |
| 1.3 | Email required + valid format, front and back | partial | Backend validates; the form has no client-side check. |
| 1.4 | Mobile exactly 10 digits, enforced in the form | partial | Backend takes E.164 (8–15 digits). Spec wants exactly 10 for this market, with the input refusing an 11th. |
| 1.5 | Password unchanged | done | — |

## Phase 2 — Vendor "My Business"

| # | Item | Status | Note |
| --- | --- | --- | --- |
| 2.1 | Category `Other` + conditional "Specify Category" | new | `VendorCategory` is a fixed six-value enum. |
| 2.2 | GST exactly 15 chars, GSTIN format, front and back | partial | Backend validates the GSTIN pattern; the form does not. |
| 2.3 | PAN exactly 10 chars, format, front and back | partial | Same. |
| 2.4 | Pricing fields present in the frontend | partial | `pricing` exists on the entity and in the DTO; the console form never renders it. |
| 2.5 | Portfolio must not block saving | partial | Backend already treats it as optional; the form must match and validate URLs only when supplied. |
| 2.6 | Business saves successfully | partial | Follows from 2.4/2.5. |
| 2.7 | Saved business appears in My Business | done | `GET /vendors/me` renders. |
| 2.8 | Business details view shows everything | partial | The console shows the edit form only; no read view. |
| 2.9 | Edit Business with the same validations | partial | `PUT /vendors/:id` exists; the UI has no explicit view→edit step. |

## Phase 3 — Business listing verification

| # | Item | Status | Note |
| --- | --- | --- | --- |
| 3.1 | Listing request reaches admin | done | Creating a listing raises a verification request. |
| 3.2 | Admin allocates rather than approves | partial | Allocation exists, but `PUT /admin/vendors/:id/approve` still lets an admin approve directly. That route must go. |
| 3.3 | Allocation considers verifier workload | partial | `GET /verification/workload` exists; the allocation UI does not surface or rank by it. |
| 3.4 | Verifier has Approve **and** Reject | done | `decide` takes approved/rejected/issue/additional_review. |
| 3.5 | Verifier portal shows complete business details | new | The queue shows the request, not the vendor's business record. |
| 3.6 | Approve flow updates status | done | — |
| 3.7 | Reject requires a reason | done | `decide` refuses a blank reason for anything but an approval. |
| 3.8 | Admin sees full verification history | partial | `history` is stored; no admin view renders it. |
| 3.9 | Only verification moves the business to verified | partial | Follows from 3.2. |

## Phase 4 — Vendor availability and slots

| # | Item | Status | Note |
| --- | --- | --- | --- |
| 4.1 | Slots carry start/end time | **new** | Today availability is one row per **day** with a capacity. The spec needs multiple time slots per day. |
| 4.2 | Rolling 3-month window, enforced backend-side | new | No window validation at all. |
| 4.3 | Slot status AVAILABLE/PENDING/BOOKED/BLOCKED/CANCELLED | new | Only capacity vs booked count. |
| 4.4 | `startTime < endTime`, no overlaps | new | — |
| 4.5 | Capacity separate from bookability | new | One confirmed booking takes the slot even when capacity is 20. |
| 4.6 | Delete only when AVAILABLE; never delete booked slots | new | — |
| 4.7 | Block a slot with an optional reason | partial | Capacity 0 blocks a day; no per-slot block, no reason. |
| 4.8 | Availability summary counters | new | — |
| 4.9 | Users see only available slots | new | — |
| 4.10 | Atomic reservation, no double booking | partial | The row lock exists at day level; it moves to the slot. |

## Phase 5 — Booking request and quotation

| # | Item | Status | Note |
| --- | --- | --- | --- |
| 5.1 | Booking carries event, date, slot, requirements | partial | Booking has `eventDate` and `notes` only. |
| 5.2 | Expected budget optional | new | — |
| 5.3 | Request Booking enabled only when mandatory fields are set | new | — |
| 5.4 | One active request per user+vendor+business+event+slot | new | Nothing prevents duplicates. |
| 5.5 | Re-request routes to the existing request | new | — |
| 5.6 | New request only after vendor cancellation | new | — |
| 5.7 | Quotation versions kept, never overwritten | done | Re-quoting supersedes and keeps history. |
| 5.8 | Accept / reject / re-quote | done | — |
| 5.9 | Vendor Bookings page with the seven sections | partial | Bookings live in the provider console; no sectioning. |
| 5.10 | Main-portal Bookings page is view/manage only | partial | Requests originate from the vendor page already. |

## Phase 6 — Payments and escrow gating

| # | Item | Status | Note |
| --- | --- | --- | --- |
| 6.1 | Advance → escrow | done | Milestone escrow exists. |
| 6.2 | Vendor cannot start before the advance | new | No start gate. |
| 6.3 | Second payment only after start confirmed | **partial** | Instalments are ordered, but nothing ties them to the work state. |
| 6.4 | Vendor cannot complete before the second payment | new | — |
| 6.5 | Final payment only after vendor completion | new | Completion currently releases everything held. |
| 6.6 | `COMPLETED_PENDING_FINAL_PAYMENT` state | new | — |
| 6.7 | Payment restriction matrix enforced backend-side | partial | Some of it; the work-state links are missing. |

## Phase 7 — Disputes

| # | Item | Status | Note |
| --- | --- | --- | --- |
| 7.1 | Both user and vendor can raise | done | `CASE_RAISE` is held by both. |
| 7.2 | Dispute links booking, payment milestone, evidence | partial | No milestone link, no attachments. |
| 7.3 | Escalate to in-person investigation | partial | Cases allocate to an officer; no "requires physical verification" branch. |
| 7.4 | Dispute statuses | partial | Missing `waiting_for_information` and `assigned`. |

## Phase 8 — Vendor portal shell

| # | Item | Status | Note |
| --- | --- | --- | --- |
| 8.1 | Navbar: drop Media and WOW Genie; add Availability, Notifications, Accounts | new | — |
| 8.2 | Vendor profile saves and redisplays | partial | The save works; the page does not re-render saved state. |
| 8.3 | Profile fields: name, gender, address, alternate mobile | new | — |
| 8.4 | Saved profile view + edit | new | — |
| 8.5 | My Profile under the email dropdown | new | — |
| 8.6 | Dashboard cards match the operational modules | partial | — |
| 8.7 | Notifications module | partial | Notifications exist in the API; no vendor page. |
| 8.8 | Accounts module with escrow position | new | — |

## Phase 9 — Agency portal

| # | Item | Status | Note |
| --- | --- | --- | --- |
| 9.1 | Agency address, contact, start date, optional pictures | partial | Address and start date are missing. |
| 9.2 | No agency actions on a claimed profile | **partial** | The service blocks writes; the UI still shows the buttons. |
| 9.3 | Client status filter All/Active/Deactivated | new | — |
| 9.4 | Chat opens the conversation after selecting a match | new | Reported broken. |
| 9.5 | Hide Vendors/Planners/Bookings/Events/Travel from agents, including by URL | partial | Nav is permission-filtered; agents still hold booking permissions. |

## Phase 10 — Client profile

Personal, religion, horoscope, marital, family and assets, education and
occupation, partner preferences, photos, Aadhaar. All **new** — the profile
today is display name, gender, date of birth, city, bio, photo URLs and a
preferences blob. This is the largest single phase and lands as a set of
related tables plus a sectioned profile form. Covers ENH-02 … ENH-10.

## Phase 11 — Consolidated enhancements

| # | Item | Status |
| --- | --- | --- |
| ENH-01 | Dashboard: role, completion checklist, locked-state guidance | partial |
| ENH-11 | Matches: filters, recently added, AI recommendations ≥ 50% | partial |
| ENH-12 | Chat dashboard, presence, in-app calling, number blocking | partial |
| ENH-13 | Honeymoon packages | new |
| ENH-14 | Marriage events management page | partial |
| ENH-15 | Event-specific vendor selection | new |

---

## Cross-cutting rules

Applied to every phase, from the closing section of the specification:

- The backend is the source of truth for permissions, completion, verification,
  privacy and ownership — the frontend only mirrors it.
- Sensitive identity, contact, income, family-asset and horoscope data never
  leaves its approved visibility scope.
- Every form validates on both sides and returns field-level errors.
- Every write persists across a refresh and shows immediately on success.
- Agent-created data keeps its attribution and consent history, and an agent
  can never overwrite a claimed profile.
- New fields arrive by additive migration so existing rows keep loading.
