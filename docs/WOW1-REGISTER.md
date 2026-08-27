# wow_1.pdf — Matches, Chat, Events, Biodata, and the verification gate

A survey of the 20-page document, item by item, against what the platform
actually does.

Two things are worth saying before the tables.

**The first is that most of the "X is not working" reports in all three
documents so far had a shared cause, and it was one line of client code.** The
API wraps every failure in an envelope and puts the reason in `error.message`;
the client read `message` at the top level, found nothing, and fell back to a
generic sentence. Every explanation the server produced was discarded before
anybody saw it. "That document could not be recorded" was, underneath, *this
document is already registered against another profile*. "That photo could not
be uploaded" was *that filename is not accepted*. A person told only that
something failed can write only that it failed.

**The second is that "it is not taking all types of images" was never about
image types.** The filename pattern also demanded `^[A-Za-z0-9._-]+$` for the
name. `WhatsApp Image 2026-08-26 at 5.28.11 PM.jpeg` has spaces in it. `pic
(1).png` is what Windows calls the second copy of anything. Both are perfectly
ordinary photographs and both were refused, so the message shown talked about
images while the objection was about punctuation.

---

## Found while building this

| Found | What it was |
| --- | --- |
| Every server error message in the app was being thrown away | The envelope mismatch above. Fixed in `apiMessage`, and asserted from the server side so the shape cannot drift back |
| `GET /users/me` handed out the identity-document fingerprint | `governmentIdHash` is the peppered HMAC used to catch one person running two profiles. It went to the browser on every session bootstrap, which gives back most of what hashing it was for. Now projected out, along with the officer who confirmed it |
| "Recently added" could not show recently added profiles | The candidate pool was `take: 50` with **no order**, so it was whichever fifty rows Postgres returned. On a database with more than fifty profiles, one that joined this morning usually was not among them — so the newest list did not contain the newest people, and a search for a specific profile code found nothing because the profile had been dropped before any filter ran. The pool is ordered newest-first, and a search queries the database rather than filtering a capped pool |
| The sibling and asset add-forms kept what you had typed | Only "Name" was a controlled input. After adding a sibling the state reset and the browser's own boxes kept the age and profession — an empty name beside a stale age, which is exactly the "not looking good, should be in good order" report. React had never written to those inputs at all |
| Estimated value had nowhere to be entered | The field existed on the API from the start and this form never offered it, and the list never printed it. Reported as "saved in the backend, not displaying on the frontend", which was accurate |

---

## Matches page

| # | Item | Status |
| --- | --- | --- |
| MA1 | Cards carry only name, location and age range — not enough to evaluate | **done** — photo, name, profile ID, age, city, height, profession, education, marital status, community and mother tongue |
| MA2 | Profile photo on the card | **done** — and a card with no photograph says so, rather than showing a broken image |
| MA3 | Match percentage on each profile | **done** |
| MA4 | Age, location, profession, education, marital status, profile ID, preferences | **done** |
| MA5 | Recommended Matches not actionable | **done** — real cards with View profile, Show interest and Shortlist |
| MA6 | Recently Added not actionable | **done** — the same cards, and the list is now genuinely the newest (see above) |
| MA7 | "Match Fixed" section unclear | **done** — renamed Confirmed matches, and each card states the profile, the score, whether each side has confirmed and on what date, and what to do next |
| MA8 | Filtering insufficient | **done** — age, height, city, religion, caste/community, mother tongue, education, profession, marital status, occupation |
| MA9 | No search | **done** — one box for name, profile ID or keyword. A profile ID matches exactly; a name or town matches partially |
| MA10 | No sorting | **done** — best match, recently added, recently active, youngest first, oldest first |
| MA11 | Match types not separated | **done** — browsing, recommendations and confirmed matches are three sections that each say what they are |
| MA12 | No interaction status on a card | **done** — interest sent, they are interested, matched, you declined, they declined. The Show interest button is not offered where it would send a second identical request |
| MA13 | No shortlist | **done** — private to the side that made it, and never disclosed to the other family |
| MA14 | No verification indicator | **done** — shown where an officer has confirmed the document in person |
| MA15 | No active status | **done** — active today / this week / this month. Past a month it says nothing rather than making a stale claim |
| MA16 | No pagination or load more | **done** — Load more, with the number still to come |
| MA17 | Weak empty state | **done** — and it distinguishes the two empties: a filtered list that came back empty is a filter problem, an unfiltered one is a preferences problem, and they get different advice |
| MA18 | Weak visual hierarchy | **done** |
| MA19 | **Pressing interest does nothing** | **done** — the interest was being refused with a reason the client discarded. Both halves fixed: the reason now reaches the screen, and the gate explains itself before the button is pressed |
| MA20 | Compatibility details — why this is a good match | **done** — the engine returned a per-dimension breakdown all along and nothing had ever shown it |
| MA21 | Responsive across desktop, tablet and mobile | **done** — three panels above `lg`, stacked in the same order below |
| MA22 | Interests belong only in the Interests module | **done** — the interest inbox is gone from this page |

## Chat

| # | Item | Status |
| --- | --- | --- |
| CH1 | Header shows only name and online status | **done** — photo, name, profile ID, age band, city, presence |
| CH2 | No View profile from the chat | **done** — opens over the thread rather than navigating away from it |
| CH3 | Duplicate names in the conversation list | **done** — the profile ID under the name, with the age and town. Two people called Pardhu are now distinguishable at a glance |
| CH4 | No unread indicator | **done** — a count per row |
| CH5 | Message status | **done** — one tick sent, two read, and only on your own messages |
| CH6 | Conversation context unclear | **done** — "82% match · interest accepted", or match fixed |
| CH7 | Three-dot menu actions unclear | **done** — block, report, mute, clear and delete, each labelled with what it does |
| CH8 | Last message time on the row | **done** — a clock today, a weekday this week, a date beyond that |

## Profile fields

| # | Item | Status |
| --- | --- | --- |
| PF1 | Replace "User Type: Bride/Groom" with Managing Profile For | **done** — the field is labelled by the question being asked |
| PF2 | Relationship with User as a closed list | **done** — Self, Parent, Sibling, Relative, Friend, Other, with free text after "Other". Free text alone produced forty spellings of "father"; a list alone loses "maternal uncle", which is a real distinction here |

## Events

| # | Item | Status |
| --- | --- | --- |
| EV1 | Button through to Vendors for that event | already delivered — the event travels with the link |
| EV2 | Cards for total, confirmed, pending and not-responded guests with RSVP tracking | already delivered — invited, coming, not answered, declined, with heads as well as invitations |
| EV3 | The same in every login, bride/groom and family member | **verified** — asserted rather than reasoned about: the suite creates a day, adds a guest, invites them and reads the RSVP dashboard as a bride and again as a family member, and gets the same answers |

## Uploads

| # | Item | Status |
| --- | --- | --- |
| UP1 | Photo upload not taking all types of images, in all portals | **done** — see the note at the top. JPEG, PNG, WebP, GIF, BMP, AVIF, HEIC, HEIF, TIFF, JFIF and the common video formats, under any filename a device produces. Refused: a path segment, and anything that is not an image or video |

## Biodata

| # | Item | Status |
| --- | --- | --- |
| BD1 | Net worth in family details | **done** — one figure alongside the itemised assets, optional, and private unless the family says otherwise |
| BD2 | Partner preferences should carry the horoscope fields | **done** — rashi, star, padam, gothram, kuja dosham and time of birth sit beside the expectations, and save to the horoscope section rather than being duplicated into preferences |
| BD3 | Sibling details look disordered after adding one | **done** — a labelled grid, every input controlled, and a marital status for each sibling |
| BD4 | Family assets estimated value saved but not displayed | **done** — an input to enter it, the figure in the list, and on the circulated biodata, formatted in lakhs and crores rather than thousands |

## Identity verification gate

| # | Item | Status |
| --- | --- | --- |
| IV1 | Aadhaar page showing "That document could not be recorded" | **done** — the real reason now reaches the screen; the message was never the platform's, it was the fallback |
| IV2 | Matchmaking must not proceed before identity verification | **done** — send interest, accept interest and confirm match fixed all require the subject profile's document to have been confirmed |
| IV3 | Enforced on the frontend: hide or disable, and say why | **done** — a banner on Matches, and the reason travels with each disabled button |
| IV4 | Enforced on the backend, so the API cannot be called directly | **done** — the check is in the service, not a guard, because it is a fact about the *subject profile* rather than the calling account. An agency verified as a business still cannot send interests for a client whose own document has not been seen |
| IV5 | Once verified, the actions become available | **done** |

### What the gate costs, and why it is worth saying out loud

Declining is deliberately **not** gated. Requiring a verified document before
somebody may say no would trap them in a conversation they have already decided
against, which is the opposite of what the gate is for.

Browsing is not gated either. Somebody who has not verified yet still needs to
see what is on the other side of the step, and a blank page is a poor argument
for producing a passport.

The real cost falls on the agency walk-in flow: an agent who builds a profile
for a family at the counter can no longer start matchmaking for them in the
same visit, because an officer has to confirm the document first. That is what
the document asks for, and it is the right call for trust, but it is a change
to how an agency's day works and not only a change to a screen. If it turns out
to be too heavy in practice, the honest lever is the *submitted* state — the
platform already distinguishes "document on file, awaiting an officer" from
"nothing submitted", and opening interests at the first of those would be a
one-line change with a clearly stated weaker guarantee.

---

## Verification

`scripts/verify-wow1.sh` — 126 live assertions across fifteen sections,
covering all of the above against a running stack. `scripts/lib-identity.sh`
carries the shared verification fixture the other six suites now use, since
every persona that sends or accepts an interest has to pass the gate first.
