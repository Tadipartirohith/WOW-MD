# Docker and testing notes

This document gives the exact commands for running the stack in Docker and for running the three kinds of tests. The setup guide in this same folder explains the same steps in a gentler way, so use whichever you prefer. Everything you can change lives in environment variables, so you never edit the source code to run or to test the system.

## Running the whole stack in Docker

Make sure Docker is running first. You can confirm it by running docker info and seeing server details rather than a socket error. Then, from the project folder, build and start everything.

```
docker compose -f docker/docker-compose.yml up --build
```

When it finishes you can open the frontend at http://localhost:8080, read the API documentation at http://localhost:3000/api/docs, check readiness at http://localhost:3000/api/health, and check liveness at http://localhost:3000/api/health/live. To stop everything, run the same command with down in place of up. Adding the volumes flag on the down command also erases the stored data.

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

## Load test

The load test uses k6 and checks that the busy endpoints stay fast under pressure. Run it against a stack that is already up, and it reports whether the response times stayed within the target.

```
BASE_URL=http://localhost:3000 k6 run backend/test/k6/load-test.js
```

## If something goes wrong

The most common problem is that Docker is installed but not started, which shows up as a message about not being able to reach the Docker socket. The fix is to start Docker, wait until it is ready, and run the command again. If a page does not load, the logs for that service almost always show the reason, and you can view them with docker compose and the logs command naming the service. If the API fails to start, it usually prints a clear message about a missing or invalid setting, which points straight at the value to correct in your environment file.
