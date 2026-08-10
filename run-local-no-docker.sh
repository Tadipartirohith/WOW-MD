#!/usr/bin/env bash
# Local run without Docker for macOS. It uses Homebrew to provide Postgres and
# Redis and runs the backend with local Node. It brings the backend up at
# http://localhost:3000. Run the frontend separately with npm run dev in the
# frontend folder, which serves http://localhost:5173.
# Run this script from the project root with: bash run-local-no-docker.sh
set -euo pipefail
cd "$(dirname "$0")"

command -v brew >/dev/null 2>&1 || { echo "Homebrew is required. See https://brew.sh"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "Node.js version 20 or newer is required. Install it with: brew install node"; exit 1; }

echo "Making sure Postgres and Redis are installed and running."
brew list postgresql@16 >/dev/null 2>&1 || brew install postgresql@16
brew list redis >/dev/null 2>&1 || brew install redis
brew services start postgresql@16
brew services start redis
sleep 3

export PATH="$(brew --prefix postgresql@16)/bin:$PATH"

echo "Creating the database role and database if they do not already exist."
createuser -s wow_user 2>/dev/null || true
psql -d postgres -c "ALTER USER wow_user PASSWORD 'wow_password';" >/dev/null 2>&1 || true
createdb -O wow_user wow_db 2>/dev/null || true

echo "Configuring the backend environment."
cd backend
[ -f .env ] || cp .env.example .env
export NODE_ENV=development PORT=3000 \
  DB_HOST=127.0.0.1 DB_PORT=5432 DB_USER=wow_user DB_PASSWORD=wow_password DB_NAME=wow_db \
  REDIS_HOST=127.0.0.1 REDIS_PORT=6379 \
  JWT_SECRET="$(openssl rand -hex 24)" JWT_REFRESH_SECRET="$(openssl rand -hex 24)"

echo "Installing dependencies and running the database migrations."
npm install
npm run migration:run

echo "Starting the backend at http://localhost:3000/api"
echo "The API documentation is at http://localhost:3000/api/docs"
echo "Press Control C to stop."
npm run start:dev
