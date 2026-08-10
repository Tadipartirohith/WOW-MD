#!/usr/bin/env bash
# One command local deployment of the full WOW stack, which is Postgres, Redis,
# the backend, and the frontend, using Docker Compose. Run it from the project
# root with: bash deploy-local.sh
set -euo pipefail
cd "$(dirname "$0")"

echo "Starting the WOW local deployment."

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed."
  echo "On a Mac you can install Docker Desktop with: brew install --cask docker"
  echo "You can also download it from the Docker website. Start Docker, then run this script again."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "The Docker daemon is not running. Trying to start it."
  if [ "$(uname)" = "Darwin" ] && [ -d "/Applications/Docker.app" ]; then
    open -a Docker || true
  elif command -v colima >/dev/null 2>&1; then
    colima start || true
  fi
  echo "Waiting for the Docker daemon for up to 120 seconds."
  for i in $(seq 1 40); do
    docker info >/dev/null 2>&1 && break
    sleep 3
  done
  if ! docker info >/dev/null 2>&1; then
    echo "The Docker daemon is still not reachable."
    echo "If you have Docker Desktop, open it, wait until it is ready, and run this script again."
    echo "If you do not have Docker, install it, or run the script named run-local-no-docker.sh instead."
    exit 1
  fi
fi
echo "The Docker daemon is up."

if docker compose version >/dev/null 2>&1; then COMPOSE="docker compose"; else COMPOSE="docker-compose"; fi

export JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 24)}"
export JWT_REFRESH_SECRET="${JWT_REFRESH_SECRET:-$(openssl rand -hex 24)}"

echo "Building and starting the containers."
$COMPOSE -f docker/docker-compose.yml up --build -d

echo "Waiting for the API to become healthy."
ok=0
for i in $(seq 1 60); do
  if curl -sf http://localhost:3000/api/health/live >/dev/null 2>&1; then ok=1; break; fi
  sleep 3
done

echo
if [ "$ok" = "1" ]; then
  echo "WOW is live."
  echo "Frontend is at http://localhost:8080"
  echo "API is at http://localhost:3000/api"
  echo "API documentation is at http://localhost:3000/api/docs"
  echo "Health is at http://localhost:3000/api/health"
  echo
  echo "To watch the logs run: $COMPOSE -f docker/docker-compose.yml logs -f"
  echo "To stop run: $COMPOSE -f docker/docker-compose.yml down"
  echo "Add the volumes flag to the down command to also erase stored data."
else
  echo "The API did not report healthy in time. Check the logs with:"
  echo "$COMPOSE -f docker/docker-compose.yml logs --tail=100 backend"
  exit 1
fi
