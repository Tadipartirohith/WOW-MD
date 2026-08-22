# Issue register — `new_wow_issues` specification

The 74-page follow-up document, item by item, checked against what the code on
`main` actually does today. This is the *survey*, written before any of it is
built, so that the size and the shape of the work are visible up front — and so
that the two places where this specification **reverses** a decision already
implemented from the previous one are flagged rather than quietly applied.

The earlier document's register is [ISSUE-REGISTER.md](ISSUE-REGISTER.md).

| Status | Means |
| --- | --- |
| **open** | Not built. Confirmed absent by reading the code. |
| **partial** | Something exists; what is missing is named. |
| **works** | Already satisfied; the reported symptom has another cause, named. |
| **conflict** | Contradicts a rule implemented from the previous specification. Needs a decision before it can be built. |

---

## Two reversals that need a decision first

### R1 — Agent access to a claimed profile (spec pp. 61–63)

The new document requires that after `Claimed by Owner` the agent **retains**
photos, reach, circulate, pause, close, delete and resend-invite, and that
claiming must not disable the agent's circulation permission.

The code deliberately does the opposite. `ManagedProfilesService.agencyActions`
([managed-profiles.service.ts:404](../backend/src/modules/agents/managed-profiles.service.ts#L404))
returns every capability as `!claimed && !archived`, `remove()` refuses outright
on a claimed profile, and the client renders that server-computed answer rather
than re-deriving it. That was built to satisfy item 9.2 of the previous
specification — *"No agency actions on a claimed profile"* — and it is the rule
the whole claim flow is designed around: claiming is described throughout as the
moment the subject takes ownership.

Reversing it is a one-line change to `agencyActions` plus the circulation
consent gate, but it changes what claiming *means*. **Not implemented pending a
decision.**

### R2 — Security in the navbar (spec pp. 2–3)

The required vendor navbar is listed as Dashboard, Chat, My Business,
Availability, Accounts, Bookings, Notifications, **Security**, then the email
dropdown. Today Security sits *inside* the email dropdown
([App.tsx:199](../frontend/src/App.tsx#L199)), alongside My Profile, because the
previous specification's item 8.5 put it there — both being about the account
rather than the work.

Minor either way, but it is a reversal and is listed so it is not applied by
accident.

---

## Part A — Vendor portal (pp. 1–4)

| # | Item | Status | Where it stands |
| --- | --- | --- | --- |
| A1 | Profile must show a read-only saved view after save, with a separate Edit Profile action, rendered from the backend response | partial | The save-and-redisplay defect from the previous round is fixed (cache invalidation). A distinct saved-view/edit-mode split is not built. |
| A2 | Remove the duplicate bell; keep the Notifications tab | open | Both exist — the tab at [App.tsx:103](../frontend/src/App.tsx#L103) and `NotificationBell` at [App.tsx:271](../frontend/src/App.tsx#L271). |
| A2b | Notifications page carries every type: booking request, quotation, payment, escrow, confirmation, service start, completion, dispute, settlement | partial | The feed renders whatever the notifications module fans out; the vendor-request notification (D-bis) is the one confirmed missing. |
| A3 | My Business must not duplicate Availability or Bookings | open | `ProviderConsole` renders a full seven-section Bookings list at [ProviderConsole.tsx:177](../frontend/src/pages/ProviderConsole.tsx#L177). Availability is already only a link. |
| R2 | Security in the navbar | conflict | See R2 above. |

---

## Part B — Availability (pp. 5–20)

This is the largest single block, and most of it traces to one design decision
rather than to twenty-four separate defects.

**Root cause.** `VendorAvailabilitySlot` carries `capacity` and `booked`, but
also a single `bookingId`, and `reserve()`
([availability.service.ts:258](../backend/src/modules/vendors/availability.service.ts#L258))
sets `status = PENDING` the moment a *request* arrives. `listBookable()` then
excludes anything not `AVAILABLE`. So one pending request takes a capacity-5
window off sale entirely — which is precisely B5, B6, B8 and B9 in the
specification, reported as four symptoms of one cause.

Fixing it properly means: drop the single `bookingId` holder, add a `pending`
counter, leave the status `AVAILABLE` through request/quote/accept, move the
capacity consumption into `confirm()`, and introduce a distinct `FULL` state so
that *has confirmed bookings* (BOOKED) and *cannot take another* (FULL) stop
being the same flag.

| # | Item | Status | Where it stands |
| --- | --- | --- | --- |
| B1 | Edit an existing slot | partial | `PUT …/slots/:id` exists and validates; the UI has only Block and Delete ([Availability.tsx:204](../frontend/src/pages/Availability.tsx#L204)). |
| B2 | Multiple slots on the same day | works | Non-overlapping same-day slots are already allowed; back-to-back is explicitly permitted. See B24 for the overlap rule itself. |
| B3 | One slot ≠ one booking | open | `bookingId` is a single column; the model holds one booking per window. |
| B4 | `Remaining = Capacity − Confirmed`, never maintained by hand | open | Neither remaining nor pending is computed or returned. |
| B5 | Slot stays OPEN until the vendor confirms | open | `reserve()` flips it to PENDING on request. |
| B6 | Capacity consumed only on confirmation | partial | `confirm()` does increment `booked` correctly; the problem is that the slot was already off sale. |
| B7 | FULL only at capacity | open | No FULL state exists. `confirm()` sets BOOKED at capacity, AVAILABLE below it. |
| B8 | Pending requests must not make a slot booked | open | Same cause as B5. |
| B9 | Multiple bookings for catering-type vendors | open | Same cause as B3. |
| B10 | Per-vendor-type capacity | works | `capacity` is per slot and vendor-set; nothing hardcodes 1. |
| B11 | Slot row shows capacity, confirmed, pending, remaining, status, `[Edit][Block][Delete]` | open | The row shows `booked of capacity` and a status pill only. |
| B12 | Summary cards clickable, each filtering | open | `Stat` is a plain div ([Availability.tsx:164](../frontend/src/pages/Availability.tsx#L164)). |
| B13 | Counts update automatically on confirmation | partial | `summary()` is computed live server-side, but the client does not invalidate it on a vendor confirmation. |
| B14 | Status updates after confirmation; BOOKED ≠ FULL | open | Same cause as B7. |
| B15 | Backend prevents overbooking; rechecks on confirm | partial | `reserve()` takes a `pessimistic_write` lock, which is right. `confirm()` locks too but does not re-assert `booked < capacity`. |
| B16 | User sees `3/5 booked, 2 remaining, OPEN`; FULL cannot be selected | open | `listBookable()` returns bare slots with no counts. |
| B17 | Availability rechecked when the request is submitted | works | `reserve()` runs inside the booking transaction under a row lock. |
| B18 | Delete refused when confirmed bookings exist, with that message | partial | `remove()` refuses on status, not on `booked > 0`, and the message is generic. |
| B19 | Block must not invalidate confirmed bookings | partial | `block()` refuses on BOOKED/PENDING status; once statuses are corrected this needs re-expressing in terms of `booked`. |
| B20 | Publish form validation: date in window, from < to, capacity positive | works | `assertWithinWindow`, `assertTimeOrder`, and DTO bounds all hold, both sides. |
| B21 | Rolling three-month window | works | Computed per request from the current date, not stored. |
| B22 | Every clickable thing must work | open | Edit is absent (B1) and the four summary cards do nothing (B12). |
| B23 | Re-render from backend state after every action | partial | Most mutations invalidate; the confirmation path does not reach the availability queries. |
| B24 | Overlapping time is not automatically invalid — capacity controls simultaneity | conflict-lite | `assertNoOverlap` refuses genuine overlap by design. The new spec says capacity should decide. Changing it is safe but it does reverse a deliberate rule. |

---

## Part C — Dynamic vendor service catalog (pp. 21–48)

**Status: open, and by a wide margin the largest item in the document.**

Nothing of this exists. `VendorCategory` is a fixed enum, a listing carries a
flat `startingPrice`/`priceUnit`/`priceNotes`, and a booking carries a free-text
`requirements` string. The specification asks for a configuration-driven
catalog:

- `ServiceCategory → ServiceDefinition → {Attributes, Requirements, Pricing
  Rules, Availability Rules, Booking Rules} → VendorService → Offerings →
  Booking`
- 15 attribute types (Text … Range), 9 pricing models (Fixed … No Public Price)
- admin-managed templates, vendor-managed instances
- booking forms generated from the selected service definition
- packages optional

Its own design principle is the clearest statement of scope in the document:
*don't build one module per service type — build the configuration*. This is a
new subsystem of roughly the size of the marketplace module, plus a migration
path for existing listings. It should be planned and sized separately from the
defect list around it.

---

## Part D — Vendor verification (pp. 48–60)

The verification module is largely built; the gaps are specific.

| # | Item | Status | Where it stands |
| --- | --- | --- | --- |
| D1 | Admin allocation must actually assign | works | `allocate()` writes `assignedToUserId`, `allocatedByUserId`, `allocatedAt` and appends to `history`. |
| D2 | Manual officer allocation | works | `dto.officerUserId` is honoured; the workload suggestion is only the default. |
| D3 | Status chain including VERIFICATION SUBMITTED and ADMIN REVIEW | open | `VerificationStatus` has NEW, ASSIGNED, IN_PROGRESS, APPROVED, REJECTED, ISSUE, ADDITIONAL_REVIEW. The officer decides directly; there is no submit-then-admin-review stage. |
| D4 | Officer receives the task **and a notification**, created only after the allocation is stored | open | `allocate()` records an audit event and nothing else. No notification reaches the officer. |
| D5 | Officer sees complete vendor details | works | `findOne` expands to the record, the applicant and the history. |
| D6 | Officer records findings, remarks, issues | partial | One `remarks` field on the decision. No structured findings. |
| D7 | Approval unavailable before verification | open | `decide(APPROVED)` is reachable straight from ASSIGNED. |
| D8 | Reject requires a stored reason | works | `decide()` refuses anything other than an approval without `remarks`. |
| D9 | "Needs Another Look" must be a real workflow | partial | `ADDITIONAL_REVIEW` exists and blocks the applicant, but re-allocation is the only way out of it. |
| D10 | Admin sees allocation details | works | Rendered from `history` plus the allocation columns. |
| D11 | In-person portal sections: New/Assigned, In Progress, Completed, Approved, Rejected, Needs Another Look, Issues/Support | partial | The queue filters by status; the seven named sections are not laid out. |
| D12 | Workload allocation must compute (A=5, B=2, C=8 → B, then B=3) | works | `workload()` counts open requests per officer; `suggestOfficer()` returns the lightest. |
| D13 | Completed/approved/rejected excluded from active workload | works | The open set is ASSIGNED, ADDITIONAL_REVIEW, ISSUE, IN_PROGRESS. |
| D14 | Vendor sees their verification status | works | `myStatus()`. |
| D15 | Main portal shows only approved vendors | works | Follows from the approval gate on listing visibility. |

### D-bis — Vendor new request and notification (11 items)

| # | Item | Status |
| --- | --- | --- |
| D16 | Dashboard shows a New Requests count | open |
| D17 | New request appears immediately under Bookings → New Requests | works |
| D18 | Notification per request carrying user, service, event date, slot, request ID | open |
| D19 | Notification click-through to the request | open |
| D20 | Counts synchronized across dashboard, bookings, notifications | open |
| D21 | Support entry in the vendor navbar | open |
| D22 | Reading a notification marks it Read and does nothing else | works |

---

## Part E — Claimed client, agent access (pp. 61–63)

| # | Item | Status |
| --- | --- | --- |
| E1 | Agent retains photos, reach, circulate, pause, close, delete, resend invite after claim | **conflict** — see R1 |
| E2 | `Claimed by owner` must not disable agent circulation permission | **conflict** — see R1 |

---

## Part F — Circulation (pp. 61–64)

| # | Item | Status | Where it stands |
| --- | --- | --- | --- |
| F1 | All four circulation options must work | works (not reproducible) | Reproduced against the running stack: `verify-circulation.sh` exercises all four paths end to end and passes **78 of 78**, including sharing to an agency, to an account, by link, and into the pool, plus the recipient reading it back. The routes are not broken. Two things do refuse, both deliberately and both with a stated reason: circulation consent must be recorded first, and on a **claimed** profile `canCirculate` is false so the button is hidden outright — which is R1, and is the most likely source of the report. |
| F2 | On success: message, status update, who it was shared with, "Who has this profile" | works | `recipientsOf` backs the share list; the dialog shows a notice and invalidates. |
| F3 | Circulation permission locked at creation by a checkbox; must become editable afterwards via "Enable Circulation" with confirmation | open | Consent is recorded per scope and is append-only; there is no post-hoc "Enable Circulation" affordance on the profile itself. |

---

## Part G — Chat module (pp. 65–66)

| # | Item | Status | Where it stands |
| --- | --- | --- | --- |
| G1 | Proposals and Chat must use the same conversation and message data | open | They use **two different stores**. Proposals reads `/circulation/proposals` — `proposal_notes`, an agent-to-agent thread hanging off an `interest`. Chat reads `/chat/conversations` — `conversations`/`messages`, keyed on accounts. An agent messaging through Proposals writes a `proposal_note`; opening Chat queries `conversations`, finds none, and shows "No conversations yet". `matchedButSilent()` cannot rescue it either: it resolves the *caller's own* marriage profile, which is not how an agent participates. |

This is not a rendering bug. Satisfying the specification means either unifying
the two stores or surfacing proposal threads in the chat list as first-class
conversations. Worth an explicit design decision — merging an agent-to-agent
working thread into the couple's chat has privacy consequences.

---

## Part H — Application-wide issues (pp. 66–74)

Priorities are the specification's own (p73).

| # | Item | Priority | Status | Where it stands |
| --- | --- | --- | --- | --- |
| H1 | Biodata photos not maintained | Medium | open | `PhotoUploader` exists but is wired **only** into `ManagedProfiles` (the agent view). Neither Profile nor Biodata offers photo upload, and the `PUT details/primary-photo` route has no caller in the client. |
| H2 | Mobile number validation / OTP / verified status | High | partial | `MOBILE_PATTERN` validates both sides and phone verification with a hashed, attempt-limited OTP is built. What is missing is the verified/unverified state being *shown* on the profile. |
| H3 | Surname and Last Name showing the same value | Medium | works (mostly) | They are separate columns, separate DTO fields and separate inputs. Nothing copies one to the other. What the form lacks is any indication of what distinguishes them — which is the likely source of the report. |
| H4 | Saved Details not displayed | High | partial | Sections save and reload from `GET details`. There is no read-only "saved details" view distinct from the editing form (same shape as A1). |
| H5 | Planner / Wedding Planner duplication | Medium | open | Two genuinely different things with colliding names: `/wedding-planners` ("Planners" in the navbar, "Wedding Planners" on the dashboard) is the marketplace; `/planner` ("Planner", "Wedding Planner") is the couple's own timeline. Rename rather than remove. |
| H6 | Wedding Planner showing zero/invalid dates | High | open | `Planner.tsx` renders `{p.weddingDate}` and `due {t.dueDate}` raw, so a null due date prints as an empty or `null` tail. No "Date not set" fallback, no formatting. |
| H7 | Events RSVP tracking dashboard | High | partial | `guestList()` already returns `{total, attending, declined, maybe, pending}`. Missing: the dashboard itself, and the mapping to the specification's four named categories (Total Invited / Coming / Not Coming / Not Responded). |
| H8 | RSVP guest details per category, plus a button through to vendors | High | open | The rows returned are bare invites — no guest name or mobile joined in. Three fields do not exist at all: party size on `guests`, decline reason and last-reminder timestamp on `event_invites`. Needs a migration. |
| H9 | Primary mobile missing beside the alternate | High | open | The primary lives on `users.phone`; the alternate lives on `profile_details.alternateMobile`. The biodata form shows only "Alternate mobile", with the primary nowhere on the page. Real defect, exactly as reported. |
| H10 | Aadhaar verification not working | High | partial | The flow is built and tested — OTP session, Verhoeff check, HMAC-under-pepper, one-document-one-profile — but it runs against a **mock provider**. `AADHAAR_PROVIDER=licensed` switches it to a live one; UIDAI credentials do not exist yet. This is the deferral already recorded in the previous register, resurfacing as a bug report. |
| H11 | Overall profile data consistency | — | partial | The chain holds for sections that have a UI. Where it visibly breaks is exactly H1, H4 and H9. |

---

## What this adds up to

| Block | Open items | Character of the work |
| --- | --: | --- |
| A — Vendor portal | 3 | UI restructuring |
| B — Availability | 13 | One model change, then the UI follows |
| C — Service catalog | 1 | A new subsystem — plan separately |
| D — Verification | 9 | Two workflow states, one notification, portal layout |
| E — Claimed-profile access | 2 | **Blocked on a decision** |
| F — Circulation | 1 | F1 does not reproduce; F3 is a consent affordance |
| G — Chat | 1 | Needs a design decision on store unification |
| H — Application-wide | 9 | Mostly small; H8 needs a migration |

Sequence that respects the dependencies:

1. **Decide R1 and R2**, and decide G1's store question.
2. **Part B model change** — it is the root of thirteen items and nothing in the
   booking flow is right until it lands.
3. **H6, H9, H1, H5** — small, high-priority, independent.
4. **H7/H8** — one migration, one dashboard.
5. **D4, D3, D7, D-bis** — verification workflow and notifications.
6. **A1/A2/A3** — portal layout, once the modules underneath are correct.
7. **F3** — the "Enable Circulation" affordance. F1 needs no work; it resolves
   with R1.
8. **Part C** — planned and sized on its own.
