# Issue register — `new_wow_issues` specification

The 74-page follow-up document, item by item, against what the code does.

Written first as a survey — before anything was built — so the size and shape
of the work were visible up front, and so the two places where this
specification **reverses** a decision already implemented were flagged rather
than quietly applied. It is now the record of what was done about each item.

The earlier document's register is [ISSUE-REGISTER.md](ISSUE-REGISTER.md).

| Status | Means |
| --- | --- |
| **done** | Built, and covered by a live assertion |
| **works** | Already satisfied before this round; the reported symptom had another cause, named |
| **partial** | Built in part; what is missing is named |
| **deferred** | Needs something the platform does not have. Named, not dropped |

Live coverage below comes from `scripts/verify-*.sh` — **854 assertions**
against a running stack, plus 136 backend unit tests, 27 e2e tests and 7
frontend tests. `verify-phase4.sh` is new in this round and carries 204 of
them.

---

## Two reversals that need a decision first

### R1 — Agent access to a claimed profile (spec pp. 61–63) — **applied**

The new document requires that after `Claimed by Owner` the agent **retains**
photos, reach, circulate, pause, close, delete and resend-invite.

The code did the opposite, per item 9.2 of the previous specification. You
confirmed the reversal, and it is now in: claiming no longer ends the
engagement. The family hired the agency to find a match, and the subject
getting an account of their own is usually the point at which that work matters
most.

Two things stay refused, for reasons about the data rather than about the
engagement, and this is the one place the implementation diverges from the
specification as written:

- **Editing the biodata.** Two writers with no rule about who wins produces a
  profile that contradicts itself.
- **Deleting.** A claimed profile *is* somebody's account profile. Removing it
  would leave a real person signed in to nothing. The specification lists
  delete; this one is deliberate.

Finishing it turned up a genuine inconsistency: `agencyActions` said pausing was
allowed while `assertNotClaimed` still refused it, so the client would have
rendered a button the server rejects. And `GET /agents/profiles/:id` returned no
`actions` block at all, so the same screen got a different answer depending on
how it was reached. Both fixed.

Asserted in `verify-invites.sh` — an agent who can no longer edit a claimed
profile can still open it, circulate it, pause it and put a photograph on it,
and cannot delete it.

### R2 — Security in the navbar (spec pp. 2–3) — **applied**

Security moved from the email dropdown into the navigation, on the same
newest-document-wins basis. Sessions, two-factor and recovery codes are things
people go looking for, and a menu they have to discover first is a menu they
never open.

---

## Part A — Vendor portal (pp. 1–4)

| # | Item | Status | What happened |
| --- | --- | --- | --- |
| A1 | Profile shows a read-only saved view, with a separate Edit action, rendered from the backend response | done | Saved details render from what the server returned, not from the form state — the only way the screen can tell you the difference between "saved" and "sent". An empty profile opens straight into the form. |
| A2 | Remove the duplicate bell; keep the Notifications tab | done | The bell is gone; the tab carries the unread badge. |
| A2b | Notifications carry every type | done | Nine booking types, three verification types and disputes, grouped by what the reader has to *do* rather than listed by time. One "booking update" for everything meant a vendor could not tell whether anything needed them. |
| A3 | My Business must not duplicate Availability or Bookings | done | Bookings moved into the Bookings module, which now serves the seller side too. My Business is the shop window: listing, services, prices, verification status. |
| R2 | Security in the navbar | done | See R2 above. |

---

## Part B — Availability (pp. 5–20)

Reported as twenty-four defects; most of it was one design decision.
`reserve()` flipped a window to PENDING the moment a *request* arrived, and
`listBookable()` excluded anything not AVAILABLE — so one family enquiring took
a caterer's five-team afternoon off sale entirely.

Requests and bookings are now separate counters, only `confirmed` is measured
against capacity, and the window is spent when the **vendor accepts the job**:
not at the request, not at the quotation, not at the advance.

`status` records the vendor's own decision — published, blocked, cancelled — and
`remaining`, `open`, `booked` and `full` are arithmetic over the counters, so
"has bookings" and "cannot take another" stop being the same flag.

| # | Item | Status |
| --- | --- | --- |
| B1 | Edit an existing slot | done |
| B2 | Multiple slots on the same day | works |
| B3 | One slot ≠ one booking | done |
| B4 | `Remaining = Capacity − Confirmed`, never maintained by hand | done |
| B5 | Slot stays OPEN until the vendor confirms | done |
| B6 | Capacity consumed only on confirmation | done |
| B7 | FULL only at capacity | done |
| B8 | Pending requests must not make a slot booked | done |
| B9 | Multiple bookings for catering-type vendors | done |
| B10 | Per-vendor-type capacity | done — now seeded from the service's `concurrentCapacity` |
| B11 | Row shows capacity, confirmed, pending, remaining, status, `[Edit][Block][Delete]` | done |
| B12 | Summary cards clickable, each filtering | done — fetched from the server, so the count and the list cannot disagree |
| B13 | Counts update automatically on confirmation | done |
| B14 | Status updates after confirmation; BOOKED ≠ FULL | done |
| B15 | Backend prevents overbooking; rechecks on confirm | done — re-checked under the row lock in `confirm`, not trusted from the request |
| B16 | User sees `3/5 booked, 2 remaining, OPEN` | done |
| B17 | Availability rechecked when the request is submitted | done |
| B18 | Delete refused when confirmed bookings exist, with that message | done |
| B19 | Block must not invalidate confirmed bookings | done |
| B20 | Publish form validation | works |
| B21 | Rolling three-month window | works |
| B22 | Every clickable thing works | done |
| B23 | Re-render from backend state after every action | done |
| B24 | Overlapping time is not automatically invalid | done — overlap is allowed; publishing the *identical* window twice is still refused, because that splits one capacity across two rows |

---

## Part C — Dynamic vendor service catalog (pp. 21–48)

**Built.** Five tables — category, service definition, attribute, vendor
service, offering — and a validator, replacing what would otherwise be a module
per vendor type.

| # | Item | Status |
| --- | --- | --- |
| C0 | Configuration, not one module per service type | done |
| C1 | The full structure, category through to review | done |
| C2 | Admin configures; vendor instantiates | done — `CATALOG_MANAGE`, admin only |
| C3 | 15 attribute types | done |
| C4 | 9 pricing models | done — the definition decides which a service may use |
| C5 | Packages optional | done — `packagesAllowed`, off for a priest |
| C6 | Booking form generated from the selected service | done |
| C7 | Worked examples: priest, decorator, makeup, venue, transportation, planner, florist | done — seeded as configuration in `catalog-blueprint.ts`, 9 categories, 10 services, 84 attributes |
| C8 | The recommended data model | done |

The validator is what makes jsonb answers safe to store: every answer is checked
against the attribute that asked for it before it is written. A number arriving
as `"250"` from a form is coerced; an unknown key is dropped rather than
rejected, so retiring an attribute does not turn every existing listing into a
400. It caught a bug in itself — the first time regex accepted `25:00`.

Existing listings are untouched. `vendors.category` and its flat pricing still
work, so a business moves onto the catalog when it chooses to.

---

## Part D — Vendor verification (pp. 48–60)

| # | Item | Status | What happened |
| --- | --- | --- | --- |
| D1 | Admin allocation must actually assign | works | |
| D2 | Manual officer allocation | works | |
| D3 | Chain including VERIFICATION SUBMITTED and ADMIN REVIEW | done | Both states added. The officer reports; an administrator decides. |
| D4 | Officer receives the task **and a notification**, created only after the allocation is stored | done | Never before — a notification for work that then failed to save sends an officer looking for a visit that is not on their queue. |
| D5 | Officer sees complete vendor details | works | |
| D6 | Officer records findings, remarks, issues | done | Structured: visited, observations, issues, evidence, recommendation. "What did you see" and "why are you rejecting this" were collapsing into one field. |
| D7 | Approval unavailable before verification | done | Refused outright until findings exist. |
| D8 | Reject requires a stored reason | works | |
| D9 | "Needs Another Look" must be a real workflow | done | Clears the findings, returns it to the officer's queue, and counts the revisits — a third visit usually means the request is unanswerable rather than incomplete. |
| D10 | Admin sees allocation details | works | |
| D11 | Portal sections | done | Eight, in the order work moves. |
| D12 | Workload allocation must compute | works | |
| D13 | Completed work excluded from active workload | done | Submitted work is reported but not counted: the officer's part is finished, and holding it against them would starve the busiest officer while an administrator sat on a backlog. |
| D14 | Vendor sees their verification status | done | On My Business. |
| D15 | Main portal shows only approved vendors | works | |
| D16 | Dashboard New Requests count | done | Separated from a lifetime total that told the vendor nothing. |
| D17 | New request appears under Bookings → New Requests | works | |
| D18 | Notification per request with user, service, event date, slot, request ID | done | Plus a reference short enough to read out on the phone. |
| D19 | Notification click-through | done | Opens the booking itself, not the list. |
| D20 | Counts synchronized | done | |
| D21 | Support in the vendor navbar | done | A new Support page. An argument about a booking could only be raised from inside that booking; everything else had no route in except email. |
| D22 | Reading a notification only marks it Read | works | |

---

## Part E — Claimed client, agent access (pp. 61–63)

| # | Item | Status |
| --- | --- | --- |
| E1 | Agent retains access after claim | done — see R1, with one stated divergence on delete |
| E2 | Claiming must not disable circulation | works — `assertMayCirculate` already let a claimed profile through |

---

## Part F — Circulation (pp. 61–64)

| # | Item | Status | What happened |
| --- | --- | --- | --- |
| F1 | All four circulation options must work | works | Reproduced against the running stack: all four paths pass end to end. What refuses is the consent gate and — before R1 — the claimed-profile rule. Not a broken route. |
| F2 | On success: message, status, who it was shared with | works | |
| F3 | Circulation locked at creation; must become editable | done | The client book says which profiles may be circulated and why not, batched into one query rather than forty, with an Enable Circulation action behind a confirmation. Consent stays append-only, so this records a fresh one — which is also what actually happened. |

---

## Part G — Chat module (pp. 65–66)

| # | Item | Status | What happened |
| --- | --- | --- | --- |
| G1 | Proposals and Chat must use the same conversation data | done | Both kinds of thread now appear in one list, in two groups, rather than being merged. Merging was the other option and it is the wrong one: an agency's working thread about a family is not that family's own chat, and folding one into the other would put things in front of people who were never party to them. There is no read state on a proposal note, so rather than invent an unread count the list says whether the other side spoke last. |

---

## Part H — Application-wide issues (pp. 66–74)

Priorities are the specification's own (p73).

| # | Item | Priority | Status | What happened |
| --- | --- | --- | --- | --- |
| H1 | Biodata photos not maintained | Medium | done | Photographs could never be added to a self-managed profile at all — the only screen that could attach one was the agency console. The first uploaded becomes the one shown first; removing the primary moves the pointer rather than leaving it dangling. |
| H2 | Mobile validation / OTP / verified status | High | done | The validation and the hashed, attempt-limited OTP already existed; what was missing was the verified state being *shown*. |
| H3 | Surname and Last Name showing the same value | Medium | done | They were always separate columns and separate inputs; nothing copied one to the other. What the form lacked was any indication of what distinguishes them, which is now on the fields. |
| H4 | Saved Details not displayed | High | done | A Saved details view above the forms, read back from the server. |
| H5 | Planner / Wedding Planner duplication | Medium | done | Two genuinely different things with colliding names: now "My Wedding Plan" and "Hire a Planner". |
| H6 | Wedding Planner showing zero/invalid dates | High | done | `lib/dates` handles nulls, the literal string `"null"` and zero dates, and says "Date not set" in one wording everywhere. |
| H7 | Events RSVP tracking dashboard | High | done | Total invited, coming, not coming, not responded — each as both invitations and people, because an invitation goes to a family and the caterer counts heads. "Maybe" is reported separately: somebody who answered "probably" has answered. |
| H8 | RSVP guest details per category, plus a route to vendors | High | done | Needed a migration: party size, mobile, decline reason and last-reminded date did not exist. Each category opens with the fields that category's follow-up actually needs, and the coming list leads to booking a vendor against the number. |
| H9 | Primary mobile missing beside the alternate | High | done | They live in different places for good reasons; the page showed one without the other. Both are returned together now, each labelled. |
| H10 | Aadhaar verification | High | partial | The flow is built and tested — OTP session, Verhoeff check, HMAC-under-pepper, one-document-one-profile — and now states its status plainly, including the half-finished case that used to look identical to never having started. It still runs against a **mock provider**; see below. |
| H11 | Overall profile data consistency | — | done | Where the chain visibly broke was H1, H4 and H9. |

---

## Still deferred, and why

Carried over, each for a stated reason rather than quietly dropped:

- **Live Aadhaar verification** runs against a mock provider.
  `AADHAAR_PROVIDER=licensed` switches it once UIDAI credentials exist; nothing
  about the stored data changes.
- **Real escrow payout.** `RazorpayPaymentProvider.release` logs rather than
  transferring. Needs Razorpay Route, linked accounts and per-vendor KYC. The
  commission split is computed and recorded correctly throughout.
- **TURN relays** for the fraction of calls that cannot traverse NAT
  peer-to-peer. `TURN_URL` is read from the environment and handed to the client.
- **Geography-aware officer allocation.** `region` is recorded; allocation still
  ranks purely by open workload. Doing it properly needs a service-area model
  that would allocate worse guessed at than ignored.

---

## What the tests say

| Suite | Assertions | Covers |
| --- | --: | --- |
| `verify-rbac.sh` | 147 | Per-persona permissions, IDOR, escrow transitions |
| `verify-invites.sh` | 79 | Invitation, claim, and what an agency keeps afterwards |
| `verify-circulation.sh` | 95 | Consent, the five sharing paths, enabling circulation later |
| `verify-phase1.sh` | 160 | Officers, verification, quotations, escrow milestones |
| `verify-phase2.sh` | 108 | Biodata, Aadhaar, notifications, events, disputes |
| `verify-phase3.sh` | 61 | SMS, phone verification, claims, data rights |
| `verify-phase4.sh` | 204 | The catalog, capacity, RSVP, photographs, the verification workflow |
| | **854** | |

Plus 136 backend unit tests, 27 e2e tests against real Postgres and Redis, and 7
frontend tests — one of which reads the backend permission enum off disk and
fails if the client's mirror has drifted.
