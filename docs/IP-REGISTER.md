# wow_ip.pdf — individual user and agent portal

A survey of the 37-page document, item by item, against what the platform
actually does. Where an item was already fixed, it says which commit and why the
fix arrived before the report did.

The headline: **five of the reported defects were the same bug**, and it was
found and fixed a few hours before this document arrived. `presign` handed the
browser an upload URL and nothing served it, so every upload on every deployment
not configured for S3 failed with "That photo could not be uploaded". That is
the individual's profile photo, the agent's mandatory biodata photograph, the
support attachment, the media album, and the vendor's portfolio — one cause,
five reports.

---

## Already fixed when this arrived

| Item | Where the document reports it | Commit |
| --- | --- | --- |
| Profile photo upload fails | Individual §1–2, Agent Issue 2, Support | `62d0087` — nothing served the presigned URL; the route was Express 5 syntax on Express 4; the volume was root-owned; and nginx refused anything over 1MB |
| Every URL field refused the platform's own uploads | The same reports, second half | `7ecd532` — `@IsUrl` also demands a top-level domain, which a storage host on `localhost` or an internal name does not have |
| Honeymoon: Create Plan does not create a plan | Honeymoon | `7ecd532` — the itinerary required at least one day, so "start a plan and fill it in" was refused every time |
| Media: album URLs, no gallery, no counts, no empty states | Media | `7ecd532` — cards with a cover and a count, upload from the device, and the picture rather than the link |
| Support: photo attachment not working | Support | `7ecd532` — plus a document route, since an attachment is as often an invoice as a photograph |
| Family assets: estimated value | Individual §4 | Already present as `estimatedValue` |
| Matches: recommendations at 50%+, highest first | Matches | The floor and the ordering are the engine's; the three-column layout is not — see below |
| Chat: block, report, view profile | Chat §2, §5 | Delivered with the chat menu last round |
| Chat: contact details must not pass | Chat §7–8 | Redaction before the write, with a count kept |

---

## Found while reading this document

| Found | What it was |
| --- | --- |
| The agency was one of its own clients | `actableProfiles` returned the agency's own profile alongside the managed ones, so the client picker on Matches, Biodata and the Network Pool offered an agency the chance to browse marriage proposals for itself. Fixed on the role, not by hiding a name — a family member stewarding a relative *is* also a client, and their own profile belongs there |
| "Matches are not filtered by gender" was the wrong subject | The gender rule was in the query all along. `matchRecommendations` dropped the `profileId` it was given, so an agent browsing as a client got the *agency account's* shortlist — profiles of every gender, unrelated to the client whose name was in the selector |
| A dead nginx config | `docker/nginx.conf` sat next to the compose file and was not built from; the image copies `frontend/nginx.conf`. Editing the obvious one changed nothing. Deleted |

---

## Individual user — biodata and profile

| # | Item | Status |
| --- | --- | --- |
| I1 | Profile photo upload not working | **done** — see above |
| I2 | Family Details section not working | **done** — Not reproducible, and almost certainly the photograph — see the cluster note below |
| I3 | Family assets: estimated value | done |
| I4 | Partner Preferences: horoscope details, and upload the horoscope document | **done** — Horoscope expectations join the partner preferences; the chart attaches from the same screen and is stored with the horoscope, not the preferences |
| I5 | Edit Profile does not work | **done** — Not reproducible |
| I6 | Horoscope/Gothram not reflected after saving | **done** — Not reproducible — gothram persists and survives an edit to any other section |
| I7 | Marital status only partly saved | **done** — Not reproducible — the whole history saves, reason included |
| I8 | Family Status and complexion as proper dropdowns | **done** — Both are closed lists now. Free text made them unmatchable |
| I9 | Saving loses previously entered details | **done** — Not reproducible — editing one section leaves every other one alone |
| I10 | Edit functionality does not work | **done** — Same as I5 |

### The biodata cluster, and why it closed without a fix

I2 and I5 to I10 are six reports of the same shape: Family Details not
working, Edit not working, Gothram not reflected after saving, marital status
only partly saved, saving losing what was there before.

None of them reproduces. Walking the whole form and then editing it, every
section persists and editing one leaves the others alone — `verify-phase2.sh`
now does exactly that, seventeen assertions including the one nothing covered,
that saving one section does not disturb another.

The likely explanation is that all six were one thing. The Personal section
refuses to save until three photographs are on the profile, and uploading a
photograph was broken end to end until the morning this document arrived. So
nobody could get past the first section, which reads exactly like every one of
those six sentences. The agent report says it outright: because the mandatory
photograph cannot be uploaded, the agent cannot proceed.

Closed on the assertions rather than on that reasoning. If any of it comes
back it will be a test failure rather than six more reports.

## Chat

| # | Item | Status |
| --- | --- | --- |
| C1 | Full chat UI with messaging and calling | **done** — messaging, the full three-dot menu, and WebRTC calling |
| C2 | View profile from the chat | done |
| C3 | Search within a conversation | **done** — Scoped to the thread. Cleared messages stay hidden |
| C4 | Mute notifications per conversation | **done** — Per reader. The thread still receives messages |
| C5 | Clear chat, block, report, delete conversation | **done** — Clear is a watermark, delete removes it from your list until a new message arrives |
| C6 | Conversation stays on the platform | done |
| C7 | Numbers in digits blocked | done |
| C8 | **Numbers written in words blocked** — "nine eight seven six", and mixed forms | **done** — A run of figures and digit words, counted rather than pattern-matched. Ten digits' worth goes, whatever it is spelled in |
| C9 | Calling in-app and anonymous | done — WebRTC, so no number is exchanged |

## Planner, events, matches, interests

| # | Item | Status |
| --- | --- | --- |
| P1 | Planner appears twice; there should be one | **done** — No duplicate: "Planners" and "Planner" were renamed to Hire a Planner and My Wedding Plan |
| E1 | Events: a button through to Vendors for that event | **done** — And the event travels with the link |
| E2 | Events: cards for total, confirmed, pending and unanswered guests | **done** — Invited, coming, not answered, declined — with heads as well as invitations |
| M1 | Matches in three columns: filters, recently uploaded, AI recommended with a percentage | **done** — Three panels |
| M2 | Show who accepted the interest, bride or groom | **done** — Named, or "You accepted this" |
| M3 | No duplicate rows; a name opens that profile | **done** — reproduced and fixed. The page drew three lists from overlapping queries, so a profile the engine liked appeared in all three; on a fresh account every recommended profile was in every list. Two lists remain, and the filters shape one of them |
| N1 | Rename Proposals to **Interests**, and give individuals the section | **done** |
| N2 | Interests: received, sent, pending, accepted, rejected | **done** — One read, with the actions each row allows |
| N3 | Unsend a sent or pending request | **done** |
| N4 | Block from received and accepted; a clear decline | **done** |

## Agent portal

| # | Item | Status |
| --- | --- | --- |
| A1 | The agent's own account must not appear as a client | **done** |
| A2 | Biodata photograph upload fails, blocking the rest | **done** |
| A3 | Resend Invite should be the first action on an invited profile | **done** — And it is the primary button while there is one to send |
| A4 | Shared With Me: show who shared it, and offer actions | **done** — The agency is named, with a way to reach them, and the card can send an interest without leaving the page |
| A5 | Matches must respect the selected client's gender | **done** |
| A6 | Deleting a client must ask first | **done** — The dialog names them |

## Family member

| # | Item | Status |
| --- | --- | --- |
| F1 | "Managing Profile For" and "Relationship with the User" on the profile | **done** — Stored on the profile, asked only of a family member |
| F2 | Hide Client Profiles and Shared With Me | **done** — Hidden on the role, since the capability cannot tell a family from an agency |
| F3 | Proposals renamed Interests | **done** — Same as N1 |
