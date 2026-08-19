# WOW, World of Weddings

WOW is a full stack platform that carries a couple through the whole wedding journey. People discover and match with a partner, connect and chat once both sides agree, plan the wedding with an automatic timeline, book vendors and wedding planners with money held safely in escrow, run the individual ceremonies with guest lists and seating, arrange the honeymoon, and finally keep their photos and videos in shareable albums.

The backend is a single well organised NestJS application written in TypeScript. It stores everything in PostgreSQL and uses Redis for caching, sessions, rate limiting and real time chat delivery. The frontend is a React application built with Vite and styled with Tailwind. The whole system is packaged to run with Docker, to scale on Kubernetes, and to be provisioned on AWS with Terraform.

## Who uses it

WOW is a marketplace with four kinds of account, chosen on the sign-up screen. Each one sees a different application.

| Account type | What they do |
| --- | --- |
| **Individual** (bride, groom or family member) | Build a profile, browse matches, send and accept interests, chat with accepted matches, book vendors and planners, plan the wedding |
| **Marriage agent** | Onboard and represent clients, browse matches and place bookings on a client's behalf, manage their own book of business |
| **Vendor** | Publish a service listing, respond to incoming bookings, get paid out of escrow |
| **Wedding planner** | Publish a planning listing, respond to bookings, and co-manage the weddings they are engaged on |

Administrators approve listings, resolve disputes, read analytics and suspend accounts. Administrators cannot be created through the public API — see [Seeding the first administrator](#seeding-the-first-administrator).

Two rules shape the whole permission model, and both are enforced on the server for every request:

- **Only individuals and agents can place bookings.** Vendors and planners sell; they do not buy.
- **Only individuals take part in matchmaking.** An agent participates only under the identity of a client on their own books.

A person who signs up on their own is never tied to an agency, and may approach any user or any agent freely. A person an agent onboards carries that agent's id, which is what scopes the agent's access to exactly their own clients.

The full contract — every role, every permission, and the two-layer guard plus ownership model — is in [docs/RBAC-AND-ROLES.md](docs/RBAC-AND-ROLES.md).

## What is inside this repository

The `backend` folder holds the API, the database migrations, the shared platform code such as configuration, authorization and health checks, and the tests. The `frontend` folder holds the React single page application. The `docker` folder holds the images and the compose files for running everything locally. The `scripts` folder holds the live RBAC verification suite. The `k8s` folder holds the Kubernetes manifests for a production deployment. The `terraform` folder holds the cloud infrastructure. The `docs` folder holds the design blueprint, the setup and testing guide, the authorization contract and an honest self-review of the remaining gaps.

## The main features

A person registers, picks an account type, and the system issues short lived access tokens together with longer lived refresh tokens. Individuals build a profile with their details and preferences. The matchmaking engine scores how compatible two people are and suggests the best options, and every weight in that scoring lives in configuration so the product team can retune it without touching the code. Once two people accept each other they can chat in real time, and chat is delivered reliably even when several copies of the backend are running because the messages travel through Redis. Buyers can also open an enquiry thread with any vendor, planner or agent without a prior match.

On the marketplace side, vendors and wedding planners publish listings, and an administrator approves each one before it appears in search or accepts a booking. Bookings move through a clear set of states from requested to paid to confirmed to completed, the payment is held in escrow until the event is done, and each side of the transaction can only drive the transitions that belong to it. Reviews can only be written after a booking with that provider has completed. The planner creates a wedding timeline automatically from the wedding date, and an engaged wedding planner can co-manage it. Couples manage several ceremonies with guest lists, invitations, responses and seating. They can browse honeymoon destinations and build an itinerary, create photo albums and share them through a public link. A helper called WOW Genie offers budget guidance and answers planning questions, and an administrator has a panel for approvals, disputes and analytics broken down by account type.

## Running it locally with Docker

```bash
cp docker/.env.example docker/.env    # then edit the secrets
docker compose -f docker/docker-compose.yml up -d --build
```

`docker/.env` controls the host ports, the database credentials, the JWT secrets and the bootstrap administrator. Change `FRONTEND_PORT` or `BACKEND_PORT` there if something else on your machine already uses 8080 or 3000, and keep `CORS_ORIGINS` in step with `FRONTEND_PORT`.

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

Beyond those, `scripts/verify-rbac.sh` exercises the authorization rules against a **running** stack — 108 checks covering privilege escalation at registration, per-persona permissions, agent scoping, booking IDOR, escrow transitions, review gating, event ownership, request validation and token handling. It runs inside the compose network and exits non-zero on any failure, so it can gate a deploy:

```bash
docker run --rm --network docker_default -v "$PWD/scripts:/scripts" alpine:3.20 \
  sh -c "apk add --no-cache curl jq >/dev/null && sh /scripts/verify-rbac.sh"
```

A k6 load test lives in `backend/test/k6`.

## Known gaps

[docs/SELF-REVIEW.md](docs/SELF-REVIEW.md) lists what is still missing and what I would do next, in priority order. The largest remaining item is that agent accounts are not vetted before they can onboard clients.
