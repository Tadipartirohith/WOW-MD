# Docker and testing notes

This document gives the exact commands for running the stack in Docker and for running the three kinds of tests. The setup guide in this same folder explains the same steps in a gentler way, so use whichever you prefer. Everything you can change lives in environment variables, so you never edit the source code to run or to test the system.

## Running the whole stack in Docker

Make sure Docker is running first. You can confirm it by running docker info and seeing server details rather than a socket error. Then, from the project folder, build and start everything.

```
docker compose -f docker/docker-compose.yml up --build
```

When it finishes you can open the frontend at http://localhost:8080, read the API documentation at http://localhost:3000/api/docs, check readiness at http://localhost:3000/api/health, and check liveness at http://localhost:3000/api/health/live. To stop everything, run the same command with down in place of up. Adding the volumes flag on the down command also erases the stored data.

### Seed it, both times

A fresh database has no administrator and no service catalog, and neither can
be created through the API — an administrator is not self-registerable by
design, and the catalog is configuration rather than user data. Two one-shot
commands, both idempotent, both safe to re-run:

```
docker compose -f docker/docker-compose.yml --profile seed run --rm seed-admin
docker compose -f docker/docker-compose.yml --profile seed run --rm seed-catalog
```

**The catalog one is not optional.** Without it a vendor cannot put a priced
service on a listing, so no listing can be submitted for verification and
nothing in the marketplace can ever be sold. A deployment missing it looks
perfectly healthy — the API answers, the pages load — right up until the first
vendor tries to sell something. It was missing from this document and from the
compose file until a from-scratch run went looking for it.

To run the optional Neo4j and Kafka services as well, start with the full profile and turn on their flags in the same command.

```
NEO4J_ENABLED=true KAFKA_ENABLED=true docker compose -f docker/docker-compose.yml --profile full up --build -d
```

## Unit tests

The unit tests cover the core logic and run quickly because they do not need a database. From the backend folder you install the dependencies once and then run the tests.

```
cd backend
npm install
npm test
```

The frontend has its own tests, which are quick and worth running before any change to the permission list.

```
cd frontend
npm install
npm test
```

The important one there reads the backend's permission enum straight off disk and fails if the client's hand-written mirror has drifted from it. That mirror decides which navigation entries a persona sees, and nothing else was checking it.

## Functional tests

The functional tests drive the real API against a real database and cache, so those two services must be running. The simplest way is to start the throwaway test services with the test compose file, apply the schema, and then run the end to end suite. The test services listen on port 5433 for the database and port 6380 for the cache so they do not clash with a normal stack.

```
docker compose -f docker/docker-compose.test.yml up -d

cd backend
DB_NAME=wow_test DB_PORT=5433 REDIS_PORT=6380 \
JWT_SECRET=test-secret-at-least-32-characters-long \
JWT_REFRESH_SECRET=test-refresh-at-least-32-characters-long \
  npm run migration:run

DB_NAME=wow_test DB_PORT=5433 REDIS_PORT=6380 \
JWT_SECRET=test-secret-at-least-32-characters-long \
JWT_REFRESH_SECRET=test-refresh-at-least-32-characters-long \
  npm run test:e2e

docker compose -f docker/docker-compose.test.yml down
```

## Verification suites

The nine verification suites in `scripts/` drive the live API the way a person
would, and assert on what comes back. Between them they carry 1470 assertions.
They run from inside the compose network, against a stack that is already up.

| Suite | Covers |
| --- | --- |
| `verify-rbac.sh` | Who may do what, per persona, including by direct URL |
| `verify-invites.sh` | Building a profile for someone, inviting them, and what changes when they claim it |
| `verify-circulation.sh` | Consent, duplicate detection, and sending a biodata to another family |
| `verify-phase1.sh` | Field verification, support cases, frozen escrow, milestones and quotations |
| `verify-phase2.sh` | The sectioned biodata and Aadhaar, notifications, the accounts ledger, chat presence, events, honeymoon packages, match filters and disputes |
| `verify-phase3.sh` | SMS delivery, phone verification, phone-only invitations, profile claim requests, recovery codes, data export and erasure, the pool quota, circulation reach and photo uploads |
| `verify-phase4.sh` | The catalog, availability and capacity, the business lifecycle, geography-aware allocation, events, blocking and reporting, the admin console, settlement requests, and the notification channels |
| `verify-wow1.sh` | The match card and its facts, search, sorting, pagination, the shortlist, the identity gate on matchmaking, the chat header's context, the biodata money fields, and the upload path under real-world filenames |
| `verify-wow2.sh` | Values written to the database appearing in the UI, compatibility scored from the biodata, the vendor draft/verification handshake, planner verification, the agent's whole client book, the network pool, and the Genie |

`scripts/lib-identity.sh` is not a suite. It is the shared fixture that takes a
persona through Aadhaar verification, which every suite now needs: sending an
interest, accepting one and fixing a match all require the subject profile's
document to have been confirmed first.

Run one like this, replacing the name at the end:

```
docker run --rm --network docker_default -v "$PWD/scripts:/scripts"   alpine:3.20 sh -c "apk add --no-cache curl jq redis >/dev/null && sh /scripts/verify-phase2.sh"
```

Each prints a PASS or FAIL line per assertion and a total at the end, and exits
non-zero if anything failed. They need `MAIL_PROVIDER=log` and
`AADHAAR_PROVIDER=mock`: in those modes invitation links, temporary passwords
and OTP codes come back on the response, because nothing is actually delivered.
`SMS_PROVIDER=log` behaves the same way for text messages.
They are safe to re-run — every run generates its own emails, phone numbers and
Aadhaar number, so a second run does not collide with the first.

**Install `redis` in the runner, not just `curl` and `jq`.** Registration is
rate-limited per IP and Docker hands out recently-freed addresses, so a suite
run straight after another one collects 429s that read exactly like real
failures. Each suite clears the throttle counters on the way in — but the block
is guarded on `redis-cli` being present, and without it the guard silently does
nothing. That guard is why two of these scripts documented a runner command
that could not actually run them twice in a row.

## Load test

The load test uses k6 and checks that the busy endpoints stay fast under pressure. Run it against a stack that is already up, and it reports whether the response times stayed within the target.

```
BASE_URL=http://localhost:3000 k6 run backend/test/k6/load-test.js
```

## If something goes wrong

The most common problem is that Docker is installed but not started, which shows up as a message about not being able to reach the Docker socket. The fix is to start Docker, wait until it is ready, and run the command again. If a page does not load, the logs for that service almost always show the reason, and you can view them with docker compose and the logs command naming the service. If the API fails to start, it usually prints a clear message about a missing or invalid setting, which points straight at the value to correct in your environment file.
