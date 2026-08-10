# Setup and testing guide

This guide explains how to run the WOW platform on your own machine and how to run the tests. It is written for someone who has the project folder open in a terminal. Everything you can change lives in environment variables, so you never need to edit the source code to get it running or to test it.

## What you need first

You need Node version twenty or newer if you plan to run the tests or the no Docker path. For the simplest experience you also need Docker, which brings the database and the cache along with the application so you do not have to install anything else. On a Mac the usual choice is Docker Desktop. If you want to run the load test you also need the k6 tool, but that is optional.

## Running everything with Docker

This is the recommended path because it starts the database, the cache, the backend and the frontend together with a single command. Make sure Docker is actually running first. On a Mac you can start it by opening the Docker application and waiting until its icon settles, and you can confirm it is ready by running the command docker info, which should print server details rather than a socket error.

Once Docker is running, go to the project folder and run the deploy script.

```
cd ~/Documents/S3D/wow-platform
bash deploy-local.sh
```

The script checks that Docker is up and tries to start it for you if it is not. It then builds the images, starts all four services, waits until the API reports that it is healthy, and prints the addresses. When it finishes you can open the frontend at http://localhost:8080, read the API documentation at http://localhost:3000/api/docs, and check health at http://localhost:3000/api/health.

If you prefer to run the underlying command yourself instead of the script, the equivalent is to bring the stack up with compose.

```
docker compose -f docker/docker-compose.yml up --build
```

To stop everything, run compose down. Adding the volumes flag also erases the stored data so you get a clean slate next time.

```
docker compose -f docker/docker-compose.yml down
```

If the frontend does not appear, the quickest way to see why is to look at its logs.

```
docker compose -f docker/docker-compose.yml logs --tail=50 frontend
```

## Running without Docker

If you would rather not use Docker at all, there is a second script that installs PostgreSQL and Redis through Homebrew, prepares the database, and starts the backend directly with Node.

```
cd ~/Documents/S3D/wow-platform
bash run-local-no-docker.sh
```

That brings the backend up at http://localhost:3000/api. To see the user interface as well, open a second terminal, move into the frontend folder, install its dependencies, and start the development server, which runs at http://localhost:5173.

```
cd frontend
npm install
npm run dev
```

## Changing settings

The file called .env.example inside the backend folder lists every setting you can adjust, and each one has a short explanation next to it. Copy it to a file named .env and change whatever you need. The important groups are the database connection, the Redis connection, the security settings such as the token secrets and the rate limits, the matchmaking weights that control how compatibility is scored, and the choice of payment, storage and AI provider. The application reads these values when it starts and refuses to start if a required value is missing or clearly wrong, which means a mistake is caught right away.

## Running the tests

The unit tests cover the core logic and run quickly because they do not need a database. From the backend folder you install the dependencies once and then run the test command.

```
cd backend
npm install
npm test
```

The functional tests exercise the real API against a real database and cache, so they need those two services running. The simplest way is to start the test database and cache with the test compose file, apply the schema, and then run the end to end suite. The exact commands are shown in the file named DOCKER-AND-TESTING inside the docs folder, which lists the environment values to use for the throwaway test services.

The load test uses k6 and checks that the busy endpoints stay fast under pressure. You run it against a stack that is already up, and it reports whether the response times stayed within the target.

## If something goes wrong

The most common problem is that Docker is installed but not started, which shows up as a message about not being able to reach the Docker socket. The fix is simply to start Docker and wait until it is ready, then run the command again. If a page does not load, checking the logs for that service almost always shows the reason. If the API fails to start, it usually prints a clear message about a missing or invalid setting, which points straight at the value to correct in your environment file.
