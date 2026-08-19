# WOW, World of Weddings

WOW is a full stack platform that carries a couple through the whole wedding journey. People discover and match with a partner, connect and chat once both sides agree, plan the wedding with an automatic timeline, book vendors and wedding planners with money held safely in escrow, run the individual ceremonies with guest lists and seating, arrange the honeymoon, and finally keep their photos and videos in shareable albums.

The backend is a single well organised NestJS application written in TypeScript. It stores everything in PostgreSQL and uses Redis for caching, sessions, rate limiting and real time chat delivery. The frontend is a React application built with Vite and styled with Tailwind. The whole system is packaged to run with Docker, to scale on Kubernetes, and to be provisioned on AWS with Terraform.

## Who uses it

WOW is a marketplace with four kinds of account, chosen on the sign-up screen. Each one sees a different application.

| Account type | What they do |
| --- | --- |
| **Individual** (bride, groom or family member) | Build a profile, browse matches, send and accept interests, chat with accepted matches, book vendors and planners, plan the wedding. A family member can additionally look after a relative's profile |
| **Marriage agent** | Build profiles for clients — including people who have not signed up — invite them to claim their account, browse and book on their behalf. Reviewed by an administrator before any of that opens |
| **Vendor** | Publish a service listing, respond to incoming bookings, get paid out of escrow |
| **Wedding planner** | Publish a planning listing, respond to bookings, and co-manage the weddings they are engaged on |

Administrators approve agencies, vendors and planners, resolve disputes, read analytics and the audit trail, and suspend accounts. Administrators cannot be created through the public API — see [Seeding the first administrator](#seeding-the-first-administrator).

Three rules shape the whole permission model, all enforced on the server for every request:

- **Only individuals and agents can place bookings.** Vendors and planners sell; they do not buy.
- **Only individuals take part in matchmaking.** An agent participates only under the identity of a client profile they manage.
- **Nobody creates an account for somebody else.** An agent builds the *profile*; the person themselves sets the password when they accept the invitation.

Anyone can sign up on their own at any time. A self-registered person is never tied to an agency, signs in with their own password, and may approach any user or any agent freely.

### Profiles without accounts

A profile and an account are separate records. An agent (or a family member) can build a complete, matchable profile — photos, preferences, contact details — for someone who has never heard of the site. That profile takes part in matchmaking immediately.

When the agent is ready they send an invitation to the email and mobile number on file. The invitee follows the link, **chooses their own password**, and takes ownership: from that moment the profile is theirs and the agent's write access ends, though the client stays on the agency's books.

```
agent builds profile  →  UNCLAIMED  →  invite emailed  →  INVITED  →  subject accepts  →  CLAIMED
   (matchable now)                                                        (they own it)
```

The full model is in [docs/PROFILES-AND-INVITATIONS.md](docs/PROFILES-AND-INVITATIONS.md); the permission contract is in [docs/RBAC-AND-ROLES.md](docs/RBAC-AND-ROLES.md).

## What is inside this repository

The `backend` folder holds the API, the database migrations, the shared platform code such as configuration, authorization and health checks, and the tests. The `frontend` folder holds the React single page application. The `docker` folder holds the images and the compose files for running everything locally. The `scripts` folder holds the live verification suites. The `k8s` folder holds the Kubernetes manifests for a production deployment. The `terraform` folder holds the cloud infrastructure. The `docs` folder holds the design blueprint, the setup and testing guide, the authorization contract, the profile/invitation model, and an honest self-review of the remaining gaps.

## The main features

A person registers, picks an account type, and the system issues a short-lived access token plus a refresh token that rides in an httpOnly cookie. Individuals build a profile with their details and preferences. The matchmaking engine scores how compatible two people are and suggests the best options, and every weight in that scoring lives in configuration so the product team can retune it without touching the code. What one person sees of another is deliberately limited: an age band rather than a date of birth, and photos only once both sides have accepted. Once two people match they can chat in real time, delivered reliably across replicas through Redis. Buyers can also open an enquiry thread with any vendor, planner or agent without a prior match.

Agents and family members can build and manage profiles on behalf of others, invite them by email to claim their account, and act under those profiles for browsing and bookings. Every such action records both the profile it was for and the account that performed it.

On the marketplace side, vendors and wedding planners publish listings, and an administrator approves each one before it appears in search or accepts a booking. Bookings move from requested to paid to confirmed to completed, the payment is held in escrow until the event is done, and each side can only drive the transitions that belong to it. On completion the platform's commission is withheld and the rest released to the provider; a cancellation refunds the buyer in full. Reviews can only be written after a booking with that provider has completed.

The planner creates a wedding timeline automatically from the wedding date, and a wedding planner engaged through a confirmed booking can co-manage it. Couples manage several ceremonies with guest lists and seating, and guests — who are not platform users — reply through their own signed RSVP link. Couples can browse honeymoon destinations, build an itinerary, create photo albums and share them through a public link. A helper called WOW Genie offers budget guidance, and an administrator has a panel for approvals, analytics, disputes and the audit trail.

Account security is first-class: email verification, password reset, per-device sessions with rotation and stolen-token detection, optional two-factor (mandatory for administrators), and account lockout after repeated failed sign-ins.

## Running it locally with Docker

```bash
cp docker/.env.example docker/.env    # then edit the secrets
docker compose -f docker/docker-compose.yml up -d --build
```

`docker/.env` controls the host ports, the database credentials, the JWT secrets, the mail transport and the bootstrap administrator. Mail defaults to `MAIL_PROVIDER=log`, which writes invitation and reset links to the backend log instead of sending them, so nothing external is needed to try the flows. Change `FRONTEND_PORT` or `BACKEND_PORT` there if something else on your machine already uses 8080 or 3000, and keep `CORS_ORIGINS` in step with `FRONTEND_PORT`.

Once the stack reports healthy:

- the application is at `http://localhost:8080` (or your `FRONTEND_PORT`)
- the API is at `http://localhost:3000/api`
- the API documentation is at `http://localhost:3000/api/docs`
- health is at `http://localhost:3000/api/health`

Migrations run automatically when the backend container starts.

There is also `deploy-local.sh`, which wraps the same steps and waits for health, and `run-local-no-docker.sh` for running the backend directly with Node. The setup guide in the docs folder explains both paths.

### Seeding the first administrator

`admin` is deliberately absent from the self-registration allow-list, so no request to the public API can ever mint one. Create the first one with the one-shot seeder:

```bash
docker compose -f docker/docker-compose.yml --profile seed run --rm seed-admin
```

It reads `ADMIN_EMAIL` and `ADMIN_PASSWORD` from `docker/.env` and is idempotent — running it again promotes and reactivates the existing account instead of failing. On Kubernetes the equivalent is `k8s/seed-admin-job.yaml`, run once per environment.

## Configuration

Every value that an operator or a tester might want to change lives in environment variables rather than in the code. This includes the database and cache connection details, the security settings such as token lifetimes and rate limits, the matchmaking weights, and the choice of payment, storage and AI providers. `backend/.env.example` documents every setting, and the application validates them at startup so a mistake is caught immediately rather than later.

## Testing

```bash
# unit tests, lint and typecheck
cd backend && npm test && npm run lint && npm run typecheck

# functional tests against a real database and cache
docker compose -f docker/docker-compose.test.yml up -d
npm run migration:run && npm run test:e2e
```

Beyond those, two suites exercise the authorization rules against a **running** stack. Both run inside the compose network and exit non-zero on any failure, so either can gate a deploy:

```bash
docker run --rm --network docker_default -v "$PWD/scripts:/scripts" alpine:3.20 \
  sh -c "apk add --no-cache curl jq openssl redis >/dev/null && sh /scripts/verify-rbac.sh"
```

```bash
docker run --rm --network docker_default -v "$PWD/scripts:/scripts" alpine:3.20 \
  sh -c "apk add --no-cache curl jq openssl redis >/dev/null && sh /scripts/verify-invites.sh"
```

- `verify-rbac.sh` — 118 checks: privilege escalation at registration, per-persona permissions, agency vetting, profile-level scoping, booking IDOR, escrow transitions, review gating, event ownership, request validation and token handling.
- `verify-invites.sh` — 76 checks: agency approval, profiles built for people with no account, invitation and claim, multi-device sessions, brute-force lockout, signed payment webhooks, the audit trail, two-factor and pagination bounds.

A k6 load test lives in `backend/test/k6`.

## Known gaps

[docs/SELF-REVIEW.md](docs/SELF-REVIEW.md) lists what is still missing and what I would do next, in priority order. The largest remaining items are that mobile numbers are collected but no SMS is sent, and that real escrow payouts still need Razorpay Route configured.
